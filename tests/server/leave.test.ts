import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Socket } from 'socket.io';
import controller, { Game, Zombie } from '../../lib/controller';
import { FakeSocket, makePlayer, makeGameWithTwoPlayers, startPlaying } from './helpers';

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

const fire = (s: FakeSocket) => s.trigger('fire', { x: 0, y: 0, z: 0 }, 1, 0);

describe('disconnect (A10)', () => {
  it('removes a player immediately and tells the others', () => {
    const { game, a, b } = makeGameWithTwoPlayers();
    a.socket.trigger('disconnect');
    expect(game.players['a']).toBeUndefined();
    expect(b.socket.events('player.exit')[0].args).toEqual(['a']);
  });

  it('removes a spectator immediately', () => {
    const { game } = makeGameWithTwoPlayers();
    const spec = makePlayer('s', 'spec', 0, 0);
    game.joinSpectator(spec.player);
    expect(game.spectators['s']).toBeDefined();
    spec.socket.trigger('disconnect');
    expect(game.spectators['s']).toBeUndefined();
  });

  it('exit followed by disconnect announces the exit once', () => {
    const { a, b } = makeGameWithTwoPlayers();
    a.socket.trigger('exit');
    a.socket.trigger('disconnect');
    expect(b.socket.events('player.exit')).toHaveLength(1);
  });
});

describe('handlers after exit (A8)', () => {
  it.each(['exit', 'disconnect'])('fire after %s creates nothing', (how) => {
    const { game, a } = startPlaying();
    a.socket.trigger(how);
    fire(a.socket);
    expect(Object.keys(game.zombies)).toHaveLength(0);
  });

  it('fire after a ping kick creates nothing', () => {
    const { game, a, b } = startPlaying();
    vi.advanceTimersByTime(5000);
    b.socket.trigger('pingpong');
    game.checkPing();
    expect(game.players['a']).toBeUndefined();
    fire(a.socket);
    expect(Object.keys(game.zombies)).toHaveLength(0);
  });

  it('a spectator who left cannot vote', () => {
    const { game } = startPlaying();
    const spec = makePlayer('s', 'spec', 0, 0);
    game.joinSpectator(spec.player);
    spec.socket.trigger('disconnect');
    spec.socket.trigger('spectator.vote', 'spawn_obstacle');
    expect(Object.keys(game.walls)).toHaveLength(0);
  });
});

describe('leaving resets to lobby (A9, B5)', () => {
  it('leave during the countdown: lobby, and the countdown never reaches playing', () => {
    const { game, a, b } = makeGameWithTwoPlayers();
    a.socket.trigger('ready');
    b.socket.trigger('ready');
    expect(game.phase).toBe('countdown');
    vi.advanceTimersByTime(1000);
    a.socket.trigger('disconnect');
    expect(game.phase).toBe('lobby');
    expect(game.countdownTimer).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(game.phase).toBe('lobby');
    expect(b.socket.events('game.start')).toHaveLength(0);
  });

  it('leave mid-round: lobby with clean state for the remaining player', () => {
    const { game, a, b } = startPlaying();
    const z = new Zombie('z', { x: 0, y: 0, z: 0 }, 1, 'a', 1, 2, 300);
    game.zombies[z.id] = z;
    game.powerUps['p'] = { id: 'p', type: 'heal', position: { x: 0, y: 0, z: 0 }, expiresAt: Date.now() + 1000 };
    game.walls['w'] = { id: 'w', position: { x: 0, y: 0, z: 0 }, width: 1, ownerId: 'b', expiresAt: Date.now() + 1000 };
    game.round = 2;
    game.roundWins['b'] = 1;
    game.stats['a'].zombiesFired = 5;
    b.player.score = 7;
    b.player.hp = 3;

    a.socket.trigger('exit');

    expect(game.phase).toBe('lobby');
    expect(game.round).toBe(1);
    expect(game.zombies).toEqual({});
    expect(game.powerUps).toEqual({});
    expect(game.walls).toEqual({});
    expect(game.roundWins).toEqual({ b: 0 });
    expect(Object.keys(game.stats)).toEqual(['b']);
    expect(game.stats['b'].zombiesFired).toBe(0);
    expect(b.player.score).toBe(0);
    expect(b.player.hp).toBe(10);
    expect(b.player.ready).toBe(true);
    expect(game.phase).toBe('lobby');
    expect(b.socket.events('game.reset')).toHaveLength(1);
  });

  it('a pending round-reset timeout is cancelled', () => {
    const { game, a, b } = startPlaying();
    a.player.hp = 0;
    expect(game.checkRoundEnd()).toBe(true);
    expect(game.phase).toBe('round_over');
    expect(game.roundResetTimer).not.toBeNull();
    a.socket.trigger('disconnect');
    expect(game.roundResetTimer).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(game.phase).toBe('lobby');
    expect(b.socket.events('round.reset')).toHaveLength(0);
  });

  it('leave at match_over: a newcomer plus ready starts a fresh match', () => {
    const { game, a, b } = startPlaying({ names: ['t5-winner', 't5-loser'] });
    game.roundWins['a'] = 1;
    a.player.score = 10;
    expect(game.checkRoundEnd()).toBe(true);
    expect(game.phase).toBe('match_over');

    a.socket.trigger('disconnect');
    expect(game.phase).toBe('lobby');
    expect(game.roundWins).toEqual({ b: 0 });

    const c = makePlayer('c', 'newcomer', -1000, -1);
    game.joinPlayer(c.player);
    // b does not send 'ready' again: only the newcomer does.
    c.socket.trigger('ready');
    expect(game.phase).toBe('countdown');
    vi.advanceTimersByTime(3000);
    expect(game.phase).toBe('playing');
    expect(game.round).toBe(1);
    expect(c.player.score).toBe(0);
  });

  it('no forfeit: leaving awards no round win and no ELO change', () => {
    const { game, a, b } = startPlaying({ names: ['t5-stayer', 't5-leaver'] });
    const before = [controller.getLeaderboard().length, JSON.stringify(controller.getLeaderboard())];
    a.socket.trigger('disconnect');
    expect(game.roundWins['b']).toBe(0);
    expect(b.socket.events('match.over')).toHaveLength(0);
    expect([controller.getLeaderboard().length, JSON.stringify(controller.getLeaderboard())]).toEqual(before);
  });

  it('leaving while already in the lobby does not emit a reset', () => {
    const { a, b } = makeGameWithTwoPlayers();
    a.socket.trigger('disconnect');
    expect(b.socket.events('game.reset')).toHaveLength(0);
  });
});
