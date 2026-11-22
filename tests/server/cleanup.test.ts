import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import controller, { Game, MAX_GAMES, MAX_GAME_NAME_LENGTH } from '../../lib/controller';
import { makePlayer, startPlaying } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

const SIXTY = 60000;

function newStartedGame(): Game {
  const id = controller.newGame('t')!;
  return controller.games[id];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => {
  for (const id of Object.keys(controller.games)) {
    controller.games[Number(id)].stop();
    delete controller.games[Number(id)];
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('empty game cleanup (B3)', () => {
  it('deletes a game nobody joined after 60 s and stops its timers', () => {
    const game = newStartedGame();
    const spy = vi.spyOn(game, 'emitAll');
    vi.advanceTimersByTime(SIXTY - 1000);
    expect(controller.games[game.id]).toBe(game);
    vi.advanceTimersByTime(6000);
    expect(controller.games[game.id]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    spy.mockClear();
    vi.advanceTimersByTime(5000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps a game that has a player', () => {
    const game = newStartedGame();
    const { player } = makePlayer('p', 'Pat');
    game.joinPlayer(player);
    for (let i = 0; i < 180; i++) {
      player.lastPing = Date.now(); // a live client keeps pinging
      vi.advanceTimersByTime(1000);
    }
    expect(controller.games[game.id]).toBe(game);
    expect(game.players['p']).toBe(player);
  });

  it('keeps a game with a spectator', () => {
    const game = newStartedGame();
    const { player } = makePlayer('s', 'Spec', 0, 0);
    game.joinSpectator(player);
    vi.advanceTimersByTime(SIXTY * 3);
    expect(controller.games[game.id]).toBe(game);
  });

  it('deletes a game 60 s after it became empty, not earlier', () => {
    const game = newStartedGame();
    const { player, socket } = makePlayer('s', 'Spec', 0, 0);
    game.joinSpectator(player);
    vi.advanceTimersByTime(30000);
    socket.trigger('disconnect');
    vi.advanceTimersByTime(SIXTY - 6000);
    expect(controller.games[game.id]).toBe(game);
    vi.advanceTimersByTime(12000);
    expect(controller.games[game.id]).toBeUndefined();
  });

  it('does not delete a game someone rejoined', () => {
    const game = newStartedGame();
    const first = makePlayer('p', 'Pat');
    game.joinPlayer(first.player);
    first.socket.trigger('disconnect');
    vi.advanceTimersByTime(SIXTY - 6000);
    const spec = makePlayer('s', 'Spec', 0, 0);
    game.joinSpectator(spec.player);
    vi.advanceTimersByTime(SIXTY * 2);
    expect(controller.games[game.id]).toBe(game);
  });

  it('stop() clears countdown and round-reset timers too', () => {
    const { game, a, b } = startPlaying();
    game.start();
    game.startCountdown();
    game.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(game.countdownTimer).toBeNull();
    expect(a.socket && b.socket).toBeTruthy();
  });

  it('a client rejoining a deleted game gets join.error.notfound', () => {
    const game = newStartedGame();
    const id = game.id;
    vi.advanceTimersByTime(SIXTY + 6000);
    const socket = makePlayer('x', 'X').socket;
    controller.setupSocket(socket as any);
    socket.trigger('join.player', id);
    expect(socket.events('join.error.notfound').length).toBe(1);
  });
});

describe('game cap and names (B3, B7)', () => {
  it('refuses new games beyond the cap', () => {
    for (let i = 0; i < MAX_GAMES; i++) expect(controller.newGame()).not.toBeNull();
    expect(controller.newGame()).toBeNull();
  });

  it('trims and caps gameName, empty falls back to the default', () => {
    expect(controller.games[controller.newGame('  Hello  ')!].gameName).toBe('Hello');
    expect(controller.games[controller.newGame('x'.repeat(100))!].gameName).toBe('x'.repeat(MAX_GAME_NAME_LENGTH));
    expect(controller.games[controller.newGame('   ')!].gameName).toBe('That DAMN game');
    expect(controller.games[controller.newGame(undefined)!].gameName).toBe('That DAMN game');
  });
});

describe('update errors (B4)', () => {
  it('a throw inside update does not freeze the game', () => {
    const { game } = startPlaying();
    const spy = vi.spyOn(game, 'spawnPowerUp').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => game.update(0.1)).not.toThrow();
    expect(game.updating).toBe(false);
    game.update(0.1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
