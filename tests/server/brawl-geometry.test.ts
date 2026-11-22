import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game, Zombie } from '../../lib/controller';
import { exitedEdge, headingTo, validFireLateral } from '../../lib/arena';
import { makePlayer, startBrawl } from './helpers';

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

const zombieIn = (game: Game, ownerId: string, x: number, z: number, vx: number, vz: number, weaponCode = 4) => {
  const zb = new Zombie('z', { x, y: 0, z }, 1, ownerId, 1, weaponCode, 300);
  zb.setHeading(vx, vz, null);
  game.zombies[zb.id] = zb;
  return zb;
};

describe('brawl seating and movement', () => {
  it('seats 4 players on N, S, W, E edge lines', () => {
    const { game, ps } = startBrawl(4);
    expect(game.mode).toBe('brawl');
    expect(ps.map(p => p.player.edge)).toEqual(['N', 'S', 'W', 'E']);
    expect(ps.map(p => p.player.position)).toEqual([
      { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 1000 }, { x: -1000, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 },
    ]);
  });

  it('seats 3 players on N, S, W', () => {
    const { game, ps } = startBrawl(3);
    expect(game.mode).toBe('brawl');
    expect(ps.map(p => p.player.edge)).toEqual(['N', 'S', 'W']);
  });

  it('moves left/right per edge on the right axis and clamps at ±800', () => {
    const { game, ps } = startBrawl(4);
    const moves = [
      // [seat, key, axis, expected sign]
      [0, 'left', 'x', 1], [0, 'right', 'x', -1],
      [1, 'left', 'x', -1], [1, 'right', 'x', 1],
      [2, 'left', 'z', -1], [2, 'right', 'z', 1],
      [3, 'left', 'z', 1], [3, 'right', 'z', -1],
    ] as const;
    for (const [seat, key, axis, sign] of moves) {
      const { player } = ps[seat];
      player.position[axis] = 0;
      player[key] = true;
      player.update(1, true);
      expect(player.position[axis]).toBeCloseTo(sign * 100);
      player[key] = false;
    }
    // Edge coordinate never changes; lateral clamps at EDGE_TRAVEL.
    const w = ps[2].player;
    w.right = true;
    w.update(100, true);
    expect(w.position).toEqual({ x: -1000, y: 0, z: 800 });
    w.right = false;
    w.left = true;
    w.update(1000, true);
    expect(w.position.z).toBe(-800);
    void game;
  });

  it('a lane player (brawl flag off) still moves along x only', () => {
    const { player } = makePlayer('d', 'd', -1000, -1);
    player.left = true;
    player.update(1);
    expect(player.position.x).toBeCloseTo(100);
  });
});

describe('brawl targeting', () => {
  it('defaults to the next opponent clockwise N→E→S→W', () => {
    const { ps } = startBrawl(4);
    expect(ps.map(p => p.player.targetId)).toEqual(['p3', 'p2', 'p0', 'p1']);
  });

  it('compacts 3 players left over from a 4-seat lobby to N, S, W', () => {
    const game = new Game(5, 'compact');
    const ps = Array.from({ length: 4 }, (_, i) => makePlayer(`q${i}`));
    for (const p of ps) game.joinPlayer(p.player);
    ps[2].socket.trigger('exit'); // W leaves, E (seat 3) stays
    for (const p of [ps[0], ps[1], ps[3]]) p.socket.trigger('ready');
    vi.advanceTimersByTime(3000);
    expect(game.mode).toBe('brawl');
    expect([ps[0], ps[1], ps[3]].map(p => p.player.edge)).toEqual(['N', 'S', 'W']);
    expect(ps[3].player.position).toEqual({ x: -1000, y: 0, z: 0 });
  });

  it('with 3 players skips the empty E seat', () => {
    const { ps } = startBrawl(3);
    expect(ps.map(p => p.player.targetId)).toEqual(['p1', 'p2', 'p0']);
  });

  it('target.set accepts a seated opponent and broadcasts it', () => {
    const { ps } = startBrawl(4);
    ps[0].socket.trigger('target.set', 'p1');
    expect(ps[0].player.targetId).toBe('p1');
    expect(ps[2].socket.events('target').at(-1)!.args).toEqual(['p0', 'p1']);
    expect(ps[0].player.toJSON().targetId).toBe('p1');
  });

  it('target.set ignores invalid ids: self, unknown, non-string, prototype keys, dead player', () => {
    const { ps } = startBrawl(4);
    for (const bad of ['p0', 'nobody', 5, null, undefined, {}, ['p1'], '__proto__', 'constructor']) {
      ps[0].socket.trigger('target.set', bad);
      expect(ps[0].player.targetId).toBe('p3');
    }
    ps[1].player.alive = false;
    ps[0].socket.trigger('target.set', 'p1');
    expect(ps[0].player.targetId).toBe('p3');
  });

  it('target.set is ignored in a duel', () => {
    const game = new Game(2, 'duel');
    const a = makePlayer('a');
    const b = makePlayer('b');
    game.joinPlayer(a.player);
    game.joinPlayer(b.player);
    a.socket.trigger('ready');
    b.socket.trigger('ready');
    vi.advanceTimersByTime(3000);
    a.socket.trigger('target.set', 'b');
    expect(a.player.targetId).toBeNull();
    expect(a.socket.events('target')).toHaveLength(0);
  });

  it('retargets clockwise when the target exits', () => {
    const { game, ps } = startBrawl(4);
    // p0 (N) aims at p3 (E); E leaves → next clockwise after E is S (p1).
    ps[3].socket.trigger('exit');
    expect(game.players['p3']).toBeUndefined();
    expect(ps[0].player.targetId).toBe('p1');
    expect(ps[0].socket.events('target').at(-1)!.args).toEqual(['p0', 'p1']);
    // p1 (S) aimed at p2 (W), unaffected.
    expect(ps[1].player.targetId).toBe('p2');
  });

  it('skips a not-alive target on refresh (KO hook)', () => {
    const { game, ps } = startBrawl(4);
    ps[3].player.alive = false;
    game.refreshTargets();
    expect(ps[0].player.targetId).toBe('p1');
    expect(ps[2].player.targetId).toBe('p0'); // W's default target was N, still alive
  });
});

