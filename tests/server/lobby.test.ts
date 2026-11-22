import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Socket } from 'socket.io';
import controller, { Game, Zombie, getElo, assignSide, createBot } from '../../lib/controller';
import { FakeSocket, makePlayer } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** n humans seated through the real join path (join.player on a FakeSocket). */
function room(n: number, prefix = 'p') {
  const game = new Game(5000 + Math.floor(Math.random() * 1e6), 'lobby-test');
  controller.games[game.id] = game;
  const sockets: FakeSocket[] = [];
  for (let i = 0; i < n; i++) sockets.push(join(game, `${prefix}${i}`));
  return { game, sockets };
}
function join(game: Game, id: string) {
  const s = new FakeSocket(id);
  controller.setupSocket(s as unknown as Socket);
  s.trigger('join.player', { gameId: game.id });
  return s;
}
const lastLobby = (s: FakeSocket) => s.events('lobby').at(-1)!.args[0];
const readyAll = (sockets: FakeSocket[]) => sockets.forEach(s => s.trigger('ready'));

describe('seats', () => {
  it('assigns seats 0..3 in join order with colours, edges and the classic duel geometry', () => {
    const { game, sockets } = room(4);
    const info = sockets.map(s => s.events('player')[0].args[0]);
    expect(info.map(i => i.seat)).toEqual([0, 1, 2, 3]);
    expect(info.map(i => i.color)).toEqual(['#0072B2', '#D55E00', '#F0E442', '#009E73']);
    expect(info.map(i => i.edge)).toEqual(['N', 'S', 'W', 'E']);
    expect(info[0]).toMatchObject({ direction: -1, isBot: false });
    expect(info[0].position.z).toBe(-1000);
    expect(info[1]).toMatchObject({ direction: 1 });
    expect(info[1].position.z).toBe(1000);
    expect(info.every(i => typeof i.token === 'string' && i.token.length >= 16)).toBe(true);
    expect(new Set(info.map(i => i.token)).size).toBe(4);
    expect(Object.keys(game.players)).toHaveLength(4);
  });

  it('never leaks tokens in opponent or state payloads', () => {
    const { game, sockets } = room(2);
    expect(JSON.stringify(sockets[0].events('opponent'))).not.toContain('token');
    expect(JSON.stringify(game.toJSON())).not.toContain('token');
  });

  it('a freed seat is reused by the next joiner (lowest free seat)', () => {
    const { game, sockets } = room(3);
    sockets[1].trigger('exit');
    const s = join(game, 'late');
    expect(game.players['late'].seat).toBe(1);
    expect(game.players['late'].position.z).toBe(1000);
  });

  it('assignSide follows the seat table', () => {
    const { game } = room(1);
    expect(assignSide(game)).toBe(1);
    expect(assignSide(new Game(1))).toBe(-1);
  });
});

