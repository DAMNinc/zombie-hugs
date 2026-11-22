// Pure arena geometry and targeting helpers (no three.js, no DOM; unit-tested in tests/client/arena.test.ts).
// Mirrors docs/PROTOCOL.md "Brawl geometry" and lib/arena.ts on the server.
import Constants from './constants';

export type Edge = 'N' | 'S' | 'W' | 'E';
export type ArenaKind = 'lane' | 'square';
export interface Vec2 { x: number; z: number }

export const SQUARE_HALF = 1000;
export const EDGE_TRAVEL = 800;
/** Lane players are clamped to ±(ARENA_HALF_WIDTH - ARENA_MARGIN), as before. */
export const LANE_LIMIT = Constants.ARENA_HALF_WIDTH - Constants.ARENA_MARGIN;

/** Okabe-Ito seat colours, docs/PROTOCOL.md. */
export const SEAT_COLORS = ['#0072B2', '#D55E00', '#F0E442', '#009E73'];
export const SEAT_EDGES: Edge[] = ['N', 'S', 'W', 'E'];
/** Clockwise seat order N→E→S→W. */
export const CLOCKWISE_SEATS = [0, 3, 1, 2];

export interface EdgeView {
  edge: Edge;
  /** Unit vector from the edge towards the centre. */
  inward: Vec2;
  /** World direction of "right on my screen" (camera looking at the centre). */
  right: Vec2;
  /** Camera rotation.y that looks inward. */
  yaw: number;
  /** World axis the player moves along ('x' for N/S, 'z' for W/E). */
  lateral: 'x' | 'z';
  /** World axis the edge line is fixed on. */
  fixedAxis: 'x' | 'z';
  /** Fixed coordinate of the edge line (±SQUARE_HALF). */
  fixed: number;
  /** Lateral clamp: EDGE_TRAVEL in the square, the lane half width in the lane. */
  limit: number;
  /** Legacy duel direction (N -1, S +1); W/E are +1 and only used for names. */
  direction: number;
}

const BASE: Record<Edge, Omit<EdgeView, 'edge' | 'limit'>> = {
  N: { inward: { x: 0, z: 1 }, right: { x: -1, z: 0 }, yaw: Math.PI, lateral: 'x', fixedAxis: 'z', fixed: -SQUARE_HALF, direction: -1 },
  S: { inward: { x: 0, z: -1 }, right: { x: 1, z: 0 }, yaw: 0, lateral: 'x', fixedAxis: 'z', fixed: SQUARE_HALF, direction: 1 },
  W: { inward: { x: 1, z: 0 }, right: { x: 0, z: 1 }, yaw: -Math.PI / 2, lateral: 'z', fixedAxis: 'x', fixed: -SQUARE_HALF, direction: 1 },
  E: { inward: { x: -1, z: 0 }, right: { x: 0, z: -1 }, yaw: Math.PI / 2, lateral: 'z', fixedAxis: 'x', fixed: SQUARE_HALF, direction: 1 },
};

export function isEdge(e: unknown): e is Edge {
  return e === 'N' || e === 'S' || e === 'W' || e === 'E';
}

export function edgeView(edge: Edge, kind: ArenaKind = 'lane'): EdgeView {
  const b = BASE[edge];
  return { edge, ...b, limit: kind === 'square' ? EDGE_TRAVEL : LANE_LIMIT };
}

/** The player's edge from a payload: the server's `edge`, else the seat, else the duel direction. */
export function resolveEdge(edge: unknown, seat: unknown, direction: number): Edge {
  if (isEdge(edge)) return edge;
  if (typeof seat === 'number' && SEAT_EDGES[seat]) return SEAT_EDGES[seat];
  return direction === -1 ? 'N' : 'S';
}

/** The view for a player: the square arena honours the edge, the lane only has N and S. */
export function viewFor(kind: ArenaKind, edge: Edge): EdgeView {
  if (kind === 'square') return edgeView(edge, 'square');
  return edgeView(edge === 'N' ? 'N' : 'S', 'lane');
}

