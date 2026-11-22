import type { Socket } from 'socket.io';
import { fireDelayFromCode } from './weapons';
import type { Game, Player } from './controller';
import { ARENA_HALF_WIDTH, ARENA_MARGIN } from './validate';

/** "Practice" difficulty. Tune the bot here. */
export const BOT_FIRE_MIN_MS = 1200;
export const BOT_FIRE_MAX_MS = 2500;
/** An enemy creature closer than this (in z) counts as a threat worth reacting to. */
export const BOT_THREAT_Z = 450;
/** Chance to raise the shield when a threat is close and the shield is ready. */
export const BOT_SHIELD_CHANCE = 0.5;
/** Re-roll the shield decision at most this often, so ~50% is per threat, not per tick. */
export const BOT_SHIELD_ROLL_MS = 1500;
/** Stop steering when this close (in x) to the aim point. */
export const BOT_AIM_TOLERANCE = 40;
/** How long the bot drifts towards one random point before choosing another. */
export const BOT_DRIFT_MIN_MS = 1500;
export const BOT_DRIFT_MAX_MS = 3500;
/** Arrow key codes: the client renders opponents' movement from these (not from -1/1). */
const LEFT_KEY = 37;
const RIGHT_KEY = 39;
const WEAPONS = [1, 2, 3, 4, 5];
/** Flamingos (3) fly and only collide with other flamingos, so that is the one real counter. */
const FLAMINGO = 3;

export interface BotOptions {
  rng?: () => number;
  now?: () => number;
}

/** A socket stand-in that records the handlers the game registers, so the bot can trigger them like a client would. */
class BotSocket {
  handlers: Record<string, Array<(...args: any[]) => void>> = {};
  constructor(public id: string) {}
  on(event: string, fn: (...args: any[]) => void) {
    (this.handlers[event] ||= []).push(fn);
    return this;
  }
  emit() { return true; }
  trigger(event: string, ...args: any[]) {
    for (const fn of this.handlers[event] || []) fn(...args);
  }
}

/** Drives the solo practice bot through the same socket handlers a human uses. */
export class BotBrain {
  private socket: BotSocket;
  private rng: () => number;
  private now: () => number;
  private nextFireAt = 0;
  private nextShieldRollAt = 0;
  private driftX = 0;
  private driftUntil = 0;
  private moving: 0 | 37 | 39 = 0;
  private armedRound = -1;
  private disposed = false;

  constructor(private game: Game, private bot: Player, opts: BotOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.socket = new BotSocket(bot.id);
    bot.socket = this.socket as unknown as Socket;
    game.registerPlayerHandlers(bot);
  }

  private between(min: number, max: number) {
    return min + this.rng() * (max - min);
  }

  /** Called from the game's update loop while a solo match is live. */
  tick() {
    if (this.disposed) return;
    const { game, bot } = this;
    if (game.mode !== 'solo' || (game.phase !== 'playing' && game.phase !== 'sudden_death')) return;
    const now = this.now();
    if (this.armedRound !== game.round) {
      // A new round: let go of the keys and restart the fire and drift timers.
      this.armedRound = game.round;
      this.release();
      this.nextFireAt = now + this.between(BOT_FIRE_MIN_MS, BOT_FIRE_MAX_MS);
      this.driftUntil = 0;
    }

    const threat = this.nearestThreat();
    this.steer(threat?.position.x, now);

    if (threat && Math.abs(threat.position.z - bot.position.z) < BOT_THREAT_Z) this.maybeShield(now);

    if (now >= this.nextFireAt) {
      this.fire(threat?.weaponCode);
      this.nextFireAt = now + this.between(BOT_FIRE_MIN_MS, BOT_FIRE_MAX_MS);
    }
  }

  /** Stops acting and lets go of the keys. */
  dispose() {
    this.release();
    this.disposed = true;
  }

  private nearestThreat() {
    let best: { position: { x: number; z: number }; weaponCode: number } | null = null;
    let bestDist = Infinity;
    for (const id in this.game.zombies) {
      const z = this.game.zombies[id];
      if (z.firedByPlayer === this.bot.id) continue;
      // Only creatures still heading towards the bot's end.
      const dist = (this.bot.position.z - z.position.z) * this.bot.direction;
      if (dist < 0) continue;
      if (dist < bestDist) { bestDist = dist; best = z; }
    }
    return best;
  }

  private steer(threatX: number | undefined, now: number) {
    let aim: number;
    if (threatX !== undefined) {
      aim = threatX;
    } else {
      if (now >= this.driftUntil) {
        const limit = ARENA_HALF_WIDTH - ARENA_MARGIN;
        this.driftX = (this.rng() * 2 - 1) * limit;
        this.driftUntil = now + this.between(BOT_DRIFT_MIN_MS, BOT_DRIFT_MAX_MS);
      }
      aim = this.driftX;
    }
    const dx = aim - this.bot.position.x;
    let want: 0 | 37 | 39 = 0;
    if (Math.abs(dx) > BOT_AIM_TOLERANCE) {
      // The player's lateral axis is mirrored by direction (see Player.update).
      const towardsPositive = dx > 0;
      want = (towardsPositive === (this.bot.direction > 0) ? RIGHT_KEY : LEFT_KEY);
    }
    this.setMoving(want);
  }

  private setMoving(want: 0 | 37 | 39) {
    if (want === this.moving) return;
    if (this.moving !== 0) this.socket.trigger('move.end', this.moving);
    if (want !== 0) this.socket.trigger('move.start', want);
    this.moving = want;
  }

  private release() {
    this.setMoving(0);
  }

  private maybeShield(now: number) {
    if (now < this.nextShieldRollAt) return;
    if (this.bot.shield.active || now < this.bot.shield.cooldownUntil) return;
    this.nextShieldRollAt = now + BOT_SHIELD_ROLL_MS;
    if (this.rng() < BOT_SHIELD_CHANCE) this.socket.trigger('shield');
  }

  private fire(threatWeapon: number | undefined) {
    // Only weapons whose fire delay has elapsed, so the server never drops the shot.
    const now = this.now();
    const rapid = this.bot.hasPowerUp('rapid_fire') ? 0.5 : 1;
    const ready = WEAPONS.filter(w => now - this.bot.lastFireTime >= fireDelayFromCode(w) * rapid);
    if (ready.length === 0) return;
    const weapon = threatWeapon === FLAMINGO && ready.includes(FLAMINGO) && this.rng() < 0.6
      ? FLAMINGO
      : ready[Math.floor(this.rng() * ready.length)];
    if (weapon !== this.bot.weaponCode) this.socket.trigger('weapon.set', weapon);
    this.socket.trigger('fire', { ...this.bot.position }, weapon, 0);
  }
}