describe('queue', () => {
  it('the fifth arrival in the lobby is a queued spectator', () => {
    const { game, sockets } = room(4);
    const fifth = join(game, 'fifth');
    expect(fifth.events('join.queued')[0].args[0]).toEqual({ position: 1 });
    expect(fifth.events('player')).toHaveLength(0);
    expect(game.spectators['fifth']).toBeDefined();
    // spectator stream: opponent per seated player, hazards, lobby
    expect(fifth.events('opponent')).toHaveLength(4);
    expect(fifth.events('hazards')).toHaveLength(1);
    expect(lastLobby(fifth).queue).toEqual([{ id: 'fifth', name: game.queue[0].name }]);
    expect(lastLobby(sockets[0]).queue).toHaveLength(1);
  });

  it('a join during a match is queued, with positions in join order', () => {
    const { game, sockets } = room(2);
    readyAll(sockets);
    expect(game.phase).toBe('countdown');
    const a = join(game, 'late-a');
    const b = join(game, 'late-b');
    expect(a.events('join.queued')[0].args[0]).toEqual({ position: 1 });
    expect(b.events('join.queued')[0].args[0]).toEqual({ position: 2 });
    expect(Object.keys(game.players)).toHaveLength(2);
  });

  it('queued spectators leave the queue on disconnect and later ones move up', () => {
    const { game } = room(4);
    const a = join(game, 'qa');
    const b = join(game, 'qb');
    a.trigger('disconnect');
    expect(game.queue.map(q => q.id)).toEqual(['qb']);
    expect(b.events('join.queued').at(-1)!.args[0]).toEqual({ position: 1 });
    expect(game.spectators['qa']).toBeUndefined();
  });

  it('queued spectators cannot ready, fire or vote as players', () => {
    const { game, sockets } = room(4);
    const q = join(game, 'q');
    q.trigger('ready');
    q.trigger('fire', { x: 0, y: 0, z: 0 }, 1, 0);
    expect(game.players['q']).toBeUndefined();
    expect(Object.keys(game.zombies)).toHaveLength(0);
  });

  it('fill free seats in join order on lobby.return', () => {
    const { game, sockets } = room(2);
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    const q1 = join(game, 'q1');
    const q2 = join(game, 'q2');
    game.phase = 'match_over';
    sockets[0].trigger('lobby.return');
    expect(game.phase).toBe('lobby');
    expect(Object.keys(game.players).sort()).toEqual(['p0', 'p1', 'q1', 'q2']);
    expect(game.players['q1'].seat).toBe(2);
    expect(game.players['q2'].seat).toBe(3);
    expect(q1.events('player')[0].args[0].seat).toBe(2);
    expect(q2.events('player')[0].args[0].seat).toBe(3);
    expect(new Set(q1.events('opponent').map(e => e.args[0].id))).toEqual(new Set(['p0', 'p1', 'q2']));
    expect(game.queue).toHaveLength(0);
    expect(game.spectators['q1']).toBeUndefined();
    // promoted sockets act as players now
    q1.trigger('ready');
    expect(game.players['q1'].ready).toBe(true);
  });

  it('fills free seats on rematch and the new roster starts at the countdown', () => {
    const { game, sockets } = room(2, 'rm');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    const q = join(game, 'rmq');
    game.phase = 'match_over';
    sockets.forEach(s => s.trigger('rematch'));
    expect(Object.keys(game.players)).toContain('rmq');
    expect(game.players['rmq'].seat).toBe(2);
    expect(game.phase).toBe('countdown');
    expect(game.mode).toBe('brawl');
  });

  it('a seat freed in the lobby is taken by the first queued spectator', () => {
    const { game, sockets } = room(4);
    const q = join(game, 'q');
    sockets[2].trigger('exit');
    expect(game.players['q'].seat).toBe(2);
    expect(game.queue).toHaveLength(0);
  });
});

describe('lobby event, ready and unready', () => {
  it('broadcasts seats, queue, mode and invite path on every change', () => {
    const { game, sockets } = room(2);
    let l = lastLobby(sockets[0]);
    expect(l.phase).toBe('lobby');
    expect(l.mode).toBe('duel');
    expect(l.invitePath).toBe(`/game/${game.id}`);
    expect(l.seats).toHaveLength(4);
    expect(l.seats[0]).toEqual({ seat: 0, id: 'p0', name: game.players['p0'].name, color: '#0072B2', ready: false, connected: true, isBot: false });
    expect(l.seats[2]).toBeNull();
    expect(l.seats[3]).toBeNull();
    sockets[0].trigger('ready');
    l = lastLobby(sockets[1]);
    expect(l.seats[0].ready).toBe(true);
    expect(l.seats[1].ready).toBe(false);
  });

  it('mode preview follows the headcount: solo, duel, brawl', () => {
    const { game, sockets } = room(1);
    expect(lastLobby(sockets[0]).mode).toBe('solo');
    join(game, 'x');
    expect(lastLobby(sockets[0]).mode).toBe('duel');
    join(game, 'y');
    expect(lastLobby(sockets[0]).mode).toBe('brawl');
  });

  it('unready undoes ready in the lobby and the countdown waits for every seated human', () => {
    const { game, sockets } = room(3);
    sockets[0].trigger('ready');
    sockets[1].trigger('ready');
    sockets[1].trigger('unready');
    sockets[2].trigger('ready');
    expect(game.players['p1'].ready).toBe(false);
    expect(game.phase).toBe('lobby');
    sockets[1].trigger('ready');
    expect(game.phase).toBe('countdown');
  });

  it('unready does nothing once the countdown has started', () => {
    const { game, sockets } = room(2);
    readyAll(sockets);
    sockets[0].trigger('unready');
    expect(game.players['p0'].ready).toBe(true);
  });

  it('a late joiner delays the start: a ready room is not ready any more', () => {
    const { game, sockets } = room(2);
    sockets[0].trigger('ready');
    join(game, 'p2');
    sockets[1].trigger('ready');
    expect(game.phase).toBe('lobby');
  });

  it('lobby event reaches plain spectators and a new spectator gets it at once', () => {
    const { game } = room(1);
    const spec = new FakeSocket('watcher');
    controller.setupSocket(spec as unknown as Socket);
    spec.trigger('join.spectator', { gameId: game.id });
    expect(spec.events('lobby').length).toBeGreaterThan(0);
    expect(game.queue).toHaveLength(0);
  });
});

