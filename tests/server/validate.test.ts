import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startPlaying } from './helpers';
import { ARENA_HALF_WIDTH, ARENA_MARGIN } from '../../lib/validate';

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

const LIMIT = ARENA_HALF_WIDTH - ARENA_MARGIN;

describe('fire validation (B2, A7)', () => {
  it.each([
    ['string x', { x: 'abc', y: 0, z: null }, 1, 0],
    ['NaN x', { x: NaN, y: 0, z: 0 }, 1, 0],
    ['null position', null, 1, 0],
    ['missing position', undefined, 1, 0],
    ['empty position', {}, 1, 0],
    ['weapon 0', { x: 0 }, 0, 0],
    ['weapon 6', { x: 0 }, 6, 0],
    ['weapon 1.5', { x: 0 }, 1.5, 0],
    ["weapon '1'", { x: 0 }, '1', 0],
    ['weapon missing', { x: 0 }, undefined, 0],
    ['NaN charge', { x: 0 }, 1, NaN],
    ['string charge', { x: 0 }, 1, '3000'],
  ])('drops %s', (_n, pos, code, charge) => {
    const { game, a } = startPlaying();
    a.socket.trigger('fire', pos, code, charge);
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(game.stats['a'].zombiesFired).toBe(0);
    expect(a.player.lastFireTime).toBe(0);
  });

  it('clamps negative and huge charge', () => {
    const { game, a } = startPlaying();
    a.socket.trigger('fire', { x: 0 }, 1, -5000);
    expect(Object.values(game.zombies)[0].chargeRatio).toBe(0);
    vi.advanceTimersByTime(1000);
    a.socket.trigger('fire', { x: 0 }, 1, 1e12);
    // 1000 ms since the last shot caps it
    expect(Object.values(game.zombies)[1].chargeRatio).toBeCloseTo(1000 / 3000);
  });

  it('first shot of a round can charge to the maximum', () => {
    const { game, a } = startPlaying();
    a.socket.trigger('fire', { x: 0 }, 1, 3000);
    expect(Object.values(game.zombies)[0].chargeRatio).toBe(1);
  });

  it('caps charge at the time since the last shot', () => {
    const { game, a } = startPlaying();
    a.socket.trigger('fire', { x: 0 }, 1, 0);
    vi.advanceTimersByTime(1500);
    a.socket.trigger('fire', { x: 0 }, 1, 3000);
    expect(Object.values(game.zombies)[1].chargeRatio).toBeCloseTo(0.5);
  });

  it('takes z from the server player, not the client', () => {
    const { game, a, b } = startPlaying();
    a.socket.trigger('fire', { x: 0, y: 99, z: -1499 }, 1, 0);
    b.socket.trigger('fire', { x: 0, y: 0, z: 0 }, 1, 0);
    const zs = Object.values(game.zombies);
    expect(zs.find(z => z.firedByPlayer === 'a')!.position.z).toBe(-1000);
    expect(zs.find(z => z.firedByPlayer === 'a')!.position.y).toBe(0);
    expect(zs.find(z => z.firedByPlayer === 'b')!.position.z).toBe(1000);
  });

  it('clamps x to within 150 of the server player and to the arena', () => {
    const { game, a } = startPlaying();
    a.socket.trigger('fire', { x: 400 }, 1, 0);
    expect(Object.values(game.zombies)[0].position.x).toBe(150);
    vi.advanceTimersByTime(1000);
    a.socket.trigger('fire', { x: -Infinity }, 1, 0); // not finite -> dropped
    expect(Object.keys(game.zombies)).toHaveLength(1);
    a.player.position.x = LIMIT;
    vi.advanceTimersByTime(1000);
    a.socket.trigger('fire', { x: 1e9 }, 1, 0);
    expect(Object.values(game.zombies)[1].position.x).toBe(LIMIT);
  });
});

describe('other payloads', () => {
  it('weapon.set with an invalid code is not broadcast', () => {
    const { b, a } = startPlaying();
    for (const bad of [42, 0, 1.5, '2', null, undefined, NaN]) a.socket.trigger('weapon.set', bad);
    expect(b.socket.events('weapon.set')).toHaveLength(0);
    expect(a.player.weaponCode).not.toBe(42);
    a.socket.trigger('weapon.set', 3);
    expect(b.socket.events('weapon.set')[0].args).toEqual([3, 'a']);
  });

  it('place.wall drops non-finite x and clamps the rest', () => {
    const { game, a } = startPlaying();
    a.player.score = 20;
    for (const bad of ['x', NaN, null, undefined, Infinity]) a.socket.trigger('place.wall', bad);
    expect(Object.keys(game.walls)).toHaveLength(0);
    expect(a.player.score).toBe(20);
    a.socket.trigger('place.wall', 99999);
    expect(Object.values(game.walls)[0].position.x).toBe(LIMIT);
  });

  it('move.* ignores non-number key codes', () => {
    const { b, a } = startPlaying();
    a.socket.trigger('move.start', 'abc');
    a.socket.trigger('move.start', null);
    expect(b.socket.events('move.start')).toHaveLength(0);
    a.socket.trigger('move.start', 65);
    expect(b.socket.events('move.start')).toHaveLength(1);
  });
});

describe('arena clamp (A13)', () => {
  it('player x stops at the edge when a move key is held', () => {
    const { game, a, b } = startPlaying();
    a.socket.trigger('move.start', 68); // right; direction -1 => x decreases
    b.socket.trigger('move.start', 68); // direction 1 => x increases
    for (let i = 0; i < 100; i++) game.update(0.1);
    expect(a.player.position.x).toBe(-LIMIT);
    expect(b.player.position.x).toBe(LIMIT);
  });
});