describe('brawl firing', () => {
  const fire = (p: ReturnType<typeof makePlayer>, lateralKey: 'x' | 'z', value: number, code = 4) => {
    p.socket.trigger('fire', { x: 0, y: 0, z: 0, [lateralKey]: value }, code);
  };

  it('spawns on the firer edge and heads at the target for each edge pair', () => {
    const { game, ps } = startBrawl(4);
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        if (a === b) continue;
        game.zombies = {};
        ps[a].player.lastFireTime = 0;
        ps[a].player.targetId = ps[b].player.id;
        const lat = ps[a].player.edge === 'N' || ps[a].player.edge === 'S' ? 'x' : 'z';
        fire(ps[a], lat, 0);
        const zs = Object.values(game.zombies);
        expect(zs).toHaveLength(1);
        const z = zs[0];
        expect(z.position).toEqual({ ...ps[a].player.position, y: 0 });
        const dx = ps[b].player.position.x - z.position.x;
        const dz = ps[b].player.position.z - z.position.z;
        const len = Math.hypot(dx, dz);
        expect(z.vx).toBeCloseTo(dx / len);
        expect(z.vz).toBeCloseTo(dz / len);
        expect(z.firedByPlayer).toBe(ps[a].player.id);
        expect(z.toJSON()).toMatchObject({ ownerId: ps[a].player.id, targetId: ps[b].player.id });
      }
    }
  });

  it('validates the lateral coordinate on a W edge (drift clamp, travel clamp, junk)', () => {
    const { game, ps } = startBrawl(4);
    const w = ps[2];
    fire(w, 'z', 9999); // server lateral is 0 → drift clamp to 150
    let z = Object.values(game.zombies)[0];
    expect(z.position).toEqual({ x: -1000, y: 0, z: 150 });
    game.zombies = {};
    w.player.lastFireTime = 0;
    w.player.position.z = 700;
    fire(w, 'z', 9999); // 700+150 → clamps to 800
    z = Object.values(game.zombies)[0];
    expect(z.position.z).toBe(800);
    game.zombies = {};
    w.player.lastFireTime = 0;
    w.socket.trigger('fire', { x: 5 }, 4); // lateral axis missing → dropped
    w.socket.trigger('fire', { z: 'a' }, 4);
    expect(Object.keys(game.zombies)).toHaveLength(0);
  });

  it('with no target flies straight across; horde spreads along the lateral axis', () => {
    const { game, ps } = startBrawl(4);
    ps[2].player.targetId = null;
    fire(ps[2], 'z', 0, 5);
    const zs = Object.values(game.zombies);
    expect(zs).toHaveLength(5);
    for (const z of zs) {
      expect(z.vx).toBe(1);
      expect(z.vz).toBe(0);
      expect(z.position.x).toBe(-1000);
    }
    expect(zs.map(z => z.position.z).sort((a, b) => a - b)).toEqual([-120, -60, 0, 60, 120]);
  });

  it('fox zig-zag is perpendicular to its heading', () => {
    const z = new Zombie('fox', { x: 0, y: 0, z: 0 }, 1, 'o', 1, 1, 300);
    z.setHeading(1, 0, null);
    vi.advanceTimersByTime(400);
    z.update(0.1);
    expect(z.position.x).toBeCloseTo(30, 5);
    expect(Math.abs(z.position.z)).toBeGreaterThan(0); // sin offset along z
    expect(Math.abs(z.position.z)).toBeLessThanOrEqual(50);
  });
});