describe('mode by headcount', () => {
  it('1 human: solo, a bot takes seat 1, ranked false, no ELO change', () => {
    const { game, sockets } = room(1, 'solo-h');
    const before = getElo(game.players['solo-h0'].name);
    sockets[0].trigger('ready');
    expect(game.mode).toBe('solo');
    const bot = Object.values(game.players).find(p => p.isBot)!;
    expect(bot.seat).toBe(1);
    expect(bot.direction).toBe(1);
    expect(bot.position.z).toBe(1000);
    expect(lastLobby(sockets[0]).seats[1]).toMatchObject({ isBot: true, ready: true });
    vi.advanceTimersByTime(3000);
    expect(game.phase).toBe('playing');
    const start = sockets[0].events('game.start')[0].args[0];
    expect(start).toEqual({ mode: 'solo', ranked: false, arena: { kind: 'lane' } });
    expect(game.toJSON().mode).toBe('solo');
    expect(game.toJSON().players[bot.id].isBot).toBe(true);

    game.roundWins['solo-h0'] = 1;
    game.players['solo-h0'].score = 10;
    game.update(0.1);
    expect(game.checkRoundEnd()).toBe(true);
    expect(game.phase).toBe('match_over');
    const over = sockets[0].events('match.over')[0].args[0];
    expect(over).toMatchObject({ mode: 'solo', ranked: false, winner: 'solo-h0' });
    expect(over.elo).toBeUndefined();
    expect(getElo(game.players['solo-h0'].name)).toBe(before);
  });

  it('solo human in seat 2 is moved to seat 0 when the match starts', () => {
    const { game, sockets } = room(3, 'mv');
    sockets[0].trigger('exit');
    sockets[1].trigger('exit');
    expect(game.players['mv2'].seat).toBe(2);
    sockets[2].trigger('ready');
    expect(game.players['mv2'].seat).toBe(0);
    expect(game.players['mv2'].position.z).toBe(-1000);
    expect(sockets[2].events('player').at(-1)!.args[0].seat).toBe(0);
  });

  it('2 humans: duel, ranked, ELO changes as before', () => {
    const { game, sockets } = room(2, 'duel-h');
    game.players['duel-h0'].name = 'lobby-duel-w';
    game.players['duel-h1'].name = 'lobby-duel-l';
    readyAll(sockets);
    expect(game.mode).toBe('duel');
    vi.advanceTimersByTime(3000);
    expect(sockets[0].events('game.start')[0].args[0]).toEqual({ mode: 'duel', ranked: true, arena: { kind: 'lane' } });
    game.roundWins['duel-h0'] = 1;
    game.players['duel-h1'].hp = 1;
    const z = new Zombie('z', { x: 0, y: 0, z: 1499 }, 1, 'duel-h0', 1, 2, 300);
    game.zombies[z.id] = z;
    game.update(0.1);
    const over = sockets[1].events('match.over')[0].args[0];
    expect(over).toMatchObject({ mode: 'duel', ranked: true, winner: 'duel-h0' });
    expect(over.elo).toEqual({ 'duel-h0': 1016, 'duel-h1': 984 });
    expect(getElo('lobby-duel-w')).toBe(1016);
  });

  it.each([3, 4])('%i humans: brawl, unranked, nothing crashes and no ELO change', (n) => {
    const { game, sockets } = room(n, `br${n}-`);
    readyAll(sockets);
    expect(game.mode).toBe('brawl');
    expect(Object.values(game.players).some(p => p.isBot)).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(sockets[0].events('game.start')[0].args[0]).toEqual({ mode: 'brawl', ranked: false, arena: { kind: 'square' } });
    const leaderboard = JSON.stringify(controller.getLeaderboard());

    // a creature leaving the arena hurts exactly one other player, attributed to the firer
    const z = new Zombie('z', { x: 0, y: 0, z: 1499 }, 1, `br${n}-0`, 1, 2, 300);
    game.zombies[z.id] = z;
    game.update(0.1);
    const dmg = sockets[0].events('player.damage')[0].args;
    expect(dmg[2]).toBe(`br${n}-0`);
    expect(dmg[0]).not.toBe(`br${n}-0`);
    expect(game.players[dmg[0]].hp).toBe(9);
    expect(sockets[1].events('zombie.out-of-bounds')[0].args[2]).toBe(dmg[0]);

    // round ends when one player is left standing
    for (const p of Object.values(game.players)) if (p.id !== `br${n}-1`) p.hp = 0;
    expect(game.checkRoundEnd()).toBe(true);
    expect(sockets[0].events('round.end')[0].args[0].winner).toBe(`br${n}-1`);
    expect(Object.keys(sockets[0].events('round.end')[0].args[0].scores)).toHaveLength(n);

    // a decisive second round win ends the match with brawl payload
    game.phase = 'playing';
    game.roundWins[`br${n}-1`] = 1;
    expect(game.checkRoundEnd()).toBe(true);
    const over = sockets[0].events('match.over')[0].args[0];
    expect(over).toMatchObject({ mode: 'brawl', ranked: false, winner: `br${n}-1` });
    expect(over.standings).toHaveLength(n);
    expect(over.elo).toBeUndefined();
    expect(JSON.stringify(controller.getLeaderboard())).toBe(leaderboard);
  });

  it('brawl carries on while two humans remain and ends with a brawl match.over below that', () => {
    const { game, sockets } = room(3, 'bc');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    sockets[2].trigger('exit');
    expect(game.phase).toBe('playing');
    expect(game.mode).toBe('brawl');
    sockets[1].trigger('exit');
    expect(game.phase).toBe('match_over');
    const over = sockets[0].events('match.over')[0].args[0];
    expect(over).toMatchObject({ mode: 'brawl', ranked: false, winner: 'bc0' });
    expect(over.elo).toBeUndefined();
    expect(lastLobby(sockets[0]).phase).toBe('match_over');
    // results offer rematch (now solo) and return to lobby
    sockets[0].trigger('rematch');
    expect(game.phase).toBe('countdown');
    expect(game.mode).toBe('solo');
  });

  it('a brawl whose last other players leave is not stuck in countdown either', () => {
    const { game, sockets } = room(3, 'bk');
    readyAll(sockets);
    sockets[2].trigger('exit');
    sockets[1].trigger('exit');
    expect(game.phase).toBe('match_over');
    expect(game.countdownTimer).toBeNull();
    sockets[0].trigger('lobby.return');
    expect(game.phase).toBe('lobby');
  });

  it('leaving a lobby that is otherwise ready starts the countdown (duel)', () => {
    const { game, sockets } = room(3, 'lx');
    sockets[0].trigger('ready');
    sockets[1].trigger('ready');
    expect(game.phase).toBe('lobby');
    sockets[2].trigger('exit');
    expect(game.phase).toBe('countdown');
    expect(game.mode).toBe('duel');
  });

  it('a duel opponent leaving sends the remaining human to the lobby unready', () => {
    const { game, sockets } = room(2, 'ux');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    sockets[1].trigger('exit');
    expect(game.phase).toBe('lobby');
    expect(game.players['ux0'].ready).toBe(false);
  });

  it('lobby.return frees the seat of a dropped player at once and promotes the queue', () => {
    const { game, sockets } = room(3, 'dr');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    const q = join(game, 'dq');
    game.phase = 'match_over';
    sockets[2].trigger('disconnect');
    expect(game.players['dr2'].connected).toBe(false);
    sockets[0].trigger('lobby.return');
    expect(game.players['dr2']).toBeUndefined();
    expect(game.players['dq'].seat).toBe(2);
    expect(sockets[0].events('player.exit').some(e => e.args[0] === 'dr2')).toBe(true);
    expect(game.players['dq'].disconnectTimer).toBeNull();
    vi.advanceTimersByTime(20000); // the stale window timer does nothing
    expect(game.players['dq']).toBeDefined();
    // everyone ready now starts a match (nobody is held in a dropped seat)
    sockets[0].trigger('ready');
    sockets[1].trigger('ready');
    q.trigger('ready');
    expect(game.phase).toBe('countdown');
  });

  it('removing the bot tells the clients (player.exit with the bot id)', () => {
    const { game, sockets } = room(1, 'bx');
    sockets[0].trigger('ready');
    const botId = Object.values(game.players).find(p => p.isBot)!.id;
    vi.advanceTimersByTime(3000);
    sockets[0].trigger('lobby.return');
    expect(sockets[0].events('player.exit').map(e => e.args[0])).toContain(botId);
  });

  it('a player in the reconnect window cannot be hurt and nobody scores for the creature', () => {
    const { game, sockets } = room(2, 'nd');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    game.hazards = [];
    sockets[1].trigger('disconnect');
    const z = new Zombie('z', { x: 0, y: 0, z: 1499 }, 1, 'nd0', 1, 2, 300);
    game.zombies[z.id] = z;
    game.update(0.1);
    expect(game.players['nd1'].hp).toBe(10);
    expect(game.players['nd0'].score).toBe(0);
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(sockets[0].events('zombie.out-of-bounds')[0].args[2]).toBeNull();
  });

  it('no ELO change when a duel player is disconnected as the match ends', () => {
    const { game, sockets } = room(2, 'ne');
    game.players['ne0'].name = 'lobby-ne-w';
    game.players['ne1'].name = 'lobby-ne-l';
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    game.roundWins['ne0'] = 1;
    game.players['ne0'].score = 10;
    sockets[1].trigger('disconnect');
    expect(game.checkRoundEnd()).toBe(true);
    expect(game.phase).toBe('match_over');
    expect(getElo('lobby-ne-w')).toBe(1000);
    expect(getElo('lobby-ne-l')).toBe(1000);
  });

  it('createBot returns a bot player on a no-op socket', () => {
    const bot = createBot(new Game(77));
    expect(bot).toMatchObject({ isBot: true, seat: 1, id: 'bot-77' });
    expect(() => bot.socket.emit('x')).not.toThrow();
  });
});

