import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Zombie } from '../../lib/controller';
import { startPlaying } from './helpers';

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

// A's creatures move with direction -1, B's with +1; two overlapping ones collide.
function collide(game: any, healthA: number, healthB: number) {
  const za = new Zombie('fox', { x: 0, y: 0, z: 0 }, -1, 'a', healthA, 1, 0);
  const zb = new Zombie('fox', { x: 0, y: 0, z: 10 }, 1, 'b', healthB, 1, 0);
  game.zombies[za.id] = za;
  game.zombies[zb.id] = zb;
  game.update(0);
}

describe('stats.zombiesDestroyed (A15f)', () => {
  it('credits only the owner of the creature that killed, when one dies', () => {
    const { game } = startPlaying();
    collide(game, 1, 2); // a's creature dies, b's survives
    expect(game.stats['b'].zombiesDestroyed).toBe(1);
    expect(game.stats['a'].zombiesDestroyed).toBe(0);
  });

  it('credits both owners when both creatures die', () => {
    const { game } = startPlaying();
    collide(game, 1, 1);
    expect(game.stats['a'].zombiesDestroyed).toBe(1);
    expect(game.stats['b'].zombiesDestroyed).toBe(1);
  });

  it('credits nobody when both survive the hit', () => {
    const { game } = startPlaying();
    collide(game, 3, 3);
    expect(game.stats['a'].zombiesDestroyed).toBe(0);
    expect(game.stats['b'].zombiesDestroyed).toBe(0);
  });
});