/** World point on an edge at a lateral offset. */
export function edgePoint(edge: Edge, lateral = 0): Vec2 {
  const v = BASE[edge];
  return v.lateral === 'x' ? { x: lateral, z: v.fixed } : { x: v.fixed, z: lateral };
}

/** Lateral coordinate of a world point for a view. */
export function lateralOf(view: EdgeView, p: Vec2): number {
  return view.lateral === 'x' ? p.x : p.z;
}

/** Player model yaw: the model's forward axis is local +x. */
export function playerYaw(inward: Vec2): number {
  return Math.atan2(-inward.z, inward.x);
}

/** Creature model yaw: the model's forward axis is local +z. Duel: vz=1 → 0, vz=-1 → π (as before). */
export function creatureYaw(h: Vec2): number {
  return Math.atan2(h.x, h.z);
}

/** Heading of a creature payload; duel payloads without vx/vz head along z by `direction`. */
export function headingOf(z: { vx?: unknown; vz?: unknown; direction?: number }): Vec2 {
  if (typeof z.vx === 'number' && typeof z.vz === 'number' && (z.vx !== 0 || z.vz !== 0)) {
    const len = Math.hypot(z.vx, z.vz);
    return { x: z.vx / len, z: z.vz / len };
  }
  return { x: 0, z: z.direction === -1 ? -1 : 1 };
}

export function seatColor(seat: unknown, fallback = '#ffffff'): string {
  return typeof seat === 'number' && SEAT_COLORS[seat] ? SEAT_COLORS[seat] : fallback;
}

export interface TargetCandidate { id: string; seat?: number; alive?: boolean }

/** Living opponents in clockwise order (N→E→S→W). */
export function opponentsClockwise<T extends TargetCandidate>(players: T[], myId: string): T[] {
  const rank = (p: T) => {
    const r = CLOCKWISE_SEATS.indexOf(p.seat ?? -1);
    return r < 0 ? 99 : r;
  };
  return players.filter((p) => p.id !== myId && p.alive !== false).sort((a, b) => rank(a) - rank(b));
}

/** Opponents in clockwise order, knocked-out ones included (chips show them disabled). */
export function opponentsInOrder<T extends TargetCandidate>(players: T[], myId: string): T[] {
  const rank = (p: T) => {
    const r = CLOCKWISE_SEATS.indexOf(p.seat ?? -1);
    return r < 0 ? 99 : r;
  };
  return players.filter((p) => p.id !== myId).sort((a, b) => rank(a) - rank(b));
}

/**
 * Direction the fox zig-zag is offset in, perpendicular to the heading. Brawl matches the server
 * (lib/controller.ts: x = base - vz*sway, z = base + vx*sway); the lane always sways along +x.
 */
export function swayDirection(h: Vec2, square: boolean): Vec2 {
  if (square) return { x: -h.z, z: h.x };
  return { x: 1, z: 0 };
}

/** The next target after `currentId` clockwise (`step` 1) or counter-clockwise (-1); null without opponents. */
export function cycleTarget<T extends TargetCandidate>(players: T[], myId: string, currentId: string | null | undefined, step = 1): string | null {
  const opps = opponentsClockwise(players, myId);
  if (opps.length === 0) return null;
  const i = opps.findIndex((p) => p.id === currentId);
  if (i < 0) return opps[0].id;
  return opps[(i + step + opps.length) % opps.length].id;
}

/** Black or white, whichever reads better on `hex`. */
export function readableText(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? '#111111' : '#ffffff';
}

/** Chip text for the current target. */
export function targetChipText(name: string | null | undefined): string {
  return name ? `Target: ${name}` : 'No target';
}

/** Which arena the state/start payload asks for; null means "leave as is". */
export function arenaFromState(mode: unknown, _phase?: unknown): ArenaKind | null {
  if (mode === 'brawl') return 'square';
  if (mode === 'duel' || mode === 'solo') return 'lane';
  return null;
}
