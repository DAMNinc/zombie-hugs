// Brawl (square arena) geometry. See docs/PROTOCOL.md "Brawl geometry". Duel and solo never use this.
import { MAX_FIRE_X_DRIFT, clamp, isFiniteNumber } from './validate';

export type Edge = 'N' | 'S' | 'W' | 'E';
export type Axis = 'x' | 'z';

/** Players stand on the edge lines x/z = ±SQUARE_HALF. */
export const SQUARE_HALF = 1000;
/** Lateral travel limit along an edge (keeps corners clear). */
export const EDGE_TRAVEL = 800;
/** A creature is out when |x| or |z| exceeds this. */
export const BRAWL_OUT_LIMIT = 1150;
/** Walls sit this far in front of their owner. */
export const WALL_OFFSET = 200;
/** Hazards and normal power-ups spawn within ± this on both axes. */
export const BRAWL_SPAWN_RANGE = 800;
/** Seat order walking clockwise N → E → S → W. */
export const CLOCKWISE_SEATS = [0, 3, 1, 2];

interface EdgeDef {
  /** Axis a player on this edge moves along. */
  axis: Axis;
  /** Inward normal. */
  nx: number;
  nz: number;
}

export const EDGES: Record<Edge, EdgeDef> = {
  N: { axis: 'x', nx: 0, nz: 1 },
  S: { axis: 'x', nx: 0, nz: -1 },
  W: { axis: 'z', nx: 1, nz: 0 },
  E: { axis: 'z', nx: -1, nz: 0 },
};

interface Point {
  x: number;
  y: number;
  z: number;
}

export function clampEdgeTravel(v: number): number {
  return clamp(v, -EDGE_TRAVEL, EDGE_TRAVEL);
}

/** World point on the edge line of `edge` at lateral coordinate `lateral`. */
export function edgePoint(edge: Edge, lateral: number): Point {
  switch (edge) {
    case 'N': return { x: lateral, y: 0, z: -SQUARE_HALF };
    case 'S': return { x: lateral, y: 0, z: SQUARE_HALF };
    case 'W': return { x: -SQUARE_HALF, y: 0, z: lateral };
    case 'E': return { x: SQUARE_HALF, y: 0, z: lateral };
  }
}

export function lateralOf(edge: Edge, p: { x: number; z: number }): number {
  return EDGES[edge].axis === 'x' ? p.x : p.z;
}

/** Client-reported fire position: lateral coordinate near the server's own lateral, within travel. Null if invalid. */
export function validFireLateral(position: unknown, edge: Edge, playerLateral: number): number | null {
  const value = (position as Record<string, unknown> | null | undefined)?.[EDGES[edge].axis];
  if (!isFiniteNumber(value)) return null;
  return clampEdgeTravel(clamp(value, playerLateral - MAX_FIRE_X_DRIFT, playerLateral + MAX_FIRE_X_DRIFT));
}

/** Unit vector from `from` to `to`; the edge's inward normal when they coincide (or no target). */
export function headingTo(from: { x: number; z: number }, to: { x: number; z: number } | null, edge: Edge): { vx: number; vz: number } {
  if (to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) return { vx: dx / len, vz: dz / len };
  }
  return { vx: EDGES[edge].nx, vz: EDGES[edge].nz };
}

/** The edge a creature has left through, or null while it is inside. The larger excess wins. */
export function exitedEdge(p: { x: number; z: number }): Edge | null {
  const ex = Math.abs(p.x) - BRAWL_OUT_LIMIT;
  const ez = Math.abs(p.z) - BRAWL_OUT_LIMIT;
  if (ex <= 0 && ez <= 0) return null;
  if (ex > ez) return p.x < 0 ? 'W' : 'E';
  return p.z < 0 ? 'N' : 'S';
}