describe('brawl hits', () => {
  const tick = (game: Game) => game.update(0.1);

  it.each([
    ['N', 0, -1140, 0, -1, 'p0'],
    ['S', 0, 1140, 0, 1, 'p1'],
    ['W', -1140, 0, -1, 0, 'p2'],
    ['E', 1140, 0, 1, 0, 'p3'],
  ])('leaving through %s hits that owner and credits the firer', (_e, x, z, vx, vz, victim) => {
    const { game, ps } = startBrawl(4);
    // Fire from a seat that is not the victim.
    const firer = ps.find(p => p.player.id !== victim)!;
    const hp = game.players[victim].hp;
    zombieIn(game, firer.player.id, x, z, vx, vz);
    tick(game);
    expect(game.players[victim].hp).toBe(hp - 1);
    expect(firer.player.score).toBe(1);
    expect(game.stats[firer.player.id].zombiesScored).toBe(1);
    expect(ps[0].socket.events('player.damage').at(-1)!.args).toEqual([victim, hp - 1, firer.player.id]);
    expect(ps[0].socket.events('zombie.out-of-bounds').at(-1)!.args.slice(1)).toEqual([firer.player.id, victim]);
    expect(game.standings().find(s => s.id === firer.player.id)!.hits).toBe(1);
  });

  it('own edge and empty edge are misses without damage or score', () => {
    const { game, ps } = startBrawl(3); // no E player
    zombieIn(game, 'p0', 0, -1140, 0, -1); // own edge
    zombieIn(game, 'p0', 1140, 0, 1, 0); // empty E edge
    tick(game);
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(ps.map(p => p.player.hp)).toEqual([10, 10, 10]);
    expect(ps[0].player.score).toBe(0);
    const outs = ps[1].socket.events('zombie.out-of-bounds').map(e => e.args[2]);
    expect(outs).toEqual([null, null]);
  });

  it('a knocked-out owner cannot be hit and a disconnected one is shielded without scoring', () => {
    const { game, ps } = startBrawl(4);
    ps[1].player.alive = false;
    zombieIn(game, 'p0', 0, 1140, 0, 1);
    ps[2].player.connected = false;
    zombieIn(game, 'p0', -1140, 0, -1, 0);
    tick(game);
    expect(ps.map(p => p.player.hp)).toEqual([10, 10, 10, 10]);
    expect(ps[0].player.score).toBe(0);
  });

  it('exitedEdge uses the larger excess in a corner', () => {
    expect(exitedEdge({ x: 1200, z: -1160 })).toBe('E');
    expect(exitedEdge({ x: 1160, z: -1200 })).toBe('N');
    expect(exitedEdge({ x: 1150, z: 1150 })).toBeNull();
  });
});

