import { describe, it, expect } from 'vitest';
import {
  edgeView, edgePoint, resolveEdge, viewFor, playerYaw, creatureYaw, headingOf, cycleTarget, opponentsClockwise,
  arenaFromState, opponentsInOrder, swayDirection, readableText, seatColor, EDGE_TRAVEL, LANE_LIMIT,
} from '../../src/client/arena';

const rightOnScreen = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

describe('edge views', () => {
  it('right vector matches the camera yaw for every edge', () => {
    for (const e of ['N', 'S', 'W', 'E'] as const) {
      const v = edgeView(e);
      const r = rightOnScreen(v.yaw);
      expect(r.x).toBeCloseTo(v.right.x);
      expect(r.z).toBeCloseTo(v.right.z);
      // camera looks along (-sin yaw, -cos yaw) = inward
      expect(-Math.sin(v.yaw)).toBeCloseTo(v.inward.x);
      expect(-Math.cos(v.yaw)).toBeCloseTo(v.inward.z);
    }
  });
  it('duel lane keeps today\'s numbers', () => {
    expect(edgeView('S').right).toEqual({ x: 1, z: 0 });
    expect(edgeView('N').right).toEqual({ x: -1, z: 0 });
    expect(edgeView('N').yaw).toBe(Math.PI);
    expect(edgeView('S').limit).toBe(LANE_LIMIT);
    expect(edgeView('W', 'square').limit).toBe(EDGE_TRAVEL);
    expect(viewFor('lane', 'W').edge).toBe('S');
    expect(viewFor('square', 'W').edge).toBe('W');
  });
  it('edge points and yaws', () => {
    expect(edgePoint('N', 5)).toEqual({ x: 5, z: -1000 });
    expect(edgePoint('E', 7)).toEqual({ x: 1000, z: 7 });
    expect(playerYaw({ x: 0, z: -1 })).toBeCloseTo(Math.PI / 2); // S player as before
    expect(playerYaw({ x: 0, z: 1 })).toBeCloseTo(-Math.PI / 2);
    expect(creatureYaw({ x: 0, z: 1 })).toBe(0);
    expect(creatureYaw({ x: 0, z: -1 })).toBeCloseTo(Math.PI);
  });
  it('resolves edges', () => {
    expect(resolveEdge('W', 0, 1)).toBe('W');
    expect(resolveEdge(undefined, 3, 1)).toBe('E');
    expect(resolveEdge(undefined, undefined, -1)).toBe('N');
  });
});

describe('headings', () => {
  it('uses vx/vz, normalised, else the duel direction', () => {
    expect(headingOf({ vx: 3, vz: 4 })).toEqual({ x: 0.6, z: 0.8 });
    expect(headingOf({ direction: -1 })).toEqual({ x: 0, z: -1 });
    expect(headingOf({ vx: 0, vz: 0, direction: 1 })).toEqual({ x: 0, z: 1 });
  });
});

describe('targeting', () => {
  const ps = [
    { id: 'a', seat: 0 }, { id: 'b', seat: 1 }, { id: 'c', seat: 2 }, { id: 'd', seat: 3 },
  ];
  it('cycles clockwise N→E→S→W skipping me and the knocked out', () => {
    expect(opponentsClockwise(ps, 'a').map((p) => p.id)).toEqual(['d', 'b', 'c']);
    expect(cycleTarget(ps, 'a', 'd')).toBe('b');
    expect(cycleTarget(ps, 'a', 'c')).toBe('d');
    expect(cycleTarget(ps, 'a', 'd', -1)).toBe('c');
    expect(cycleTarget(ps, 'a', null)).toBe('d');
    expect(cycleTarget([...ps.slice(0, 2), { id: 'c', seat: 2, alive: false }, ps[3]], 'a', 'b')).toBe('d');
    expect(cycleTarget([{ id: 'a', seat: 0 }], 'a', null)).toBeNull();
  });
});

describe('misc', () => {
  it('arena from state', () => {
    expect(arenaFromState('brawl', 'playing')).toBe('square');
    expect(arenaFromState('duel', 'playing')).toBe('lane');
    expect(arenaFromState('duel', 'lobby')).toBe('lane');
    expect(arenaFromState('solo', 'lobby')).toBe('lane');
    expect(arenaFromState(undefined, 'lobby')).toBeNull();
  });
  it('colours', () => {
    expect(seatColor(2)).toBe('#F0E442');
    expect(readableText('#F0E442')).toBe('#111111');
    expect(readableText('#0072B2')).toBe('#ffffff');
  });
});

describe('review fixes', () => {
  it('a W player built in the lane is oriented from the raw edge once the arena is square', () => {
    expect(viewFor('lane', resolveEdge('W', 2, 1)).edge).toBe('S'); // what the lane shows (view is lossy)
    expect(viewFor('square', resolveEdge('W', 2, 1)).edge).toBe('W'); // orient() uses the raw edge
    expect(viewFor('square', resolveEdge('E', 3, 1)).edge).toBe('E');
  });
  it('brawl zig-zag matches the server (-vz, vx); lane sways along +x', () => {
    const h = { x: 0.6, z: 0.8 };
    const sway = 7;
    const base = { x: 100, z: 200 };
    // lib/controller.ts: x = baseX - vz*sway, z = baseZ + vx*sway
    const server = { x: base.x - h.z * sway, z: base.z + h.x * sway };
    const d = swayDirection(h, true);
    expect(base.x + d.x * sway).toBeCloseTo(server.x);
    expect(base.z + d.z * sway).toBeCloseTo(server.z);
    expect(swayDirection({ x: 0, z: -1 }, false)).toEqual({ x: 1, z: 0 });
  });
  it('chips follow the clockwise order and keep knocked-out players', () => {
    const ps = [{ id: 'a', seat: 0 }, { id: 'b', seat: 1 }, { id: 'c', seat: 2, alive: false }, { id: 'd', seat: 3 }];
    expect(opponentsInOrder(ps, 'a').map((p) => p.id)).toEqual(['d', 'b', 'c']);
  });
});
