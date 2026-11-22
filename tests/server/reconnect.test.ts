import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Socket } from 'socket.io';
import controller, { Game, RECONNECT_WINDOW_MS } from '../../lib/controller';
import { FakeSocket } from './helpers';

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

function connect(id: string) {
  const s = new FakeSocket(id);
  controller.setupSocket(s as unknown as Socket);
  return s;
}
function room(n: number, prefix = 'r') {
  const game = new Game(7000 + Math.floor(Math.random() * 1e6), 'reconnect-test');
  controller.games[game.id] = game;
  const sockets = Array.from({ length: n }, (_, i) => {
    const s = connect(`${prefix}${i}`);
    s.trigger('join.player', { gameId: game.id });
    return s;
  });
  return { game, sockets };
}
function playing(n: number, prefix = 'r') {
  const ctx = room(n, prefix);
  ctx.sockets.forEach(s => s.trigger('ready'));
  vi.advanceTimersByTime(3000);
  ctx.game.hazards = [];
  ctx.game.lastPowerUpSpawn = Date.now();
  return ctx;
}
const tokenOf = (s: FakeSocket) => s.events('player')[0].args[0].token as string;

describe('reconnect window', () => {
  it('a drop mid-match keeps the seat for 15 s and announces it', () => {
    const { game, sockets } = playing(2);
    sockets[0].trigger('disconnect');
    const p = game.players['r0'];
    expect(p).toBeDefined();
    expect(p.connected).toBe(false);
    const ev = sockets[1].events('player.disconnected')[0].args[0];
    expect(ev.id).toBe('r0');
    expect(ev.until).toBe(Date.now() + RECONNECT_WINDOW_MS);
    expect(sockets[1].events('lobby').at(-1)!.args[0].seats[0].connected).toBe(false);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS - 1);
    expect(game.players['r0']).toBe(p);
    expect(game.phase).toBe('playing');
  });

  it('rejoining with the token on a new socket keeps seat, score and hp', () => {
    const { game, sockets } = playing(2);
    const token = tokenOf(sockets[0]);
    game.players['r0'].score = 6;
    game.players['r0'].hp = 4;
    const roundWins = game.roundWins['r0'] = 1;
    sockets[0].trigger('disconnect');
    vi.advanceTimersByTime(5000);

    const fresh = connect('fresh');
    fresh.trigger('join.player', { gameId: game.id, token });
    const p = game.players['r0'];
    expect(p.connected).toBe(true);
    expect(p.socket).toBe(fresh);
    expect(p.score).toBe(6);
    expect(p.hp).toBe(4);
    expect(game.roundWins['r0']).toBe(roundWins);
    const self = fresh.events('player')[0].args[0];
    expect(self).toMatchObject({ id: 'r0', seat: 0, score: 6, hp: 4, token });
    expect(fresh.events('opponent').map(e => e.args[0].id)).toEqual(['r1']);
    expect(fresh.events('hazards')).toHaveLength(1);
    expect(sockets[1].events('player.reconnected')[0].args).toEqual(['r0']);
    expect(game.phase).toBe('playing');

    // the window timer is gone: nothing happens afterwards
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS * 2);
    expect(game.players['r0']).toBe(p);

    // the new socket can act
    fresh.trigger('fire', { x: 0, y: 0, z: -1000 }, 1, 0);
    expect(Object.keys(game.zombies)).toHaveLength(1);
    expect(Object.values(game.zombies)[0].firedByPlayer).toBe('r0');
  });

  it('the old socket can never act after the seat moved to a new socket', () => {
    const { game, sockets } = playing(2);
    const token = tokenOf(sockets[0]);
    const old = sockets[0];
    const fresh = connect('fresh');
    fresh.trigger('join.player', { gameId: game.id, token }); // reload before the server saw the drop
    old.trigger('fire', { x: 0, y: 0, z: -1000 }, 1, 0);
    old.trigger('move.start', 37);
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(game.players['r0'].left).toBe(false);
    old.trigger('disconnect'); // late close of the replaced socket changes nothing
    expect(game.players['r0'].connected).toBe(true);
  });

  it('a dropped socket cannot act while the seat is held', () => {
    const { game, sockets } = playing(2);
    sockets[0].trigger('disconnect');
    sockets[0].trigger('fire', { x: 0, y: 0, z: -1000 }, 1, 0);
    sockets[0].trigger('exit');
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(game.players['r0']).toBeDefined();
  });

  it('a wrong or malformed token is treated as a fresh join (queued mid-match)', () => {
    const { game } = playing(2);
    for (const token of ['nope', '', 5, null, { a: 1 }, 'x'.repeat(500)]) {
      const s = connect('t' + String(Math.random()));
      s.trigger('join.player', { gameId: game.id, token });
      expect(s.events('join.queued')).toHaveLength(1);
    }
    expect(Object.keys(game.players)).toEqual(['r0', 'r1']);
  });

  it('after the window a duel behaves like an exit: lobby for the remaining player', () => {
    const { game, sockets } = playing(2);
    sockets[0].trigger('disconnect');
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(game.players['r0']).toBeUndefined();
    expect(sockets[1].events('player.exit')[0].args).toEqual(['r0']);
    expect(game.phase).toBe('lobby');
    expect(sockets[1].events('game.reset')).toHaveLength(1);
  });

  it('a late token after the window no longer claims the seat', () => {
    const { game, sockets } = playing(2);
    const token = tokenOf(sockets[0]);
    sockets[0].trigger('disconnect');
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    const fresh = connect('fresh');
    fresh.trigger('join.player', { gameId: game.id, token });
    expect(game.players['r0']).toBeUndefined();
    expect(game.players['fresh']?.seat).toBe(0); // simply a new seated join into the lobby
    expect(fresh.events('player')[0].args[0].token).not.toBe(token);
  });

  it('brawl: after the window the match continues while two humans remain, ends with match.over below', () => {
    const { game, sockets } = playing(3, 'b');
    sockets[2].trigger('disconnect');
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(game.players['b2']).toBeUndefined();
    expect(game.phase).toBe('playing');
    sockets[1].trigger('disconnect');
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(game.phase).toBe('match_over');
    expect(sockets[0].events('match.over')[0].args[0]).toMatchObject({ mode: 'brawl', winner: 'b0', ranked: false });
    expect(Object.keys(game.players)).toEqual(['b0']);
  });

  it('in the lobby a disconnect frees the seat immediately', () => {
    const { game, sockets } = room(3, 'l');
    sockets[1].trigger('disconnect');
    expect(game.players['l1']).toBeUndefined();
    expect(sockets[0].events('lobby').at(-1)!.args[0].seats[1]).toBeNull();
    expect(sockets[0].events('player.disconnected')).toHaveLength(0);
  });

  it('ping timeout is a disconnect with the same window, and a ping revives it', () => {
    const { game, sockets } = playing(2);
    vi.advanceTimersByTime(5000);
    sockets[1].trigger('pingpong');
    game.checkPing();
    expect(game.players['r0'].connected).toBe(false);
    expect(sockets[1].events('player.disconnected')).toHaveLength(1);
    sockets[0].trigger('pingpong');
    expect(game.players['r0'].connected).toBe(true);
    expect(sockets[1].events('player.reconnected')).toHaveLength(1);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS * 2);
    expect(game.players['r0']).toBeDefined();
  });

  it('ping timeout in the lobby frees the seat like today', () => {
    const { game, sockets } = room(2, 'pl');
    vi.advanceTimersByTime(5000);
    sockets[1].trigger('pingpong');
    game.checkPing();
    expect(game.players['pl0']).toBeUndefined();
  });

  it('a held seat blocks a rematch until the player is back or gone', () => {
    const { game, sockets } = playing(2);
    game.phase = 'match_over';
    sockets[0].trigger('disconnect');
    sockets[1].trigger('rematch');
    expect(game.phase).toBe('match_over');
  });

  it('a player who reconnects in match_over gets the results again and can vote the rematch through', () => {
    const { game, sockets } = playing(3, 'm');
    const token = tokenOf(sockets[2]);
    game.endBrawlMatch('m0');
    expect(game.phase).toBe('match_over');
    sockets[2].trigger('disconnect');
    expect(game.players['m2'].connected).toBe(false);

    const fresh = connect('mfresh');
    fresh.trigger('join.player', { gameId: game.id, token });
    expect(game.players['m2'].socket).toBe(fresh);
    const replay = fresh.events('match.over');
    expect(replay).toHaveLength(1);
    expect(replay[0].args[0]).toMatchObject({ mode: 'brawl', winner: 'm0', ranked: false });

    sockets[0].trigger('rematch');
    sockets[1].trigger('rematch');
    expect(game.phase).toBe('match_over');
    fresh.trigger('rematch');
    expect(game.phase).not.toBe('match_over');
    expect(game.lastMatchOver).toBeNull();
    expect(sockets[0].events('game.rematch')).toHaveLength(1);
  });

  it('stop() clears pending reconnect timers', () => {
    const { game, sockets } = playing(2);
    sockets[0].trigger('disconnect');
    expect(game.players['r0'].disconnectTimer).not.toBeNull();
    game.stop();
    expect(game.players['r0'].disconnectTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a held seat keeps the room alive; once released the TTL applies', () => {
    const { game, sockets } = room(1, 'h');
    game.start();
    sockets[0].trigger('ready');
    vi.advanceTimersByTime(3000);
    sockets[0].trigger('disconnect');
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(game.players['h0']).toBeUndefined();
    expect(controller.games[game.id]).toBe(game);
    vi.advanceTimersByTime(70000);
    expect(controller.games[game.id]).toBeUndefined();
  });
});