describe('brawl collisions, walls and shields', () => {
  it('creatures of different owners collide, same owner does not', () => {
    const { game } = startBrawl(4);
    const a = zombieIn(game, 'p0', 0, 0, 0, 1);
    const b = zombieIn(game, 'p1', 40, 20, 0, -1);
    const c = zombieIn(game, 'p0', 500, 500, 0, 1);
    const d = zombieIn(game, 'p0', 510, 500, 0, 1);
    expect(a.isCollision(b)).toBe(true);
    expect(c.isCollision(d)).toBe(false);
    game.update(0.001);
    expect(game.zombies[a.id]).toBeUndefined();
    expect(game.zombies[b.id]).toBeUndefined();
    expect(game.zombies[c.id]).toBeDefined();
  });

  it('wall on W is placed 200 in front along +x and extends along z', () => {
    const { game, ps } = startBrawl(4);
    ps[2].player.score = 5;
    ps[2].socket.trigger('place.wall', 300);
    const wall = Object.values(game.walls)[0];
    expect(wall).toMatchObject({ axis: 'z', position: { x: -800, z: 300 }, ownerId: 'p2' });
    expect(ps[0].socket.events('wall.place').at(-1)!.args[0].axis).toBe('z');
    // Other owner's creature crossing it dies; the owner's passes.
    // Far enough apart (> 100) that the two creatures never collide with each other: zombie ids are random
    // hex, and all-digit ids iterate first, so overlapping creatures made the outcome order dependent.
    const other = zombieIn(game, 'p0', -800, 390, 1, 0);
    const own = zombieIn(game, 'p2', -800, 210, 1, 0);
    game.update(0.001);
    expect(game.zombies[other.id]).toBeUndefined();
    expect(game.zombies[own.id]).toBeDefined();
    expect(ps[0].socket.events('zombie.walled')).toHaveLength(1);
  });

  it('wall on E is placed 200 in front along -x and extends along z', () => {
    const { game, ps } = startBrawl(4);
    ps[3].player.score = 5;
    ps[3].socket.trigger('place.wall', -100);
    expect(Object.values(game.walls)[0]).toMatchObject({ axis: 'z', position: { x: 800, z: -100 }, ownerId: 'p3' });
  });

  it('duel keeps axis x walls and lane headings in the payloads', () => {
    const game = new Game(3, 'duel');
    const a = makePlayer('a', 'a', -1000, -1);
    const b = makePlayer('b', 'b', 1000, 1);
    game.joinPlayer(a.player);
    game.joinPlayer(b.player);
    a.socket.trigger('ready');
    b.socket.trigger('ready');
    vi.advanceTimersByTime(3000);
    game.hazards = [];
    a.player.score = 5;
    a.socket.trigger('place.wall', 0);
    expect(Object.values(game.walls)[0].axis).toBe('x');
    a.socket.trigger('fire', { x: 0, y: 0, z: -1000 }, 4);
    expect(Object.values(game.zombies)[0].toJSON()).toMatchObject({ vx: 0, vz: 1, ownerId: 'a', targetId: null });
  });

  it('wall on N keeps axis x, in front along +z', () => {
    const { game, ps } = startBrawl(4);
    ps[0].player.score = 5;
    ps[0].socket.trigger('place.wall', 100);
    expect(Object.values(game.walls)[0]).toMatchObject({ axis: 'x', position: { x: 100, z: -800 } });
  });

  it('shield on W blocks within 150 of the edge line and 300 along it', () => {
    const { game, ps } = startBrawl(4);
    ps[2].player.shield.active = true;
    ps[2].player.shield.expiresAt = Date.now() + 10000;
    const inside = zombieIn(game, 'p0', -900, 250, 1, 0);
    const tooDeep = zombieIn(game, 'p0', -700, 0, 1, 0);
    const tooWide = zombieIn(game, 'p0', -900, 400, 1, 0);
    game.update(0.001);
    expect(game.zombies[inside.id]).toBeUndefined();
    expect(game.zombies[tooDeep.id]).toBeDefined();
    expect(game.zombies[tooWide.id]).toBeDefined();
    expect(ps[0].socket.events('zombie.shielded').at(-1)!.args[1]).toBe('p2');
  });
});

describe('brawl spawns', () => {
  it('hazards and power-ups stay within ±800 on both axes', () => {
    const { game } = startBrawl(4);
    for (const v of [0, 0.2, 0.9999]) {
      vi.spyOn(Math, 'random').mockReturnValue(v);
      game.generateHazards();
      for (const h of game.hazards) {
        expect(Math.abs(h.position.x) + h.width / 2).toBeLessThanOrEqual(800 + 1e-9);
        expect(Math.abs(h.position.z) + h.depth / 2).toBeLessThanOrEqual(800 + 1e-9);
      }
      game.lastPowerUpSpawn = 0;
      game.powerUps = {};
      game.spawnPowerUp();
      const pu = Object.values(game.powerUps)[0];
      expect(Math.abs(pu.position.x)).toBeLessThanOrEqual(800);
      expect(Math.abs(pu.position.z)).toBeLessThanOrEqual(800);
      vi.restoreAllMocks();
    }
  });
});

describe('arena helpers', () => {
  it('headingTo falls back to the inward normal', () => {
    expect(headingTo({ x: 0, z: 0 }, null, 'E')).toEqual({ vx: -1, vz: 0 });
    expect(headingTo({ x: 5, z: 5 }, { x: 5, z: 5 }, 'N')).toEqual({ vx: 0, vz: 1 });
  });
  it('validFireLateral rejects non-finite', () => {
    expect(validFireLateral({ z: NaN }, 'W', 0)).toBeNull();
    expect(validFireLateral(null, 'N', 0)).toBeNull();
  });
});
