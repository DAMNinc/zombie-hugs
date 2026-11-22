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

function addPowerUp(game: any, x = 0, z = 0, type = 'double_points') {
  game.powerUps['pu'] = { id: 'pu', type, position: { x, y: 0, z }, expiresAt: Date.now() + 10000 };
}
function addZombie(game: any, owner: string, x: number, z: number) {
  const zb = new Zombie('fox', { x, y: 0, z }, 1, owner, 1, 1, 0);
  game.zombies[zb.id] = zb;
  return zb;
}

describe('power-ups (A5)', () => {
  it('is collected by a creature passing through it, credited to its owner, creature survives', () => {
    const { game, a, b } = startPlaying();
    addPowerUp(game, 0, 0);
    const zb = addZombie(game, 'a', 50, 100);
    game.checkPowerUpCollisions();
    expect(game.powerUps['pu']).toBeUndefined();
    expect(a.socket.events('powerup.collect')[0].args).toEqual(['pu', 'a', 'double_points']);
    expect(b.socket.events('powerup.collect')).toHaveLength(1);
    expect(a.player.hasPowerUp('double_points')).toBe(true);
    expect(b.player.hasPowerUp('double_points')).toBe(false);
    expect(game.zombies[zb.id]).toBeDefined();
  });

  it("credits the opponent when the opponent's creature collects it", () => {
    const { game, a, b } = startPlaying();
    addPowerUp(game, 0, 0);
    addZombie(game, 'b', 0, -100);
    game.checkPowerUpCollisions();
    expect(b.player.hasPowerUp('double_points')).toBe(true);
    expect(a.player.hasPowerUp('double_points')).toBe(false);
  });

  it('ignores y, and does not collect when out of range', () => {
    const { game } = startPlaying();
    addPowerUp(game, 0, 0);
    addZombie(game, 'a', 400, 0);
    addZombie(game, 'a', 0, 300);
    game.checkPowerUpCollisions();
    expect(game.powerUps['pu']).toBeDefined();
    const hi = addZombie(game, 'a', 0, 0);
    hi.position.y = 500;
    game.checkPowerUpCollisions();
    expect(game.powerUps['pu']).toBeUndefined();
  });

  it('is not collected twice', () => {
    const { game, a, b } = startPlaying();
    addPowerUp(game, 0, 0);
    addZombie(game, 'a', 0, 0);
    addZombie(game, 'b', 0, 10);
    game.checkPowerUpCollisions();
    game.checkPowerUpCollisions();
    expect(a.socket.events('powerup.collect')).toHaveLength(1);
    // Both creatures are in range in the same tick; which one is first depends on the random ids' key order.
    expect(a.player.activePowerUps.length + b.player.activePowerUps.length).toBe(1);
  });

  it('players standing near it do not collect it', () => {
    const { game } = startPlaying();
    addPowerUp(game, 0, 1000);
    game.checkPowerUpCollisions();
    expect(game.powerUps['pu']).toBeDefined();
  });

  it('expired power-ups are removed from state and announced', () => {
    const { game, a } = startPlaying();
    addPowerUp(game, 0, 0);
    vi.advanceTimersByTime(10001);
    game.checkPowerUpCollisions();
    expect(game.powerUps['pu']).toBeUndefined();
    expect(a.socket.events('powerup.expire')[0].args).toEqual(['pu']);
    expect(JSON.parse(JSON.stringify(game)).powerUps).toEqual({});
  });

  it('spawns within the arena lanes', () => {
    const { game } = startPlaying();
    game.lastPowerUpSpawn = 0;
    vi.spyOn(Math, 'random').mockReturnValue(1);
    game.spawnPowerUp();
    const pu = Object.values(game.powerUps)[0] as any;
    expect(Math.abs(pu.position.x)).toBeLessThanOrEqual(490);
    expect(Math.abs(pu.position.z)).toBeLessThanOrEqual(700);
  });
});
