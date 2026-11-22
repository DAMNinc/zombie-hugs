import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { io as connect, type Socket } from 'socket.io-client';
import { createServer } from '../../lib/app';
import controller, { knobs, resetKnobs } from '../../lib/controller';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

/** End-to-end: the real server in-process, real socket.io connections, real timers (shortened by knobs). */

let ctx: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  ctx = createServer();
  await new Promise<void>(res => ctx.server.listen(0, res));
  base = `http://127.0.0.1:${(ctx.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await ctx.io.close();
});

class Client {
  socket: Socket;
  log: Array<{ event: string; args: any[] }> = [];
  private waiters: Array<() => void> = [];
  private pinger: ReturnType<typeof setInterval>;
  token = '';
  me: any = null;
  constructor() {
    this.socket = connect(base, { forceNew: true, transports: ['websocket'], reconnection: false });
    this.socket.onAny((event, ...args) => {
      this.log.push({ event, args });
      if (event === 'player') {
        this.me = args[0];
        if (args[0].token) this.token = args[0].token;
      }
      this.waiters.slice().forEach(w => w());
    });
    this.pinger = setInterval(() => this.socket.emit('pingpong'), 1000);
  }
  mark() { return this.log.length; }
  find(event: string, from = 0, pred: (...a: any[]) => boolean = () => true) {
    for (let i = from; i < this.log.length; i++) {
      if (this.log[i].event === event && pred(...this.log[i].args)) return this.log[i].args;
    }
    return undefined;
  }
  all(event: string, from = 0) { return this.log.slice(from).filter(e => e.event === event).map(e => e.args); }
  lastLobby(): any { return this.all('lobby').at(-1)?.[0]; }
  /** Resolves with the args of the first matching event at or after `from`. */
  wait(event: string, from = 0, pred: (...a: any[]) => boolean = () => true, ms = 4000): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const hit = this.find(event, from, pred);
        if (hit) { done(); resolve(hit); }
      };
      const timer = setTimeout(() => { done(); reject(new Error(`timeout waiting for ${event}; saw ${this.log.slice(from).map(e => e.event).filter((e, i, a) => a.indexOf(e) === i).join(',')}`)); }, ms);
      const done = () => { clearTimeout(timer); this.waiters = this.waiters.filter(w => w !== check); };
      this.waiters.push(check);
      check();
    });
  }
  waitLobby(pred: (l: any) => boolean, from = 0) { return this.wait('lobby', from, pred).then(a => a[0]); }
  emit(event: string, ...args: any[]) { this.socket.emit(event, ...args); }
  close() { clearInterval(this.pinger); this.socket.close(); }
}

let clients: Client[] = [];
function client() { const c = new Client(); clients.push(c); return c; }

beforeEach(() => {
  knobs.countdownSeconds = 1;
  knobs.countdownTickMs = 100;
  knobs.sweepIntervalMs = 50;
  knobs.pointsToWin = 1;
  knobs.roundsToWin = 1;
  knobs.brawlRoundMs = 800;
  knobs.reconnectWindowMs = 500;
});
afterEach(() => {
  clients.forEach(c => c.close());
  clients = [];
  for (const id of Object.keys(controller.games)) { controller.games[Number(id)].stop(); delete controller.games[Number(id)]; }
  resetKnobs();
});

async function newRoom(): Promise<number> {
  const res = await fetch(`${base}/game`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'gameName=e2e' });
  const id = Number(res.headers.get('location')!.split('/').pop());
  expect(controller.games[id]).toBeDefined();
  return id;
}

/** n humans join and are seated. */
async function seat(n: number) {
  const gameId = await newRoom();
  const cs: Client[] = [];
  for (let i = 0; i < n; i++) {
    const c = client();
    c.emit('join.player', { gameId });
    await c.wait('player');
    cs.push(c);
  }
  await cs[0].waitLobby(l => l.seats.filter(Boolean).length === n);
  return { gameId, cs, game: controller.games[gameId] };
}

/** Everyone presses ready; resolves when each saw game.start. */
async function startMatch(cs: Client[], from: number[] = cs.map(c => c.mark())) {
  cs.forEach(c => c.emit('ready'));
  const started = await Promise.all(cs.map((c, i) => c.wait('game.start', from[i])));
  return started[0][0];
}

/** Fires a real creature from `c`, then nudges it to just before an exit so the match does not take minutes. */
async function scoreHit(c: Client, game: any) {
  const me = game.players[c.me.id];
  const before = Object.keys(game.zombies);
  c.emit('fire', { x: 0, y: 0, z: me.position.z }, 1, 0);
  await vi.waitFor(() => expect(Object.keys(game.zombies).length).toBeGreaterThan(before.length));
  const z = game.zombies[Object.keys(game.zombies).find(id => !before.includes(id))!];
  if (game.mode === 'brawl') {
    const target = game.players[me.targetId];
    const inward = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[target.edge as 'N'] as number[];
    // two creature lengths short of the target's edge exit line, heading outwards through it
    z.position.x = z.baseX = inward[0] * 1140; z.position.z = z.baseZ = inward[1] * 1140;
    z.vx = inward[0]; z.vz = inward[1];
  } else {
    z.position.z = z.baseZ = z.direction > 0 ? 1490 : -1490;
  }
}

describe('lobby → match → results → rematch by headcount', () => {
  it('1 player: solo practice against the bot, rematch and lobby.return', async () => {
    const { cs, game } = await seat(1);
    const [a] = cs;
    expect(a.me).toMatchObject({ seat: 0, isBot: false, edge: 'N' });
    expect(a.lastLobby()).toMatchObject({ mode: 'solo', phase: 'lobby' });

    const m = a.mark();
    const start = await startMatch(cs);
    expect(start).toMatchObject({ mode: 'solo', ranked: false, arena: { kind: 'lane' } });
    expect(a.find('game.countdown', m)).toBeDefined();
    const lobby = a.lastLobby();
    expect(lobby.seats[1]).toMatchObject({ isBot: true });

    await scoreHit(a, game);
    const [over] = await a.wait('match.over');
    expect(over).toMatchObject({ mode: 'solo', ranked: false, winner: a.me.id });
    expect(over.elo).toBeUndefined();

    // rematch: the only human votes, the next countdown starts with the bot again
    const r = a.mark();
    a.emit('rematch');
    await a.wait('game.rematch', r);
    await a.wait('game.countdown', r);
    const s2 = await a.wait('game.start', r);
    expect(s2[0].mode).toBe('solo');

    // solo allows lobby.return at any time
    const r2 = a.mark();
    a.emit('lobby.return');
    await a.wait('game.reset', r2);
    const l = await a.waitLobby(x => x.phase === 'lobby', r2);
    expect(l.seats[1]).toBeNull();
    expect(l.seats[0].ready).toBe(false);
  });

  it('2 players: duel is ranked, rematch restarts, lobby.return empties readiness', async () => {
    const { cs, game } = await seat(2);
    expect(cs[0].lastLobby().mode).toBe('duel');
    const start = await startMatch(cs);
    expect(start).toMatchObject({ mode: 'duel', ranked: true });

    await scoreHit(cs[0], game);
    const [over] = await cs[1].wait('match.over');
    expect(over).toMatchObject({ mode: 'duel', ranked: true, winner: cs[0].me.id, loser: cs[1].me.id });
    expect(over.elo).toBeDefined();

    const m = cs.map(c => c.mark());
    cs.forEach(c => c.emit('rematch'));
    await Promise.all(cs.map((c, i) => c.wait('game.rematch', m[i])));
    await Promise.all(cs.map((c, i) => c.wait('game.countdown', m[i])));
    const s2 = await Promise.all(cs.map((c, i) => c.wait('game.start', m[i])));
    expect(s2[0][0].mode).toBe('duel');

    await scoreHit(cs[1], game);
    await cs[0].wait('match.over', m[0]);
    const r = cs.map(c => c.mark());
    cs[0].emit('lobby.return');
    const l = await cs[1].waitLobby(x => x.phase === 'lobby', r[1]);
    expect(l.seats.filter(Boolean).map((s: any) => s.ready)).toEqual([false, false]);
    expect(cs[0].find('game.reset', r[0])).toBeDefined();
  });

  for (const n of [3, 4] as const) {
    it(`${n} players: brawl round ends with a unique winner, rematch, lobby.return`, async () => {
      const { cs, game } = await seat(n);
      expect(cs[0].lastLobby()).toMatchObject({ mode: 'brawl' });
      const start = await startMatch(cs);
      expect(start).toMatchObject({ mode: 'brawl', ranked: false, arena: { kind: 'square' }, roundDurationMs: 800 });

      await scoreHit(cs[0], game);
      const [over] = await cs[n - 1].wait('match.over', 0, () => true, 6000);
      expect(over).toMatchObject({ mode: 'brawl', ranked: false, winner: cs[0].me.id });
      expect(over.standings[0]).toMatchObject({ id: cs[0].me.id, score: 1 });
      expect(over.standings).toHaveLength(n);
      expect(over.elo).toBeUndefined();

      const m = cs.map(c => c.mark());
      cs.forEach(c => c.emit('rematch'));
      await Promise.all(cs.map((c, i) => c.wait('game.rematch', m[i])));
      await Promise.all(cs.map((c, i) => c.wait('game.countdown', m[i])));
      const s2 = await Promise.all(cs.map((c, i) => c.wait('game.start', m[i])));
      expect(s2[0][0].mode).toBe('brawl');

      // lobby.return is ignored while a brawl is running
      const r = cs.map(c => c.mark());
      cs[0].emit('lobby.return');
      await new Promise(res => setTimeout(res, 100));
      expect(cs[0].find('game.reset', r[0])).toBeUndefined();
    }, 10000);

    it(`${n} players: lobby.return after the round puts everyone back in the lobby unready`, async () => {
      const { cs, game } = await seat(n);
      await startMatch(cs);
      await scoreHit(cs[1], game);
      await cs[0].wait('match.over', 0, () => true, 6000);
      const r = cs.map(c => c.mark());
      cs[0].emit('lobby.return');
      const l = await cs[0].waitLobby(x => x.phase === 'lobby', r[0]);
      expect(l.seats.filter(Boolean)).toHaveLength(n);
      expect(l.seats.filter(Boolean).every((s: any) => !s.ready)).toBe(true);
      expect(l.mode).toBe('brawl');
    }, 10000);
  }
});

describe('fifth arrival', () => {
  it('spectates, is queued, and is promoted after lobby.return', async () => {
    const { gameId, cs, game } = await seat(4);
    await startMatch(cs);
    const fifth = client();
    fifth.emit('join.player', { gameId });
    const [q] = await fifth.wait('join.queued');
    expect(q).toEqual({ position: 1 });
    expect(fifth.find('player')).toBeUndefined();
    await fifth.wait('state');
    // the queued spectator is told about every seated player
    await vi.waitFor(() => expect(new Set(fifth.all('opponent').map(a => a[0].id)).size).toBe(4));
    expect((await cs[0].waitLobby(l => l.queue.length === 1)).queue).toHaveLength(1);

    await scoreHit(cs[0], game);
    await cs[0].wait('match.over', 0, () => true, 6000);
    const m = fifth.mark();
    // one player leaves the results, then lobby.return fills the free seat from the queue
    cs[3].emit('exit');
    cs[0].emit('lobby.return');
    const [p] = await fifth.wait('player', m);
    expect(p).toMatchObject({ isBot: false, seat: 3 });
    expect(typeof p.token).toBe('string');
    const l = await fifth.waitLobby(x => x.queue.length === 0 && x.seats.filter(Boolean).length === 4, m);
    expect(l.phase).toBe('lobby');
  }, 10000);
});

describe('fifth arrival (rematch)', () => {
  it('is promoted when the seated players vote rematch and a seat is free', async () => {
    const { gameId, cs, game } = await seat(4);
    await startMatch(cs);
    const fifth = client();
    fifth.emit('join.player', { gameId });
    await fifth.wait('join.queued');
    await scoreHit(cs[0], game);
    await cs[0].wait('match.over', 0, () => true, 6000);
    cs[3].emit('exit');
    await cs[0].waitLobby(l => l.seats.filter(Boolean).length === 3);
    const m = fifth.mark();
    cs.slice(0, 3).forEach(c => c.emit('rematch'));
    const [p] = await fifth.wait('player', m);
    expect(p).toMatchObject({ isBot: false, seat: 3 });
    const [start] = await fifth.wait('game.start', m);
    expect(start.mode).toBe('brawl');
    expect(controller.games[gameId].humans()).toHaveLength(4);
  }, 10000);
});

describe('disconnects and rejoins', () => {
  it('mid-brawl drop is held and the token restores seat and score', async () => {
    const { gameId, cs, game } = await seat(3);
    await startMatch(cs);
    await scoreHit(cs[0], game);
    await vi.waitFor(() => expect(game.players[cs[0].me.id].score).toBe(1));

    const [a, b] = cs;
    const m = b.mark();
    const seat0 = a.me.seat;
    a.close();
    const [d] = await b.wait('player.disconnected', m);
    expect(d.id).toBe(a.me.id);
    expect(d.until).toBeGreaterThan(Date.now() - 50);

    const fresh = client();
    fresh.emit('join.player', { gameId, token: a.token });
    await fresh.wait('player');
    expect(fresh.me).toMatchObject({ id: a.me.id, seat: seat0 });
    expect((await b.wait('player.reconnected', m))[0]).toBe(a.me.id);
    expect(game.players[a.me.id].score).toBe(1);
    expect(game.players[a.me.id].connected).toBe(true);
  });

  it('window expiry removes the player with player.exit; a duel drops back to the lobby', async () => {
    const { cs } = await seat(2);
    await startMatch(cs);
    const [a, b] = cs;
    const m = b.mark();
    const leaver = a.me.id;
    a.close();
    await b.wait('player.disconnected', m);
    const [exitId] = await b.wait('player.exit', m);
    expect(exitId).toBe(leaver);
    await b.wait('game.reset', m);
    const l = await b.waitLobby(x => x.phase === 'lobby' && x.seats.filter(Boolean).length === 1, m);
    expect(l.seats.filter(Boolean)[0].id).toBe(b.me.id);
  });

  it('brawl continues for the rest and ends when one human is left', async () => {
    const { cs } = await seat(3);
    await startMatch(cs);
    const [a, b, c] = cs;
    const m = b.mark();
    a.close();
    await b.wait('player.exit', m, id => id === a.me.id);
    expect(b.find('match.over', m)).toBeUndefined();
    c.close();
    const [over] = await b.wait('match.over', m);
    expect(over).toMatchObject({ mode: 'brawl', ranked: false, winner: b.me.id });
    const l = await b.waitLobby(x => x.phase === 'match_over', m);
    expect(l.seats.filter(Boolean)).toHaveLength(1);
  });
});

describe('room cleanup', () => {
  it('removes a room by itself once everyone has left and the TTL passed', async () => {
    const { gameId, cs, game } = await seat(2);
    knobs.emptyGameTtlMs = 50; // read by the live sweep
    cs.forEach(c => c.emit('exit'));
    await vi.waitFor(() => expect(game.humans()).toHaveLength(0));
    await vi.waitFor(() => expect(controller.games[gameId]).toBeUndefined(), { timeout: 2000 });
    cs.forEach(c => c.close());
    const late = client();
    late.emit('join.player', { gameId });
    await late.wait('join.error.notfound');
  });

  it('keeps a room that still has a spectator, and removes it once they leave', async () => {
    const { gameId, cs, game } = await seat(2);
    const watcher = client();
    watcher.emit('join.spectator', { gameId });
    await watcher.wait('state');
    knobs.emptyGameTtlMs = 50;
    cs.forEach(c => c.emit('exit'));
    await vi.waitFor(() => expect(game.humans()).toHaveLength(0));
    expect(Object.keys(game.spectators)).toHaveLength(1);
    await new Promise(res => setTimeout(res, 400)); // several sweeps beyond the TTL
    expect(controller.games[gameId]).toBe(game);
    watcher.close();
    await vi.waitFor(() => expect(controller.games[gameId]).toBeUndefined(), { timeout: 2000 });
  });
});
