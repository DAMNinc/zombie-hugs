// Validation helpers for untrusted socket payloads.

export const ARENA_HALF_WIDTH = 500;
// Keeps players and walls inside the boundary markers (posts at ±ARENA_HALF_WIDTH). Mirrored in src/client/constants.ts.
export const ARENA_MARGIN = 10;
export const MAX_CHARGE_MS = 3000;
// How far a client-reported fire x may differ from the server's player x.
export const MAX_FIRE_X_DRIFT = 150;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Integer weapon code 1..5, or null. */
export function validWeaponCode(code: unknown): number | null {
  return typeof code === 'number' && Number.isInteger(code) && code >= 1 && code <= 5 ? code : null;
}

/** Clamp x into the playable arena. */
export function clampArenaX(x: number): number {
  const limit = ARENA_HALF_WIDTH - ARENA_MARGIN;
  return clamp(x, -limit, limit);
}

/** Client-reported fire x: finite, within the arena and near the server's player x. Null if invalid. */
export function validFireX(position: unknown, playerX: number): number | null {
  const x = (position as { x?: unknown } | null | undefined)?.x;
  if (!isFiniteNumber(x)) return null;
  return clampArenaX(clamp(x, playerX - MAX_FIRE_X_DRIFT, playerX + MAX_FIRE_X_DRIFT));
}

/** Charge time: finite (else 0), clamped to [0, MAX_CHARGE_MS] and to the time since the last shot. Null if not a finite number. */
export function effectiveCharge(chargeTime: unknown, sinceLastFire: number): number | null {
  if (chargeTime === undefined) return 0;
  if (!isFiniteNumber(chargeTime)) return null;
  return clamp(Math.min(chargeTime, sinceLastFire), 0, MAX_CHARGE_MS);
}

export const MAX_TOKEN_LENGTH = 128;

/** Reconnect token: a non-empty string of at most MAX_TOKEN_LENGTH characters, else null. */
export function validToken(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TOKEN_LENGTH ? v : null;
}