describe('return to lobby and rematch', () => {
  it('lobby.return after match_over: everyone unready, bot gone, game.reset then lobby', () => {
    const { game, sockets } = room(1, 'lr');
    sockets[0].trigger('ready');
    vi.advanceTimersByTime(3000);
    game.phase = 'match_over';
    sockets[0].trigger('lobby.return');
    expect(game.phase).toBe('lobby');
    expect(Object.values(game.players).some(p => p.isBot)).toBe(false);
    expect(game.players['lr0'].ready).toBe(false);
    const names = sockets[0].emitted.map(e => e.event);
    expect(names.lastIndexOf('game.reset')).toBeLessThan(names.lastIndexOf('lobby'));
  });

  it('lobby.return is allowed mid-solo-match but not mid-duel', () => {
    const solo = room(1, 'sm');
    solo.sockets[0].trigger('ready');
    vi.advanceTimersByTime(3000);
    solo.sockets[0].trigger('lobby.return');
    expect(solo.game.phase).toBe('lobby');

    const duel = room(2, 'dm');
    readyAll(duel.sockets);
    vi.advanceTimersByTime(3000);
    duel.sockets[0].trigger('lobby.return');
    expect(duel.game.phase).toBe('playing');
  });

  it('solo rematch starts a new solo match with a fresh bot', () => {
    const { game, sockets } = room(1, 'sr');
    sockets[0].trigger('ready');
    vi.advanceTimersByTime(3000);
    game.phase = 'match_over';
    sockets[0].trigger('rematch');
    expect(game.phase).toBe('countdown');
    expect(Object.values(game.players).filter(p => p.isBot)).toHaveLength(1);
  });

  it('a duel rematch needs both humans to vote', () => {
    const { game, sockets } = room(2, 'dr');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    game.phase = 'match_over';
    sockets[0].trigger('rematch');
    expect(game.phase).toBe('match_over');
    sockets[1].trigger('rematch');
    expect(game.phase).toBe('countdown');
  });

  it('rematch is ignored outside match_over', () => {
    const { game, sockets } = room(2, 'ro');
    readyAll(sockets);
    vi.advanceTimersByTime(3000);
    sockets.forEach(s => s.trigger('rematch'));
    expect(game.phase).toBe('playing');
  });
});

describe('cleanup', () => {
  it('a room holding only a bot is removed after the TTL', () => {
    const game = new Game(61001);
    controller.games[game.id] = game;
    const bot = createBot(game);
    game.players[bot.id] = bot;
    game.lastActivity = Date.now() - 61000;
    game.removeIfAbandoned();
    expect(controller.games[game.id]).toBeUndefined();
  });

  it('a room with only queued spectators who then leave is removed after the TTL', () => {
    const { game, sockets } = room(4);
    const q = join(game, 'q');
    sockets.forEach(s => s.trigger('exit'));
    game.removeIfAbandoned();
    expect(controller.games[game.id]).toBe(game); // the queued spectator took a seat... and counts
    Object.values(game.players).forEach(p => game.exitPlayer(p));
    q.trigger('disconnect');
    vi.advanceTimersByTime(61000);
    game.removeIfAbandoned();
    expect(controller.games[game.id]).toBeUndefined();
  });
});
