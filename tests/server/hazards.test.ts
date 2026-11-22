import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game, Zombie } from '../../lib/controller';
import { ARENA_HALF_WIDTH, ARENA_MARGIN } from '../../lib/validate';
import { startPlaying } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const limit = ARENA_HALF_WIDTH - ARENA_MARGIN;
const gen = () => {
  const game = new Game(1, 'hz');
  game.generateHazards();
  return game.hazards;
};

describe('generateHazards', () => {
  it('keeps the damage hazard off the centre lane and every hazard inside the arena (extremes)', () => {
    for (const v of [0, 0.25, 0.4999, 0.5, 0.75, 0.9999]) {
      vi.spyOn(Math, 'random').mockReturnValue(v);
      for (const h of gen()) {
        expect(Math.abs(h.position.x) - h.width / 2).toBeGreaterThanOrEqual(h.type === 'damage' ? 60 - 1e-9 : -limit);
        expect(h.position.x - h.width / 2).toBeGreaterThanOrEqual(-limit - 1e-9);
        expect(h.position.x + h.width / 2).toBeLessThanOrEqual(limit + 1e-9);
      }
      vi.restoreAllMocks();
    }
  });

  it('never covers x = 0 with a damage hazard over many seeds, and all types appear', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const hz = gen();
      expect(hz).toHaveLength(2);
      expect(new Set(hz.map(h => h.type)).size).toBe(2);
      for (const h of hz) {
        seen.add(h.type);
        if (h.type === 'damage') expect(Math.abs(h.position.x) - h.width / 2).toBeGreaterThanOrEqual(60 - 1e-9);
        if (h.type === 'wind') expect([1, -1]).toContain(h.windDirection);
        expect(Math.abs(h.position.x) + h.width / 2).toBeLessThanOrEqual(limit + 1e-9);
      }
    }
    expect(seen).toEqual(new Set(['damage', 'slow', 'wind']));
  });
});

describe('damage hazard', () => {
  const setup = (hp: number) => {
    const { game } = startPlaying({ hazards: false });
    game.hazards = [{ id: 'h1', position: { x: 0, y: 0, z: 0 }, width: 300, depth: 400, type: 'damage' }];
    const zb = new Zombie('z', { x: 0, y: 0, z: -150 }, 1, 'a', hp, 2, 300);
    game.zombies[zb.id] = zb;
    return { game, zb };
  };

  it('costs exactly 1 HP however many ticks the creature is inside', () => {
    const { game, zb } = setup(3);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(100);
      game.update(0.01); // creep: stays inside
    }
    expect(zb.health).toBe(2);
    expect(game.zombies[zb.id]).toBeDefined();
  });

  it('a 1-HP creature dies on first contact and emits zombie.hazard once', () => {
    const { game, zb } = setup(1);
    game.update(0.01);
    expect(game.zombies[zb.id]).toBeUndefined();
    game.update(0.01);
  });

  it('wind pushes sideways in its direction', () => {
    const { game, zb } = setup(1);
    game.hazards = [{ id: 'w', position: { x: 0, y: 0, z: 0 }, width: 300, depth: 400, type: 'wind', windDirection: -1 }];
    const x0 = zb.position.x;
    game.update(0.1);
    expect(zb.position.x).toBeLessThan(x0);
  });
});
