import crypto from 'crypto';
import {
  uniqueNamesGenerator,
  adjectives,
  colors,
  animals,
  names,
} from 'unique-names-generator';
import type { Socket } from 'socket.io';
import logger from './logger';
import { BRAWL_SPAWN_RANGE, CLOCKWISE_SEATS, EDGES, SQUARE_HALF, WALL_OFFSET, clampEdgeTravel, edgePoint, exitedEdge, headingTo, lateralOf, validFireLateral } from './arena';
import type { Axis, Edge } from './arena';
import { BotBrain } from './bot';
import { healthFromCode, speedFromCode, fireDelayFromCode } from './weapons';
import { ARENA_HALF_WIDTH, ARENA_MARGIN, MAX_CHARGE_MS, clampArenaX, effectiveCharge, isFiniteNumber, validFireX, validToken, validWeaponCode } from './validate';

interface Position {
  x: number;
  y: number;
  z: number;
}

type GamePhase = 'lobby' | 'countdown' | 'playing' | 'round_over' | 'match_over' | 'sudden_death';
type GameMode = 'solo' | 'duel' | 'brawl';

const MAX_SEATS = 4;
/** How long a dropped player keeps their seat outside the lobby. */
const RECONNECT_WINDOW_MS = 15000;

/** Seat table (Okabe-Ito colours). Seats 0/1 are the classic duel sides; 2/3 are the brawl W/E edges. */
const SEATS: Array<{ color: string; edge: Edge; direction: number; x: number; z: number }> = [
  { color: '#0072B2', edge: 'N', direction: -1, x: 0, z: -SQUARE_HALF },
  { color: '#D55E00', edge: 'S', direction: 1, x: 0, z: SQUARE_HALF },
  { color: '#F0E442', edge: 'W', direction: 1, x: -SQUARE_HALF, z: 0 },
  { color: '#009E73', edge: 'E', direction: -1, x: SQUARE_HALF, z: 0 },
];

const playerNameConfig = { dictionaries: [adjectives, names], length: 2 };
const zombieNameConfig = { dictionaries: [colors, animals], length: 2 };

const MAX_HP = 10;
const POINTS_TO_WIN = 10;
const ROUNDS_TO_WIN = 2;
const COUNTDOWN_SECONDS = 3;
const COMBO_WINDOW_MS = 2000;
const SHIELD_DURATION_MS = 3000;
const SHIELD_COOLDOWN_MS = 15000;
const UPGRADE_THRESHOLDS = [5, 8];

// Power-up constants
const POWERUP_SPAWN_INTERVAL_MS = 8000;
const POWERUP_DURATION_MS = 12000;
const POWERUP_COLLECT_RADIUS = 150;
type PowerUpType = 'rapid_fire' | 'speed_boost' | 'heal' | 'double_points';
const POWERUP_TYPES: PowerUpType[] = ['rapid_fire', 'speed_boost', 'heal', 'double_points'];

// Arena hazard constants
const HAZARD_COUNT = 2;
// A damage hazard's nearest edge stays at least this far from the centre lane (x = 0)
const HAZARD_CLEAR_LANE = 60;

// Sudden death constants
const SUDDEN_DEATH_TIME_MS = 90000;

// Brawl party round (unranked free-for-all)
const BRAWL_ROUND_MS = 120000;
const RESPAWN_MS = 3000;
const CENTRAL_FIRST_MS = 15000;
const CENTRAL_INTERVAL_MS = 20000;
const CENTRAL_TELEGRAPH_MS = 3000;
const BRAWL_SUDDEN_CAP_MS = 60000;
const KO_BONUS = 2;
const CAPTURE_BONUS = 2;

// Wall constants
const WALL_COST = 3;
const WALL_DURATION_MS = 5000;
const WALL_WIDTH = 300;

// Spectator vote constants
const SPECTATOR_VOTE_COOLDOWN_MS = 15000;

// Synergy constants
// Must exceed the longest fire delay (horde, 3000 ms) so Stampede (horse then horde) is reachable.
const SYNERGY_WINDOW_MS = 3500;

// ELO constants
const ELO_K = 32;
const ELO_DEFAULT = 1000;

interface PowerUp {
  id: string;
  type: PowerUpType;
  position: Position;
  expiresAt: number;
  /** Brawl: the telegraphed power-up in the middle of the arena. */
  central?: boolean;
}

interface Hazard {
  id: string;
  position: Position;
  width: number;
  depth: number;
  type: 'damage' | 'slow' | 'wind';
  windDirection?: number;
}

interface Wall {
  id: string;
  position: Position;
  width: number;
  ownerId: string;
  expiresAt: number;
  /** Axis the wall extends along (duel walls: 'x'). */
  axis: Axis;
}

interface ActivePowerUp {
  type: PowerUpType;
  expiresAt: number;
}

interface FiredCreatureRecord {
  weaponCode: number;
  time: number;
}

// In-memory ELO store (keyed by player name since we don't have accounts)
const eloStore: Record<string, number> = {};

function getElo(name: string): number {
  return eloStore[name] || ELO_DEFAULT;
}

function updateElo(winnerName: string, loserName: string): void {
  const winnerElo = getElo(winnerName);
  const loserElo = getElo(loserName);

  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

  eloStore[winnerName] = Math.round(winnerElo + ELO_K * (1 - expectedWinner));
  eloStore[loserName] = Math.round(loserElo + ELO_K * (0 - expectedLoser));
}

function getLeaderboard(): Array<{ name: string; elo: number }> {
  return Object.entries(eloStore)
    .map(([name, elo]) => ({ name, elo }))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 20);
}

let gameCounter = 0;
const MAX_GAMES = 100;
const MAX_GAME_NAME_LENGTH = 40;
/** A game with no players and no spectators for this long is stopped and removed. */
const EMPTY_GAME_TTL_MS = 60000;

/**
 * Test-only knobs: mutable copies of a few durations/limits so end-to-end tests can shorten them.
 * Production never changes them. `resetKnobs()` restores the defaults.
 */
const knobs = {
  reconnectWindowMs: RECONNECT_WINDOW_MS,
  emptyGameTtlMs: EMPTY_GAME_TTL_MS,
  brawlRoundMs: BRAWL_ROUND_MS,
  countdownSeconds: COUNTDOWN_SECONDS,
  countdownTickMs: 1000,
  sweepIntervalMs: 5000,
  pointsToWin: POINTS_TO_WIN,
  roundsToWin: ROUNDS_TO_WIN,
};
function resetKnobs() {
  Object.assign(knobs, {
    reconnectWindowMs: RECONNECT_WINDOW_MS,
    emptyGameTtlMs: EMPTY_GAME_TTL_MS,
    brawlRoundMs: BRAWL_ROUND_MS,
    countdownSeconds: COUNTDOWN_SECONDS,
    countdownTickMs: 1000,
    sweepIntervalMs: 5000,
    pointsToWin: POINTS_TO_WIN,
    roundsToWin: ROUNDS_TO_WIN,
  });
}
const games: Record<number, Game> = {};

class Game {
  id: number;
  gameName: string;
  startTime: Date;
  players: Record<string, Player>;
  spectators: Record<string, Player>;
  zombies: Record<string, Zombie>;
  timestamp: number;
  updating: boolean;
  phase: GamePhase;
  round: number;
  roundWins: Record<string, number>;
  stats: Record<string, PlayerStats>;
  /** Mode the room plays (decided by headcount at countdown); in the lobby, the mode it would start in. */
  mode: GameMode;
  /** Drives the practice bot in solo; null otherwise. */
  botBrain: BotBrain | null = null;
  /** Late arrivals waiting for a seat, in join order. They are also in `spectators`. */
  queue: Player[];

  // New feature state
  powerUps: Record<string, PowerUp>;
  /** Brawl: when the next central power-up appears, and the telegraph already announced for it. */
  centralSpawnAt: number;
  centralPending: { id: string; spawnAt: number } | null;
  /** Brawl sudden death: the tied players who can still win, and when it began. */
  suddenIds: string[];
  suddenStart: number;
  lastStandingsKey: string;
  /** The last `match.over` payload, replayed to a player who reconnects while the room is in match_over. */
  lastMatchOver: Record<string, unknown> | null = null;
  hazards: Hazard[];
  walls: Record<string, Wall>;
  roundStartTime: number;
  suddenDeath: boolean;
  lastPowerUpSpawn: number;
  lastSpectatorVote: number;
  countdownTimer: ReturnType<typeof setInterval> | null;
  roundResetTimer: ReturnType<typeof setTimeout> | null;
  intervals: Array<ReturnType<typeof setInterval>>;
  /** Last time someone joined or left; a game that stays empty for EMPTY_GAME_TTL_MS is deleted. */
  lastActivity: number;

  constructor(id: number, gameName?: string) {
    this.id = id;
    this.gameName = gameName ? gameName : 'That DAMN game';
    this.startTime = new Date();
    this.players = {};
    this.spectators = {};
    this.zombies = {};
    this.timestamp = Date.now();
    this.updating = false;
    this.phase = 'lobby';
    this.round = 1;
    this.roundWins = {};
    this.stats = {};
    this.mode = 'solo';
    this.queue = [];

    this.powerUps = {};
    this.centralSpawnAt = 0;
    this.centralPending = null;
    this.suddenIds = [];
    this.suddenStart = 0;
    this.lastStandingsKey = '';
    this.hazards = [];
    this.walls = {};
    this.roundStartTime = 0;
    this.suddenDeath = false;
    this.lastPowerUpSpawn = 0;
    this.lastSpectatorVote = 0;
    this.countdownTimer = null;
    this.roundResetTimer = null;
    this.intervals = [];
    this.lastActivity = Date.now();
  }

  emitAll(...args: any[]) {
    for (const key in this.players) {
      const player = this.players[key];
      player.socket.emit.apply(player.socket, args as [string, ...any[]]);
    }

    for (const key in this.spectators) {
      const spectator = this.spectators[key];
      spectator.socket.emit.apply(spectator.socket, args as [string, ...any[]]);
    }
  }

  generateHazards() {
    this.hazards = [];
    // Pick HAZARD_COUNT distinct types at random (Fisher-Yates on a copy).
    const pool: Array<'damage' | 'slow' | 'wind'> = ['damage', 'slow', 'wind'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(Math.random() * (i + 1)));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const limit = ARENA_HALF_WIDTH - ARENA_MARGIN;
    for (const type of pool.slice(0, HAZARD_COUNT)) {
      const width = 150 + Math.random() * 150;
      const depth = 200 + Math.random() * 200;
      let x: number;
      let z = (Math.random() - 0.5) * 1200;
      if (this.mode === 'brawl') {
        x = (Math.random() - 0.5) * 2 * (BRAWL_SPAWN_RANGE - width / 2);
        z = (Math.random() - 0.5) * 2 * (BRAWL_SPAWN_RANGE - depth / 2);
      } else if (type === 'damage') {
        // Keep the centre lane (x = 0) clear: nearest edge at least HAZARD_CLEAR_LANE from it.
        const side = Math.random() < 0.5 ? -1 : 1;
        const minX = HAZARD_CLEAR_LANE + width / 2;
        const maxX = limit - width / 2;
        x = side * (minX + Math.random() * (maxX - minX));
      } else {
        x = (Math.random() - 0.5) * 2 * (limit - width / 2);
      }
      this.hazards.push({
        id: crypto.randomBytes(4).toString('hex'),
        position: { x, y: 0, z },
        width,
        depth,
        type,
        windDirection: type === 'wind' ? (Math.random() > 0.5 ? 1 : -1) : undefined,
      });
    }
    this.emitAll('hazards', this.hazards);
  }

  spawnPowerUp() {
    const now = Date.now();
    if (now - this.lastPowerUpSpawn < POWERUP_SPAWN_INTERVAL_MS) return;
    // Max 3 power-ups on field at once
    if (Object.values(this.powerUps).filter(p => !p.central).length >= 3) return;

    this.lastPowerUpSpawn = now;
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const brawl = this.mode === 'brawl';
    const powerUp: PowerUp = {
      id: crypto.randomBytes(4).toString('hex'),
      type,
      position: brawl
        ? { x: (Math.random() - 0.5) * 2 * BRAWL_SPAWN_RANGE, y: 0, z: (Math.random() - 0.5) * 2 * BRAWL_SPAWN_RANGE }
        : {
            x: clampArenaX((Math.random() - 0.5) * 980),
            y: 0,
            z: (Math.random() - 0.5) * 1400,
          },
      expiresAt: now + POWERUP_DURATION_MS,
    };
    this.powerUps[powerUp.id] = powerUp;
    this.emitAll('powerup.spawn', powerUp);
  }

  checkPowerUpCollisions() {
    const now = Date.now();
    for (const puId in this.powerUps) {
      const pu = this.powerUps[puId];
      // Check expiration
      if (now >= pu.expiresAt) {
        this.emitAll('powerup.expire', puId);
        delete this.powerUps[puId];
        continue;
      }
      // Collected by the first creature passing through it (x/z only: flamingos fly), credited to its owner
      for (const zid in this.zombies) {
        const zombie = this.zombies[zid];
        const player = this.players[zombie.firedByPlayer];
        if (!player) continue;
        const dx = Math.abs(zombie.position.x - pu.position.x);
        const dz = Math.abs(zombie.position.z - pu.position.z);
        if (dx < POWERUP_COLLECT_RADIUS && dz < POWERUP_COLLECT_RADIUS) {
          this.applyPowerUp(player, pu);
          this.emitAll('powerup.collect', puId, player.id, pu.type);
          delete this.powerUps[puId];
          if (pu.central && this.mode === 'brawl') {
            player.captures++;
            this.addScore(player, CAPTURE_BONUS);
            this.emitStandings();
            this.checkBrawlEnd(player);
          }
          break;
        }
      }
    }
  }

  applyPowerUp(player: Player, powerUp: PowerUp) {
    const now = Date.now();
    switch (powerUp.type) {
      case 'rapid_fire':
        player.activePowerUps.push({ type: 'rapid_fire', expiresAt: now + 8000 });
        break;
      case 'speed_boost':
        player.activePowerUps.push({ type: 'speed_boost', expiresAt: now + 8000 });
        break;
      case 'heal':
        if (!player.alive) break; // a knocked-out player cannot be healed (the effect is wasted)
        player.hp = Math.min(MAX_HP, player.hp + 3);
        this.emitAll('player.heal', player.id, player.hp);
        break;
      case 'double_points':
        player.activePowerUps.push({ type: 'double_points', expiresAt: now + 10000 });
        break;
    }
  }

  checkWalls() {
    const now = Date.now();
    for (const wId in this.walls) {
      if (now >= this.walls[wId].expiresAt) {
        this.emitAll('wall.expire', wId);
        delete this.walls[wId];
      }
    }
  }

  checkSuddenDeath() {
    if (this.suddenDeath || this.mode === 'brawl') return;
    const elapsed = Date.now() - this.roundStartTime;
    if (elapsed >= SUDDEN_DEATH_TIME_MS) {
      this.suddenDeath = true;
      this.phase = 'sudden_death';

      // Boost all existing and future zombies
      for (const key in this.zombies) {
        this.zombies[key].speed *= 2;
        this.zombies[key].health += 1;
      }

      this.emitAll('sudden.death');
    }
  }

  /** Adds points and applies the score-driven upgrade level. */
  addScore(player: Player, points: number) {
    player.score += points;
    const oldLevel = player.upgradeLevel;
    player.upgradeLevel = UPGRADE_THRESHOLDS.filter(t => player.score >= t).length;
    if (player.upgradeLevel > oldLevel) {
      this.emitAll('player.upgrade', player.id, player.upgradeLevel);
    }
  }

  brawlRemainingMs(): number {
    if (this.mode !== 'brawl') return 0;
    if (this.phase === 'playing') return Math.max(0, knobs.brawlRoundMs - (Date.now() - this.roundStartTime));
    if (this.phase === 'countdown' || this.phase === 'lobby') return knobs.brawlRoundMs;
    return 0;
  }

  /** Emits `standings` when it differs from the last one sent. */
  emitStandings(force = false) {
    if (this.mode !== 'brawl') return;
    const standings = this.standings();
    const key = JSON.stringify(standings);
    if (!force && key === this.lastStandingsKey) return;
    this.lastStandingsKey = key;
    this.emitAll('standings', standings);
  }

  /** Clears the brawl-only pending state (central power-up announcement, sudden-death roster). */
  resetBrawlState() {
    this.centralPending = null;
    this.suddenIds = [];
  }

  /** Brawl: a KO'd player is out until RESPAWN_MS has passed. */
  knockOut(victim: Player, by: Player | undefined) {
    const now = Date.now();
    victim.alive = false;
    victim.respawnAt = now + RESPAWN_MS;
    // Tell clients to drop what the victim was doing (they would otherwise keep a ghost shield / sliding player).
    if (victim.left) this.emitAll('move.end', -1, victim.id);
    if (victim.right) this.emitAll('move.end', 1, victim.id);
    victim.left = false;
    victim.right = false;
    if (victim.shield.active) {
      victim.shield.active = false;
      this.emitAll('shield.expire', victim.id);
    }
    if (by) {
      by.kos++;
      this.addScore(by, KO_BONUS);
    }
    this.emitAll('player.ko', { id: victim.id, by: by ? by.id : null, respawnAt: victim.respawnAt });
    this.refreshTargets();
  }

  /** Brawl per-tick upkeep: respawns, the central power-up cycle and the round clock. */
  brawlTick(now: number) {
    for (const p of Object.values(this.players)) {
      if (p.alive || !p.respawnAt || now < p.respawnAt) continue;
      p.alive = true;
      p.hp = MAX_HP;
      p.respawnAt = 0;
      if (p.edge) p.position[EDGES[p.edge].axis] = 0;
      this.emitAll('player.respawn', p.id);
      this.refreshTargets();
    }

    if (!this.centralPending && now >= this.centralSpawnAt - CENTRAL_TELEGRAPH_MS) {
      this.centralPending = { id: crypto.randomBytes(4).toString('hex'), spawnAt: this.centralSpawnAt };
      this.emitAll('powerup.telegraph', { id: this.centralPending.id, position: { x: 0, y: 0, z: 0 }, spawnAt: this.centralSpawnAt });
    }
    if (this.centralPending && now >= this.centralPending.spawnAt) {
      const powerUp: PowerUp = {
        id: this.centralPending.id,
        type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
        position: { x: 0, y: 0, z: 0 },
        expiresAt: now + POWERUP_DURATION_MS,
        central: true,
      };
      this.powerUps[powerUp.id] = powerUp;
      this.emitAll('powerup.spawn', powerUp);
      this.centralPending = null;
      this.centralSpawnAt += CENTRAL_INTERVAL_MS;
    }

    this.checkBrawlEnd();
  }

  /**
   * Brawl round end. Clock at 0: a unique leader wins, a tie at the top goes to sudden death among the tied.
   * In sudden death the first tied player to score (`scorer`) wins; after BRAWL_SUDDEN_CAP_MS the tied player
   * with more hits, then more knockouts, then the lowest seat wins. Returns true when the match ended.
   */
  checkBrawlEnd(scorer?: Player): boolean {
    if (this.mode !== 'brawl') return false;
    if (this.phase === 'playing') {
      if (this.brawlRemainingMs() > 0) return false;
      const standings = this.standings();
      if (standings.length === 0) return false;
      const tied = standings.filter(s => s.score === standings[0].score);
      if (tied.length === 1) {
        this.finishBrawl(tied[0].id);
        return true;
      }
      this.phase = 'sudden_death';
      this.suddenIds = tied.map(s => s.id);
      this.suddenStart = Date.now();
      this.emitAll('sudden.death', { mode: 'brawl', playerIds: this.suddenIds });
      this.broadcastLobby();
      return false;
    }
    if (this.phase !== 'sudden_death') return false;
    this.suddenIds = this.suddenIds.filter(id => this.players[id]);
    if (scorer && this.suddenIds.includes(scorer.id)) {
      this.finishBrawl(scorer.id);
      return true;
    }
    if (this.suddenIds.length <= 1 || Date.now() - this.suddenStart >= BRAWL_SUDDEN_CAP_MS) {
      const hits = (p: Player) => this.stats[p.id]?.zombiesScored ?? 0;
      const byTiebreak = (a: Player, b: Player) => hits(b) - hits(a) || b.kos - a.kos || a.seat - b.seat;
      // Every tied player left: the best remaining player by score decides, then the same tiebreak.
      const pool = this.suddenIds.length > 0 ? this.suddenIds.map(id => this.players[id]) : Object.values(this.players);
      if (pool.length === 0) return false;
      pool.sort(this.suddenIds.length > 0 ? byTiebreak : (a, b) => b.score - a.score || byTiebreak(a, b));
      this.finishBrawl(pool[0].id);
      return true;
    }
    return false;
  }

  finishBrawl(winnerId: string) {
    this.emitStandings();
    this.endBrawlMatch(winnerId);
    this.broadcastLobby();
  }

  // Check synergy: if player fired specific combos recently
  checkSynergy(player: Player, weaponCode: number): { speedMult: number; healthBonus: number; extraCreatures: number } {
    const now = Date.now();
    const recent = player.recentFires.filter(r => now - r.time < SYNERGY_WINDOW_MS);
    const recentCodes = recent.map(r => r.weaponCode);

    let speedMult = 1;
    let healthBonus = 0;
    let extraCreatures = 0;

    // Fox + Flamingo = "Air Strike" — extra speed
    if (weaponCode === 3 && recentCodes.includes(1)) {
      speedMult = 1.5;
      this.emitAll('synergy', player.id, 'air_strike');
    }
    // Horse + Horde = "Stampede" — extra horde creatures
    if (weaponCode === 5 && recentCodes.includes(2)) {
      extraCreatures = 3;
      this.emitAll('synergy', player.id, 'stampede');
    }
    // Zombie + Horse = "Juggernaut" — extra HP
    if (weaponCode === 2 && recentCodes.includes(4)) {
      healthBonus = 2;
      this.emitAll('synergy', player.id, 'juggernaut');
    }
    // Fox + Fox = "Twin Strike" — fires 2 foxes
    if (weaponCode === 1 && recentCodes.filter(c => c === 1).length >= 2) {
      extraCreatures = 1;
      this.emitAll('synergy', player.id, 'twin_strike');
    }

    return { speedMult, healthBonus, extraCreatures };
  }

  /** Seated humans (the bot excluded). */
  humans(): Player[] {
    return Object.values(this.players).filter(p => !p.isBot);
  }

  /** Lowest free seat 0..3, or -1 when all four are taken. */
  freeSeat(): number {
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      if (!Object.values(this.players).some(p => p.seat === seat)) return seat;
    }
    return -1;
  }

  /** The mode the room would start in right now, from the number of seated humans. */
  previewMode(): GameMode {
    const n = this.humans().length;
    return n <= 1 ? 'solo' : n === 2 ? 'duel' : 'brawl';
  }

  isRanked(): boolean {
    return this.mode === 'duel';
  }

  arenaKind(): 'lane' | 'square' {
    return this.mode === 'brawl' ? 'square' : 'lane';
  }

  lobbyPayload() {
    const seats: Array<Record<string, any> | null> = Array.from({ length: MAX_SEATS }, () => null);
    for (const p of Object.values(this.players)) {
      if (p.seat < 0 || p.seat >= MAX_SEATS) continue;
      seats[p.seat] = {
        seat: p.seat,
        id: p.id,
        name: p.name,
        color: p.color,
        ready: p.isBot ? true : p.ready,
        connected: p.connected,
        isBot: p.isBot,
      };
    }
    return {
      phase: this.phase,
      mode: this.phase === 'lobby' ? this.previewMode() : this.mode,
      seats,
      queue: this.queue.map(q => ({ id: q.id, name: q.name })),
      invitePath: `/game/${this.id}`,
    };
  }

  broadcastLobby() {
    if (this.phase === 'lobby') this.mode = this.previewMode();
    this.emitAll('lobby', this.lobbyPayload());
  }

  /**
   * Seats the player when the room is in the lobby and has a free seat; otherwise they become a
   * queued spectator and take a seat when the room next enters the lobby.
   */
  joinPlayer(player: Player) {
    const seat = this.phase === 'lobby' ? this.freeSeat() : -1;
    if (seat < 0) {
      this.joinQueued(player);
      return;
    }

    logger.info('%s joined game %s as player (seat %s)', player.name, this.id, seat);
    this.lastActivity = Date.now();

    player.applySeat(seat);
    player.token = crypto.randomBytes(16).toString('hex');
    player.connected = true;
    player.ready = false;
    player.lastPing = Date.now();

    this.players[player.id] = player;
    this.roundWins[player.id] = 0;
    this.stats[player.id] = new PlayerStats();

    player.sendPlayerInfo();

    for (const key in this.players) {
      if (this.players[key] !== player) {
        this.players[key].sendOpponentInfo(player);
        player.sendOpponentInfo(this.players[key]);
      }
    }
    for (const key in this.spectators) {
      if (this.spectators[key] !== player) this.spectators[key].sendOpponentInfo(player);
    }

    this.registerPlayerHandlers(player);

    // Send ELO info
    player.socket.emit('elo', getElo(player.name));
    this.broadcastLobby();
  }

  /** Puts a late arrival (match running or room full) in the queue as a spectator. */
  joinQueued(player: Player) {
    logger.info('%s queued for game %s', player.name, this.id);
    this.queue.push(player);
    player.socket.emit('join.queued', { position: this.queue.length });
    this.joinSpectator(player);
  }

  /** Moves queued spectators into free seats, in join order. Only while the room is in the lobby. */
  fillSeatsFromQueue() {
    if (this.phase !== 'lobby') return;
    let moved = false;
    while (this.queue.length > 0 && this.freeSeat() >= 0) {
      const next = this.queue.shift()!;
      if (this.spectators[next.id] !== next) continue; // left in the meantime
      delete this.spectators[next.id];
      this.joinPlayer(next);
      moved = true;
    }
    if (moved) {
      this.announceQueuePositions();
      this.broadcastLobby();
    }
  }

  announceQueuePositions() {
    this.queue.forEach((q, i) => q.socket.emit('join.queued', { position: i + 1 }));
  }

  findByToken(token: string): Player | undefined {
    const wanted = Buffer.from(token);
    return Object.values(this.players).find(p => {
      if (p.isBot || !p.token) return false;
      const have = Buffer.from(p.token);
      return have.length === wanted.length && crypto.timingSafeEqual(have, wanted);
    });
  }

  /** Rebinds a seated player to a new socket (reload or dropped connection), keeping score and hp. */
  reconnectPlayer(player: Player, socket: Socket) {
    if (this.players[player.id] !== player) return;
    logger.info('Player %s (%s) reconnected to game %s', player.name, player.id, this.id);
    player.clearDisconnectTimer();
    player.socket = socket;
    player.connected = true;
    player.left = false;
    player.right = false;
    player.lastPing = Date.now();
    this.lastActivity = Date.now();

    this.registerPlayerHandlers(player);

    player.sendPlayerInfo();
    for (const key in this.players) {
      if (this.players[key] !== player) player.sendOpponentInfo(this.players[key]);
    }
    socket.emit('hazards', this.hazards);
    for (const puId in this.powerUps) {
      socket.emit('powerup.spawn', this.powerUps[puId]);
    }
    socket.emit('elo', getElo(player.name));
    if (this.phase === 'match_over' && this.lastMatchOver) socket.emit('match.over', this.lastMatchOver);
    this.emitAll('player.reconnected', player.id);
    this.broadcastLobby();
  }

  /** A player's connection dropped (socket closed or ping timeout). */
  handleDisconnect(player: Player) {
    if (this.players[player.id] !== player || player.isBot) return;
    if (this.phase === 'lobby') {
      this.exitPlayer(player);
      return;
    }
    if (!player.connected) return;
    logger.info('Player %s (%s) disconnected, holding seat for %sms', player.name, player.id, knobs.reconnectWindowMs);
    player.connected = false;
    player.left = false;
    player.right = false;
    this.lastActivity = Date.now();
    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (this.players[player.id] === player && !player.connected) this.exitPlayer(player);
    }, knobs.reconnectWindowMs);
    this.emitAll('player.disconnected', { id: player.id, until: Date.now() + knobs.reconnectWindowMs });
    this.broadcastLobby();
  }

  /** Registers the socket handlers of a seated player on its current socket. */
  registerPlayerHandlers(player: Player) {
    const socket = player.socket;
    // Game handlers only act while this exact Player is still in the game and this exact socket is
    // still its live connection, so a socket that has exited, been replaced by a reconnect or
    // dropped can no longer fire, place walls and so on.
    const isCurrent = () => this.players[player.id] === player && player.socket === socket;
    const onPlayer = (event: string, handler: (...args: any[]) => void) => {
      socket.on(event, (...args: any[]) => {
        if (!isCurrent() || !player.connected) return;
        handler(...args);
      });
    };

    onPlayer('fire', (clientPosition: Position, clientWeaponCode: number, clientChargeTime?: number) => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;
      if (!player.alive) return;

      const weaponCode = validWeaponCode(clientWeaponCode);
      const brawl = this.mode === 'brawl' && !!player.edge;
      const edge = player.edge;
      const spawnX = brawl && edge ? validFireLateral(clientPosition, edge, lateralOf(edge, player.position)) : validFireX(clientPosition, player.position.x);
      if (weaponCode === null || spawnX === null || (clientChargeTime !== undefined && !isFiniteNumber(clientChargeTime))) {
        logger.debug('Dropped invalid fire from %s', player.id);
        return;
      }
      // Server-authoritative spawn: z and y come from the server's player, x is the clamped client x.
      // Brawl: the creature spawns on the player's edge line and heads for the firer's current target.
      const position: Position = brawl && edge ? edgePoint(edge, spawnX) : { x: spawnX, y: player.position.y, z: player.position.z };
      const target = brawl ? this.activeTarget(player) : null;
      const heading = brawl && edge ? headingTo(position, target ? target.position : null, edge) : null;
      // Offset a spawn point sideways along the firer's lateral axis (horde spread, synergy extras).
      const offsetPos = (offset: number): Position => (brawl && edge
        ? edgePoint(edge, clampEdgeTravel(spawnX + offset))
        : { x: position.x + offset, y: position.y, z: position.z });

      // Fire rate check (server-authoritative)
      const now = Date.now();
      let delay = fireDelayFromCode(weaponCode);
      if (player.hasPowerUp('rapid_fire')) delay *= 0.5;
      if (now - player.lastFireTime < delay) return;
      // A player cannot have charged longer than since their last shot.
      const charge = effectiveCharge(clientChargeTime, now - player.lastFireTime) ?? 0;
      player.lastFireTime = now;

      logger.verbose('A zombie was added in game %s', this.id, position);

      const upgradeLevel = player.upgradeLevel;
      const baseHealth = healthFromCode(weaponCode);
      let health = upgradeLevel >= 2 ? baseHealth + 1 : baseHealth;
      const baseSpeed = speedFromCode(weaponCode);
      let speed = upgradeLevel >= 1 ? baseSpeed + 50 : baseSpeed;

      // Charged shot bonus
      const chargeRatio = charge / MAX_CHARGE_MS;
      if (chargeRatio > 0.3) {
        speed += Math.round(chargeRatio * 100);
        health += Math.floor(chargeRatio * 2);
      }

      // Speed boost power-up
      if (player.hasPowerUp('speed_boost')) {
        speed += 100;
      }

      // Sudden death buff
      if (this.suddenDeath) {
        speed *= 2;
        health += 1;
      }

      // Synergy check
      const synergy = this.checkSynergy(player, weaponCode);
      speed = Math.round(speed * synergy.speedMult);
      health += synergy.healthBonus;

      // Track recent fires for synergy
      player.recentFires.push({ weaponCode, time: now });
      player.recentFires = player.recentFires.filter(r => now - r.time < SYNERGY_WINDOW_MS);

      const createZombie = (pos: Position, hp: number, spd: number) => {
        const zombieName = uniqueNamesGenerator(zombieNameConfig);
        const zombie = new Zombie(zombieName, pos, player.direction * -1, player.id, hp, weaponCode, spd, chargeRatio);
        if (heading) zombie.setHeading(heading.vx, heading.vz, target ? target.id : null);
        this.zombies[zombie.id] = zombie;
        this.emitAll('zombie', zombie.toJSON(), player.id);
      };

      if (weaponCode === 5) {
        const count = 5 + synergy.extraCreatures;
        for (let i = 0; i < count; i++) {
          const spreadX = (i - Math.floor(count / 2)) * 60;
          const hordePos = offsetPos(spreadX);
          createZombie(hordePos, health, speed);
        }
        this.stats[player.id].zombiesFired += count;
      } else {
        createZombie(position, health, speed);
        // Extra creatures from synergy
        for (let i = 0; i < synergy.extraCreatures; i++) {
          const offset = (i + 1) * 80;
          createZombie(offsetPos(offset), health, speed);
        }
        this.stats[player.id].zombiesFired += 1 + synergy.extraCreatures;
      }
    });

    onPlayer('move.start', (keyCode: number) => {
      if (!isFiniteNumber(keyCode) || !player.alive) return;
      player.toggleMovement(keyCode, true);
      this.emitAll('move.start', keyCode, player.id);
    });

    onPlayer('move.end', (keyCode: number) => {
      if (!isFiniteNumber(keyCode)) return;
      player.toggleMovement(keyCode, false);
      this.emitAll('move.end', keyCode, player.id);
    });

    onPlayer('weapon.set', (clientCode: number) => {
      const code = validWeaponCode(clientCode);
      if (code === null) {
        logger.debug('Dropped invalid weapon.set from %s', player.id);
        return;
      }
      logger.debug('Player ' + player.id + ' switch to ' + code);
      player.setWeaponCode(code);
      this.emitAll('weapon.set', code, player.id);
    });

    onPlayer('shield', () => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;
      if (!player.alive) return;
      const now = Date.now();
      if (player.shield.active) return;
      if (now < player.shield.cooldownUntil) return;

      player.shield.active = true;
      player.shield.expiresAt = now + SHIELD_DURATION_MS;
      player.shield.cooldownUntil = now + SHIELD_COOLDOWN_MS;
      this.emitAll('shield.activate', player.id);
    });

    // Wall placement
    onPlayer('place.wall', (clientX: number) => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;
      if (!player.alive) return;
      if (!isFiniteNumber(clientX)) {
        logger.debug('Dropped invalid place.wall from %s', player.id);
        return;
      }
      const brawl = this.mode === 'brawl' && !!player.edge;
      const lateral = brawl ? clampEdgeTravel(clientX) : clampArenaX(clientX);
      if (player.score < WALL_COST) return;

      player.score -= WALL_COST;
      const now = Date.now();
      const wall: Wall = {
        id: crypto.randomBytes(4).toString('hex'),
        position: { x: lateral, y: 0, z: player.position.z + player.direction * -200 },
        width: WALL_WIDTH,
        ownerId: player.id,
        expiresAt: now + WALL_DURATION_MS,
        axis: 'x',
      };
      if (brawl && player.edge) {
        // In front of the player along the inward normal, extending along the lateral axis.
        const def = EDGES[player.edge];
        const base = edgePoint(player.edge, lateral);
        wall.position = { x: base.x + def.nx * WALL_OFFSET, y: 0, z: base.z + def.nz * WALL_OFFSET };
        wall.axis = def.axis;
      }
      this.walls[wall.id] = wall;
      this.emitAll('wall.place', wall);
      this.emitStandings();
    });

    onPlayer('target.set', (targetId: unknown) => {
      if (this.mode !== 'brawl' || this.phase === 'lobby') return;
      if (typeof targetId !== 'string' || targetId === player.id) return;
      if (!Object.prototype.hasOwnProperty.call(this.players, targetId)) return;
      const target = this.players[targetId];
      if (target.isBot || !target.alive || !player.alive) return;
      if (player.targetId === targetId) return;
      player.targetId = targetId;
      this.emitAll('target', player.id, targetId);
    });

    onPlayer('ready', () => {
      player.ready = true;
      this.broadcastLobby();
      this.checkReady();
    });

    onPlayer('unready', () => {
      if (this.phase !== 'lobby') return;
      player.ready = false;
      this.broadcastLobby();
    });

    onPlayer('rematch', () => {
      player.wantsRematch = true;
      this.checkRematch();
    });

    onPlayer('lobby.return', () => {
      this.returnToLobby();
    });

    onPlayer('exit', () => {
      this.exitPlayer(player);
    });

    // A ping from a socket we marked as dropped (ping timeout) revives the seat.
    socket.on('pingpong', () => {
      if (!isCurrent()) return;
      logger.debug(`Ping from ${player.name} (${player.id})`);
      player.lastPing = Date.now();
      if (!player.connected) {
        player.clearDisconnectTimer();
        player.connected = true;
        this.emitAll('player.reconnected', player.id);
        this.broadcastLobby();
      }
      socket.emit('pong');
    });

    socket.on('disconnect', () => {
      if (!isCurrent()) return;
      this.handleDisconnect(player);
    });
  }

  checkReady() {
    if (this.phase !== 'lobby' && this.phase !== 'round_over') return;
    const humans = this.humans();
    // A match needs at least one human (solo adds a bot).
    if (humans.length < 1) return;
    if (!humans.every(p => p.ready)) return;

    if (this.phase === 'lobby') this.prepareMatch();
    this.startCountdown();
  }

  /** Decides the mode from the headcount, tidies seats for lane modes and seats the bot for solo. */
  prepareMatch() {
    this.mode = this.previewMode();
    let changed = false;
    {
      // Lane modes use seats 0 and 1 (north/south), brawl seats 0..n-1 (N, S, W, E), whatever seats the
      // humans held in the lobby.
      const humans = this.humans().sort((x, y) => x.seat - y.seat);
      humans.forEach((p, i) => {
        if (p.seat !== i) {
          p.applySeat(i);
          changed = true;
        }
      });
    }
    if (this.mode === 'solo' && !Object.values(this.players).some(p => p.isBot)) {
      const bot = createBot(this);
      this.players[bot.id] = bot;
      this.botBrain = new BotBrain(this, bot);
      this.roundWins[bot.id] = 0;
      this.stats[bot.id] = new PlayerStats();
      changed = true;
    }
    if (changed) this.announceRoster();
    if (this.mode === 'brawl') {
      for (const p of Object.values(this.players)) p.targetId = null;
    }
    this.refreshTargets();
  }

  /** The seated, alive opponent the player is aiming at, or null. */
  activeTarget(player: Player): Player | null {
    const t = player.targetId ? this.players[player.targetId] : undefined;
    return t && t !== player && t.alive ? t : null;
  }

  /** Next seated, alive opponent clockwise (N→E→S→W) after `fromSeat`, or null when nobody is left. */
  nextClockwise(player: Player, fromSeat: number): Player | null {
    const start = CLOCKWISE_SEATS.indexOf(fromSeat);
    for (let i = 1; i <= CLOCKWISE_SEATS.length; i++) {
      const seat = CLOCKWISE_SEATS[(start + i) % CLOCKWISE_SEATS.length];
      const cand = Object.values(this.players).find(p => p.seat === seat);
      if (cand && cand !== player && cand.alive && !cand.isBot) return cand;
    }
    return null;
  }

  /**
   * Brawl: gives every player a valid target. A target that left or is knocked out (`alive === false`) is
   * replaced by the next opponent clockwise after it; `leftSeat` is the seat of a target that was just removed.
   * Broadcasts `target` for every change. Call it whenever the roster or anybody's `alive` changes.
   */
  refreshTargets(leftSeat?: { id: string; seat: number }) {
    if (this.mode !== 'brawl') return;
    for (const p of Object.values(this.players)) {
      if (this.activeTarget(p)) continue;
      const old = p.targetId ? this.players[p.targetId] : undefined;
      const from = old ? old.seat : leftSeat && leftSeat.id === p.targetId ? leftSeat.seat : p.seat;
      const next = this.nextClockwise(p, from);
      const nextId = next ? next.id : null;
      if (nextId !== p.targetId) {
        p.targetId = nextId;
        this.emitAll('target', p.id, nextId);
      }
    }
  }

  /** Tells everyone about the current seats (sent when seats change at match start). */
  announceRoster() {
    for (const p of this.humans()) {
      p.sendPlayerInfo();
    }
    for (const key in this.players) {
      const p = this.players[key];
      for (const other in this.players) {
        if (other !== key) p.sendOpponentInfo(this.players[other]);
      }
      for (const sid in this.spectators) this.spectators[sid].sendOpponentInfo(p);
    }
  }

  removeBot() {
    this.botBrain?.dispose();
    this.botBrain = null;
    for (const id of Object.keys(this.players)) {
      if (!this.players[id].isBot) continue;
      this.emitAll('player.exit', id);
      delete this.players[id];
      delete this.roundWins[id];
      delete this.stats[id];
    }
  }

  startCountdown() {
    this.clearCountdown();
    this.phase = 'countdown';
    let remaining = knobs.countdownSeconds;

    this.emitAll('game.countdown', remaining);
    this.broadcastLobby();

    this.countdownTimer = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        this.emitAll('game.countdown', remaining);
      } else {
        this.clearCountdown();
        this.phase = 'playing';
        this.roundStartTime = Date.now();
        this.suddenDeath = false;
        this.lastPowerUpSpawn = 0;
        this.centralSpawnAt = this.roundStartTime + CENTRAL_FIRST_MS;
        this.resetBrawlState();
        this.generateHazards();
        const brawl = this.mode === 'brawl';
        this.emitAll('game.start', {
          mode: this.mode,
          ranked: this.isRanked(),
          arena: { kind: this.arenaKind() },
          ...(brawl ? { roundDurationMs: knobs.brawlRoundMs } : {}),
        });
        this.emitStandings(true);
        this.broadcastLobby();
      }
    }, knobs.countdownTickMs);
  }

  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * The state every reset path clears: creatures, power-ups, walls, hazards, brawl state, the stored `match.over`.
   * `newMatch` also zeroes round, wins and stats and the rematch votes (lobby / rematch); without it only the
   * players are readied for the next round.
   */
  clearMatchState(opts: { newMatch?: boolean } = {}) {
    this.zombies = {};
    this.powerUps = {};
    this.walls = {};
    this.hazards = [];
    this.suddenDeath = false;
    this.resetBrawlState();
    this.lastStandingsKey = '';
    this.lastMatchOver = null;
    if (opts.newMatch) {
      this.round = 1;
      this.roundWins = {};
      this.stats = {};
    }
    for (const id in this.players) {
      if (opts.newMatch) {
        this.roundWins[id] = 0;
        this.stats[id] = new PlayerStats();
        this.players[id].wantsRematch = false;
      }
      this.players[id].resetForRound();
    }
  }

  /**
   * Back to a fresh lobby for whoever is still here: bot removed, queued spectators take free seats.
   * `ready` is what the remaining humans' ready flag becomes: everybody readies again by default.
   */
  resetToLobby(opts: { ready?: boolean } = {}) {
    const ready = opts.ready ?? false;
    this.clearCountdown();
    if (this.roundResetTimer) {
      clearTimeout(this.roundResetTimer);
      this.roundResetTimer = null;
    }
    this.removeBot();
    // The lobby rule applies the moment the room enters it: a dropped player's held seat is freed at once.
    for (const p of this.humans()) {
      if (p.connected) continue;
      p.clearDisconnectTimer();
      this.emitAll('player.exit', p.id);
      delete this.players[p.id];
    }
    this.phase = 'lobby';
    this.clearMatchState({ newMatch: true });
    for (const id in this.players) this.players[id].ready = ready;
    this.mode = this.previewMode();
    this.emitAll('game.reset');
    this.fillSeatsFromQueue();
    this.broadcastLobby();
  }

  /** Ends a running brawl early (everybody else left): brawl `match.over`, no ELO, rematch/return offered. */
  endBrawlMatch(winnerId: string) {
    this.clearCountdown();
    if (this.roundResetTimer) {
      clearTimeout(this.roundResetTimer);
      this.roundResetTimer = null;
    }
    this.zombies = {};
    this.phase = 'match_over';
    this.resetBrawlState();
    this.emitBrawlOver(winnerId);
  }

  emitBrawlOver(winnerId: string) {
    this.emitMatchOver({
      mode: this.mode,
      ranked: false,
      winner: winnerId,
      roundWins: this.roundWins,
      standings: this.standings(),
      stats: this.stats,
    });
  }

  emitMatchOver(payload: Record<string, unknown>) {
    this.lastMatchOver = payload;
    this.emitAll('match.over', payload);
  }

  /** `lobby.return`: everyone back to the lobby (after a match, or any time during a solo match). */
  returnToLobby() {
    const allowed = this.phase === 'match_over' || (this.mode === 'solo' && this.phase !== 'lobby');
    if (!allowed) return;
    this.resetToLobby({ ready: false });
  }

  checkRematch() {
    if (this.phase !== 'match_over') return;
    const humans = this.humans();
    if (humans.length < 1) return;

    const allWant = humans.every(p => p.wantsRematch);
    if (!allWant) return;

    this.removeBot();
    this.phase = 'lobby';
    this.clearMatchState({ newMatch: true });
    this.emitAll('game.rematch');

    // Queued spectators take any free seats; the new roster starts straight away.
    this.fillSeatsFromQueue();
    for (const p of this.humans()) {
      p.ready = true;
    }
    this.checkReady();
  }

  resetForNextRound() {
    this.clearMatchState();

    for (const key in this.players) {
      this.players[key].ready = true;
    }
    this.checkReady();
  }

  exitPlayer(player: Player) {
    if (this.players[player.id] !== player) return;
    logger.info(`Player ${player.name} (${player.id}) exited`);
    const leftSeat = { id: player.id, seat: player.seat };
    player.clearDisconnectTimer();
    this.emitAll('player.exit', player.id);
    delete this.players[player.id];
    delete this.roundWins[player.id];
    delete this.stats[player.id];
    this.lastActivity = Date.now();
    if (this.phase !== 'lobby') this.refreshTargets(leftSeat);

    const humansLeft = this.humans();
    if (this.phase === 'lobby') {
      this.fillSeatsFromQueue();
      this.broadcastLobby();
      // Everyone left may already be ready (the one who was holding the start up has gone).
      this.checkReady();
    } else if (this.mode === 'brawl' && humansLeft.length >= 2) {
      // A brawl carries on while at least two humans remain.
      this.checkBrawlEnd();
      this.emitStandings();
      this.checkRematch();
      this.broadcastLobby();
    } else if (this.mode === 'brawl' && humansLeft.length === 1) {
      // Down to one human: the brawl ends with them as the winner (unless it was already over).
      if (this.phase === 'countdown') this.resetToLobby(); // nobody played: no winner
      else if (this.phase !== 'match_over') this.endBrawlMatch(humansLeft[0].id);
      else this.checkRematch();
      this.broadcastLobby();
    } else {
      this.resetToLobby();
    }
    if (this.humans().length === 0) {
      logger.info(`No more players in ${this.id}!`);
    }
  }

  joinSpectator(spectator: Player) {
    logger.info('%s joined game %s as spectator', spectator.id, this.id);

    for (const key in this.players) {
      spectator.sendOpponentInfo(this.players[key]);
    }

    this.spectators[spectator.id] = spectator;
    this.lastActivity = Date.now();
    const onSpectator = (event: string, handler: (...args: any[]) => void) => {
      spectator.socket.on(event, (...args: any[]) => {
        if (this.spectators[spectator.id] !== spectator) return;
        handler(...args);
      });
    };
    spectator.socket.on('disconnect', () => {
      if (this.spectators[spectator.id] === spectator) delete this.spectators[spectator.id];
      this.lastActivity = Date.now();
      const queued = this.queue.indexOf(spectator);
      if (queued >= 0) {
        this.queue.splice(queued, 1);
        this.announceQueuePositions();
        this.broadcastLobby();
      }
    });
    this.emitAll('spectator', spectator.toJSON());

    onSpectator('pingpong', () => {
      spectator.lastPing = Date.now();
      spectator.socket.emit('pong');
    });

    // Spectator interference voting
    onSpectator('spectator.vote', (eventType: string) => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;
      const now = Date.now();
      if (now - this.lastSpectatorVote < SPECTATOR_VOTE_COOLDOWN_MS) return;
      this.lastSpectatorVote = now;

      switch (eventType) {
        case 'speed_burst': {
          // All creatures get a speed burst
          for (const key in this.zombies) {
            this.zombies[key].speed *= 1.5;
          }
          this.emitAll('spectator.event', 'speed_burst', spectator.name);
          break;
        }
        case 'spawn_obstacle': {
          // Spawn a temporary wall in the middle
          const wall: Wall = {
            id: crypto.randomBytes(4).toString('hex'),
            position: { x: (Math.random() - 0.5) * 400, y: 0, z: (Math.random() - 0.5) * 600 },
            width: 200,
            ownerId: 'spectator',
            expiresAt: now + 4000,
            axis: 'x',
          };
          this.walls[wall.id] = wall;
          this.emitAll('wall.place', wall);
          this.emitAll('spectator.event', 'spawn_obstacle', spectator.name);
          break;
        }
        case 'heal_all': {
          for (const pid in this.players) {
            if (!this.players[pid].alive) continue;
            this.players[pid].hp = Math.min(MAX_HP, this.players[pid].hp + 2);
            this.emitAll('player.heal', pid, this.players[pid].hp);
          }
          this.emitAll('spectator.event', 'heal_all', spectator.name);
          break;
        }
      }
    });

    // Send current hazards and power-ups
    spectator.socket.emit('hazards', this.hazards);
    for (const puId in this.powerUps) {
      spectator.socket.emit('powerup.spawn', this.powerUps[puId]);
    }
    this.broadcastLobby();
  }

  update(elapsed: number) {
    if (this.updating) return;
    if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;

    this.updating = true;
    try {
      this.runUpdate(elapsed);
    } catch (err) {
      logger.error('Error in game %s update: %s', this.id, err instanceof Error ? (err.stack || err.message) : String(err));
    } finally {
      this.updating = false;
    }
  }

  private runUpdate(elapsed: number) {
    const now = Date.now();
    this.botBrain?.tick();

    // Spawn power-ups
    this.spawnPowerUp();

    // Check power-up collection
    this.checkPowerUpCollisions();

    // Check wall expiry
    this.checkWalls();

    // Check sudden death
    this.checkSuddenDeath();
    if (this.mode === 'brawl') {
      this.brawlTick(now);
      if (this.phase === 'match_over') return;
    }

    // Expire player power-ups
    for (const key in this.players) {
      this.players[key].expirePowerUps(now);
    }

    // Update shields
    for (const key in this.players) {
      const player = this.players[key];
      if (player.shield.active && now >= player.shield.expiresAt) {
        player.shield.active = false;
        this.emitAll('shield.expire', player.id);
      }
    }

    for (const key in this.players) {
      const player = this.players[key];
      if (!player.alive) continue;
      player.update(elapsed, this.mode === 'brawl');
    }

    for (const key of Object.keys(this.zombies)) {
      if (!this.zombies[key]) continue;

      const zombie = this.zombies[key];
      zombie.update(elapsed);

      // Arena hazard effects
      for (const hazard of this.hazards) {
        const hx = Math.abs(zombie.position.x - hazard.position.x);
        const hz = Math.abs(zombie.position.z - hazard.position.z);
        if (hx < hazard.width / 2 && hz < hazard.depth / 2) {
          switch (hazard.type) {
            case 'damage':
              // One hit per creature per damage hazard, however long it stays inside
              if (!zombie.hazardsHit.has(hazard.id)) {
                zombie.hazardsHit.add(hazard.id);
                zombie.health -= 1;
                if (zombie.health <= 0) {
                  this.emitAll('zombie.hazard', zombie.id, hazard.id);
                  delete this.zombies[key];
                }
              }
              break;
            case 'slow':
              if (zombie.brawl) zombie.nudge(-elapsed * zombie.speed * zombie.vx * 0.5, -elapsed * zombie.speed * zombie.vz * 0.5);
              else zombie.position.z -= elapsed * zombie.speed * zombie.direction * 0.5; // counteract half movement
              break;
            case 'wind':
              if (zombie.brawl) zombie.nudge(elapsed * 150 * (hazard.windDirection || 1), 0);
              else zombie.position.x += elapsed * 150 * (hazard.windDirection || 1);
              break;
          }
        }
      }

      if (!this.zombies[key]) continue;

      // Wall collision
      let wallBlocked = false;
      for (const wId in this.walls) {
        const wall = this.walls[wId];
        if (wall.ownerId === zombie.firedByPlayer) continue; // own walls don't block own creatures
        const wz = Math.abs(zombie.position.z - wall.position.z);
        const wx = Math.abs(zombie.position.x - wall.position.x);
        const hit = wall.axis === 'z' ? wx < 50 && wz < wall.width / 2 : wz < 50 && wx < wall.width / 2;
        if (hit) {
          this.emitAll('zombie.walled', zombie.id, wId);
          delete this.zombies[key];
          wallBlocked = true;
          break;
        }
      }
      if (wallBlocked) continue;

      // Check shield collision
      let shieldDestroyed = false;
      for (const pid in this.players) {
        const player = this.players[pid];
        if (!player.shield.active) continue;
        if (zombie.firedByPlayer === pid) continue;

        const shieldZ = player.position.z;
        const zDist = Math.abs(zombie.position.z - shieldZ);
        const xDist = Math.abs(zombie.position.x - player.position.x);
        // Brawl: 150 from the player's edge line, 300 along it (swapped on the W/E edges).
        const sideEdge = this.mode === 'brawl' && !!player.edge && EDGES[player.edge].axis === 'z';
        const blocked = sideEdge ? xDist < 150 && zDist < 300 : zDist < 150 && xDist < 300;
        if (blocked) {
          this.emitAll('zombie.shielded', zombie.id, pid);
          delete this.zombies[key];
          shieldDestroyed = true;
          break;
        }
      }
      if (shieldDestroyed) continue;

      if (this.isOutOfBounds(zombie)) {
        const firingPlayer = this.players[zombie.firedByPlayer];

        const brawl = this.mode === 'brawl';
        let scorer: Player | undefined;
        const opponentId = brawl ? this.pickBrawlVictim(zombie) : this.pickDamageTarget(zombie);

        // A player in their reconnect window cannot be hurt: the creature just disappears, nobody scores.
        if (opponentId && !this.players[opponentId].connected) {
          this.emitAll('zombie.out-of-bounds', zombie.id, zombie.firedByPlayer, null);
          delete this.zombies[key];
          continue;
        }

        // Brawl: only a creature that hits an opponent's edge scores (empty and own edges are plain misses).
        if (firingPlayer && (!brawl || opponentId)) {
          const timeSinceLast = now - firingPlayer.lastScoreTime;
          let points = 1;
          scorer = firingPlayer;

          // Double points power-up
          if (firingPlayer.hasPowerUp('double_points')) points *= 2;

          if (timeSinceLast < COMBO_WINDOW_MS && firingPlayer.lastScoreTime > 0) {
            firingPlayer.comboCount++;
            const comboBonus = Math.floor(firingPlayer.comboCount * 0.5);
            this.addScore(firingPlayer, points + comboBonus);
            this.emitAll('combo', firingPlayer.id, firingPlayer.comboCount);
          } else {
            firingPlayer.comboCount = 0;
            this.addScore(firingPlayer, points);
          }
          firingPlayer.lastScoreTime = now;

          this.stats[zombie.firedByPlayer].zombiesScored++;
        }

        if (opponentId && this.players[opponentId]) {
          const victim = this.players[opponentId];
          victim.hp -= 1;
          this.emitAll('player.damage', opponentId, victim.hp, zombie.firedByPlayer);
          if (brawl && victim.hp <= 0 && victim.alive) this.knockOut(victim, firingPlayer);
        }

        this.emitAll('zombie.out-of-bounds', zombie.id, zombie.firedByPlayer, opponentId);
        delete this.zombies[key];

        if (brawl) {
          this.emitStandings();
          if (this.checkBrawlEnd(scorer)) break;
          continue;
        }
        if (this.checkRoundEnd()) break;
        continue;
      }

      for (const otherKey in this.zombies) {
        if (key === otherKey) continue;

        const otherZombie = this.zombies[otherKey];
        if (!otherZombie) continue;

        if (zombie.isCollision(otherZombie)) {
          this.emitAll('zombie.collision', zombie.id, otherZombie.id);

          this.zombies[key].health -= 1;
          this.zombies[otherKey].health -= 1;

          // Credit each kill to the owner of the creature that landed the hit.
          if (zombie.firedByPlayer !== otherZombie.firedByPlayer) {
            if (this.zombies[key].health <= 0 && this.stats[otherZombie.firedByPlayer]) this.stats[otherZombie.firedByPlayer].zombiesDestroyed++;
            if (this.zombies[otherKey].health <= 0 && this.stats[zombie.firedByPlayer]) this.stats[zombie.firedByPlayer].zombiesDestroyed++;
          }

          // Creature ability on kill: surviving creature gets a buff
          if (this.zombies[key].health <= 0 && this.zombies[otherKey].health > 0) {
            // otherZombie killed this zombie — buff otherZombie
            this.zombies[otherKey].speed += 50;
            this.emitAll('zombie.killbuff', otherZombie.id);
          } else if (this.zombies[otherKey].health <= 0 && this.zombies[key].health > 0) {
            // this zombie killed otherZombie — buff this zombie
            this.zombies[key].speed += 50;
            this.emitAll('zombie.killbuff', zombie.id);
          }

          if (this.zombies[key].health <= 0) {
            delete this.zombies[key];
          }

          if (this.zombies[otherKey] && this.zombies[otherKey].health <= 0) {
            delete this.zombies[otherKey];
          }

          if (!this.zombies[key]) break;
        }
      }
    }
  }

  /** Duel/solo: the other player (the lane carries a creature to the opposite end). */
  pickDamageTarget(zombie: Zombie): string | null {
    const owner = this.players[zombie.firedByPlayer];
    if (!owner) return null;
    const other = Object.values(this.players).find(p => p.id !== owner.id && p.hp > 0);
    return other ? other.id : null;
  }

  /** Brawl: the owner of the edge the creature left through, if that is a seated, alive player other than its firer. */
  pickBrawlVictim(zombie: Zombie): string | null {
    const edge = exitedEdge(zombie.position);
    if (!edge) return null;
    const owner = Object.values(this.players).find(p => p.edge === edge);
    if (!owner || owner.id === zombie.firedByPlayer || !owner.alive || owner.isBot) return null;
    return owner.id;
  }

  standings() {
    return Object.values(this.players)
      .map(p => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        color: p.color,
        score: p.score,
        hits: this.stats[p.id]?.zombiesScored ?? 0,
        kos: p.kos,
        captures: p.captures,
      }))
      .sort((x, y) => y.score - x.score || y.hits - x.hits || x.seat - y.seat);
  }

  checkRoundEnd(): boolean {
    if (this.mode === 'brawl') return false; // brawl is timed: see checkBrawlEnd
    if (this.phase !== 'playing' && this.phase !== 'sudden_death') return false;
    const playerIds = Object.keys(this.players);
    if (playerIds.length < 2) return false;

    let roundWinner: string | null = null;

    const dead = playerIds.filter(id => this.players[id].hp <= 0);
    if (dead.length > 0) {
      const alive = playerIds.filter(id => this.players[id].hp > 0);
      if (playerIds.length === 2) {
        roundWinner = alive[0] || null;
      } else if (alive.length === 1) {
        roundWinner = alive[0];
      } else if (alive.length === 0) {
        roundWinner = [...playerIds].sort((x, y) => this.players[y].score - this.players[x].score)[0];
      }
    }

    if (!roundWinner) {
      for (const id of playerIds) {
        if (this.players[id].score >= knobs.pointsToWin) {
          roundWinner = id;
          break;
        }
      }
    }

    if (!roundWinner) return false;

    this.roundWins[roundWinner] = (this.roundWins[roundWinner] || 0) + 1;

    const roundLoser = playerIds.find(pid => pid !== roundWinner) || '';

    const scores: Record<string, number> = {};
    for (const id of playerIds) scores[id] = this.players[id]?.score || 0;

    this.emitAll('round.end', {
      winner: roundWinner,
      loser: roundLoser,
      round: this.round,
      roundWins: this.roundWins,
      scores,
    });

    if (this.roundWins[roundWinner] >= knobs.roundsToWin) {
      this.phase = 'match_over';
      const ranked = this.isRanked();

      if (!ranked) {
        this.emitMatchOver({
          mode: this.mode,
          ranked,
          winner: roundWinner,
          loser: roundLoser,
          roundWins: this.roundWins,
          stats: this.stats,
        });
      } else {
        // Duel (two humans): ELO and leaderboard as always.
        const winnerName = this.players[roundWinner]?.name || '';
        const loserName = this.players[roundLoser]?.name || '';
        // A player whose connection dropped is not rated for a match that ended while they were away.
        const bothHere = !!this.players[roundWinner]?.connected && !!this.players[roundLoser]?.connected;
        if (winnerName && loserName && bothHere) {
          updateElo(winnerName, loserName);
        }

        this.emitMatchOver({
          mode: this.mode,
          ranked,
          winner: roundWinner,
          loser: roundLoser,
          roundWins: this.roundWins,
          stats: this.stats,
          elo: {
            [roundWinner]: getElo(winnerName),
            [roundLoser]: getElo(loserName),
          },
          leaderboard: getLeaderboard(),
        });
      }
      this.broadcastLobby();
    } else {
      this.phase = 'round_over';
      this.round++;

      this.roundResetTimer = setTimeout(() => {
        this.roundResetTimer = null;
        if (this.phase === 'round_over') {
          this.resetForNextRound();
          this.emitAll('round.reset');
        }
      }, 3000);
    }

    return true;
  }

  toJSON() {
    const state: Record<string, any> = {
      players: {},
      zombies: {},
      phase: this.phase,
      round: this.round,
      roundWins: this.roundWins,
      powerUps: this.powerUps,
      walls: this.walls,
      suddenDeath: this.suddenDeath,
      mode: this.phase === 'lobby' ? this.previewMode() : this.mode,
    };

    for (const key in this.players) {
      state.players[key] = this.players[key].toJSON();
    }

    for (const key in this.zombies) {
      state.zombies[key] = this.zombies[key].toJSON();
    }

    if (this.mode === 'brawl' && this.phase !== 'lobby') {
      state.roundRemainingMs = this.brawlRemainingMs();
      state.standings = this.standings();
      if (this.phase === 'sudden_death') state.suddenPlayerIds = this.suddenIds;
    }

    return state;
  }

  elapsed(): number {
    const newTime = Date.now();
    const elapsed = newTime - this.timestamp;
    this.timestamp = newTime;
    return elapsed / 1000;
  }

  start() {
    this.stop();
    this.intervals.push(
      setInterval(() => {
        this.emitAll('state', this.toJSON());
      }, 200),
      setInterval(() => {
        this.update(this.elapsed());
      }, 100),
      setInterval(() => {
        this.checkPing();
        this.removeIfAbandoned();
      }, knobs.sweepIntervalMs),
    );
  }

  /** Clears every timer the game owns. Safe to call more than once. */
  stop() {
    this.botBrain?.dispose();
    this.botBrain = null;
    for (const handle of this.intervals) clearInterval(handle);
    this.intervals = [];
    this.clearCountdown();
    if (this.roundResetTimer) {
      clearTimeout(this.roundResetTimer);
      this.roundResetTimer = null;
    }
    for (const id in this.players) {
      this.players[id].clearDisconnectTimer();
    }
    this.resetBrawlState();
  }

  /** Stops and deletes the game once it has had nobody in it for EMPTY_GAME_TTL_MS. */
  removeIfAbandoned() {
    // Bots do not count as occupants.
    if (this.humans().length > 0 || Object.keys(this.spectators).length > 0) return;
    if (Date.now() - this.lastActivity < knobs.emptyGameTtlMs) return;
    logger.info('Removing empty game %s', this.id);
    this.stop();
    if (games[this.id] === this) delete games[this.id];
  }

  checkPing() {
    Object.keys(this.players).forEach((key) => {
      const player = this.players[key];
      if (player.isBot || !player.connected) return;
      if (Date.now() - player.lastPing >= 5000) {
        logger.warn(`Player ${player.id} did not ping for a long time!`);
        // Same as a dropped socket: the seat is held for the reconnect window (outside the lobby).
        this.handleDisconnect(player);
      }
    });
  }

  isOutOfBounds(zombie: Zombie): boolean {
    if (this.mode === 'brawl') return exitedEdge(zombie.position) !== null;
    return zombie.position.z < -1500 || zombie.position.z > 1500;
  }
}

class PlayerStats {
  zombiesFired: number = 0;
  zombiesScored: number = 0;
  zombiesDestroyed: number = 0;
  damageDealt: number = 0;
}

class Player {
  id: string;
  name: string;
  position: Position;
  direction: number;
  socket: Socket;
  left: boolean;
  right: boolean;
  weaponCode: number;
  lastPing: number;
  score: number;
  hp: number;
  ready: boolean;
  wantsRematch: boolean;
  shield: { active: boolean; cooldownUntil: number; expiresAt: number };
  lastScoreTime: number;
  comboCount: number;
  upgradeLevel: number;
  activePowerUps: ActivePowerUp[];
  recentFires: FiredCreatureRecord[];
  lastFireTime: number;
  seat: number;
  color: string;
  edge: Edge | null;
  isBot: boolean;
  /** Secret handed to the seated client so it can reclaim the seat after a reload or dropped connection. */
  token: string;
  connected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Starting x of the seat; resetForRound puts the player back here. */
  homeX: number;
  /** Brawl: who this player aims at (null in lane modes or when nobody is left). */
  targetId: string | null;
  /** False while knocked out (brawl KO/respawn); a not-alive player is skipped as target and as hit victim. */
  alive: boolean;
  /** Brawl: epoch ms when a knocked-out player comes back. */
  respawnAt: number;
  kos: number;
  captures: number;

  constructor(
    socket: Socket,
    name: string,
    x: number,
    y: number,
    z: number,
    direction: number,
    weaponCode: number = 1,
  ) {
    this.id = socket.id ?? '';
    this.name = name;
    this.position = { x, y, z };
    this.direction = direction;
    this.socket = socket;
    this.left = false;
    this.right = false;
    this.weaponCode = weaponCode;
    this.lastPing = Date.now();
    this.score = 0;
    this.hp = MAX_HP;
    this.ready = false;
    this.wantsRematch = false;
    this.shield = { active: false, cooldownUntil: 0, expiresAt: 0 };
    this.lastScoreTime = 0;
    this.comboCount = 0;
    this.upgradeLevel = 0;
    this.activePowerUps = [];
    this.recentFires = [];
    this.lastFireTime = 0;
    this.seat = -1;
    this.color = '';
    this.edge = null;
    this.isBot = false;
    this.token = '';
    this.connected = true;
    this.disconnectTimer = null;
    this.homeX = x;
    this.targetId = null;
    this.alive = true;
    this.respawnAt = 0;
    this.kos = 0;
    this.captures = 0;
  }

  clearDisconnectTimer() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  /** Puts the player on a seat: direction, starting position, colour and edge come from the seat table. */
  applySeat(seat: number) {
    const def = SEATS[seat];
    this.seat = seat;
    this.color = def.color;
    this.edge = def.edge;
    this.direction = def.direction;
    this.position = { x: def.x, y: 0, z: def.z };
    this.homeX = def.x;
  }

  hasPowerUp(type: PowerUpType): boolean {
    const now = Date.now();
    return this.activePowerUps.some(p => p.type === type && p.expiresAt > now);
  }

  expirePowerUps(now: number) {
    this.activePowerUps = this.activePowerUps.filter(p => p.expiresAt > now);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      position: this.position,
      direction: this.direction,
      weaponCode: this.weaponCode,
      score: this.score,
      hp: this.hp,
      shield: this.shield.active,
      upgradeLevel: this.upgradeLevel,
      activePowerUps: this.activePowerUps.map(p => p.type),
      seat: this.seat,
      color: this.color,
      edge: this.edge,
      isBot: this.isBot,
      connected: this.connected,
      targetId: this.targetId,
      alive: this.alive,
    };
  }

  /** The player's own payload: public info plus the private reconnect token. */
  sendPlayerInfo() {
    this.socket.emit('player', { ...this.toJSON(), token: this.token });
  }

  sendOpponentInfo(opponent: Player) {
    this.socket.emit('opponent', opponent.toJSON());
  }

  setWeaponCode(code: number) {
    this.weaponCode = code;
  }

  resetForRound() {
    this.score = 0;
    this.hp = MAX_HP;
    this.alive = true;
    this.respawnAt = 0;
    this.kos = 0;
    this.captures = 0;
    this.ready = false;
    this.shield = { active: false, cooldownUntil: 0, expiresAt: 0 };
    this.lastScoreTime = 0;
    this.comboCount = 0;
    this.upgradeLevel = 0;
    this.activePowerUps = [];
    this.recentFires = [];
    this.lastFireTime = 0;
    this.position.x = this.homeX;
    if (this.edge && EDGES[this.edge].axis === 'z') this.position.z = 0;
  }

  update(elapsed: number, brawl = false) {
    if (brawl && this.edge) {
      const axis = EDGES[this.edge].axis;
      let lat = this.position[axis];
      // `direction` is the sign of "right" on screen for this edge.
      if (this.left) lat -= 100 * elapsed * this.direction;
      else if (this.right) lat += 100 * elapsed * this.direction;
      this.position[axis] = clampEdgeTravel(lat);
      return;
    }
    let curPosX = this.position.x;
    const tr = 100.0;

    if (this.left) {
      curPosX -= tr * elapsed * this.direction;
    } else if (this.right) {
      curPosX += tr * elapsed * this.direction;
    }

    this.position.x = clampArenaX(curPosX);
  }

  toggleMovement(keyCode: number, directionBool: boolean) {
    switch (keyCode) {
      case -1:
      case 37:
      case 65:
        this.left = directionBool;
        break;
      case 1:
      case 39:
      case 68:
        this.right = directionBool;
        break;
    }
  }
}

class Zombie {
  id: string;
  name: string;
  position: Position;
  direction: number;
  speed: number;
  firedByPlayer: string;
  health: number;
  weaponCode: number;
  spawnTime: number;
  baseX: number;
  hazardsHit: Set<string>;
  chargeRatio: number;
  /** Unit heading. Lane modes: (0, direction). Brawl: toward the firer's target at fire time. */
  vx: number;
  vz: number;
  baseZ: number;
  brawl: boolean;
  targetId: string | null;

  constructor(
    name: string,
    position: Position,
    direction: number,
    firedByPlayer: string,
    health: number = 1,
    weaponCode: number = 1,
    speed: number = 300,
    chargeRatio: number = 0,
  ) {
    this.id = crypto.randomBytes(4).toString('hex');
    this.name = name;
    this.position = { ...position };
    this.direction = direction;
    this.speed = speed;
    this.firedByPlayer = firedByPlayer;
    this.health = health;
    this.weaponCode = weaponCode;
    this.spawnTime = Date.now();
    this.baseX = position.x;
    this.hazardsHit = new Set();
    this.chargeRatio = chargeRatio;
    this.vx = 0;
    this.vz = direction;
    this.baseZ = position.z;
    this.brawl = false;
    this.targetId = null;
  }

  /** Brawl: switches the creature to free (heading based) movement. */
  setHeading(vx: number, vz: number, targetId: string | null) {
    this.brawl = true;
    this.vx = vx;
    this.vz = vz;
    this.targetId = targetId;
    this.baseX = this.position.x;
    this.baseZ = this.position.z;
  }

  /** Brawl: shifts the creature (and the fox zig-zag's centre line) by a world offset. */
  nudge(dx: number, dz: number) {
    this.position.x += dx;
    this.position.z += dz;
    this.baseX += dx;
    this.baseZ += dz;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      ownerId: this.firedByPlayer,
      targetId: this.targetId,
      vx: this.vx,
      vz: this.vz,
      position: this.position,
      direction: this.direction,
      health: this.health,
      weaponCode: this.weaponCode,
      speed: this.speed,
      chargeRatio: this.chargeRatio,
    };
  }

  isCollision(zombie: Zombie): boolean {
    // Brawl: creatures of different owners collide; lane modes: opposite directions.
    if (this.brawl || zombie.brawl) {
      if (this.firedByPlayer === zombie.firedByPlayer) return false;
    } else if (this.direction === zombie.direction) return false;

    if (this.weaponCode === 3 && zombie.weaponCode !== 3) return false;
    if (this.weaponCode !== 3 && zombie.weaponCode === 3) return false;

    const xDiff = Math.abs(this.position.x - zombie.position.x);
    const zDiff = Math.abs(this.position.z - zombie.position.z);
    if (xDiff < 100 && zDiff < 100) return true;
    return false;
  }

  update(elapsed: number) {
    if (this.brawl) {
      const step = elapsed * this.speed;
      if (this.weaponCode === 1) {
        // Fox: zig-zag perpendicular to the heading around a straight centre line.
        this.baseX += this.vx * step;
        this.baseZ += this.vz * step;
        const offset = Math.sin(((Date.now() - this.spawnTime) / 1000) * 4) * 50;
        this.position.x = this.baseX - this.vz * offset;
        this.position.z = this.baseZ + this.vx * offset;
      } else {
        this.position.x += this.vx * step;
        this.position.z += this.vz * step;
      }
      return;
    }
    this.position.z += elapsed * this.speed * this.direction;

    if (this.weaponCode === 1) {
      const timeSinceSpawn = (Date.now() - this.spawnTime) / 1000;
      this.position.x = this.baseX + Math.sin(timeSinceSpawn * 4) * 50;
    }
  }
}

/** Returns the new game's id, or null when MAX_GAMES live games already exist. */
function createGame(gameName?: string): number | null {
  if (Object.keys(games).length >= MAX_GAMES) return null;
  const name = typeof gameName === 'string' ? gameName.trim().slice(0, MAX_GAME_NAME_LENGTH).trim() : '';
  const gameId = gameCounter++;
  games[gameId] = new Game(gameId, name || undefined);
  games[gameId].start();
  return gameId;
}

/**
 * Picks the side (-1 or 1) for a joining player: the direction of the seat they would get.
 * An empty game gives -1 (seat 0), which is the first side a fresh game has always used.
 */
function assignSide(game: Game): number {
  const seat = game.freeSeat();
  return SEATS[seat < 0 ? 0 : seat].direction;
}

/** A server-side bot Player for solo practice: seat 1, backed by a socket that swallows everything. */
function createBot(game: Game): Player {
  // BotBrain swaps in its own socket; the Player only needs an id here.
  const bot = new Player({ id: `bot-${game.id}` } as unknown as Socket, 'Bot ' + uniqueNamesGenerator(zombieNameConfig), 0, 0, 0, 1, 1);
  bot.isBot = true;
  bot.applySeat(1);
  bot.ready = true;
  return bot;
}

function findGame(data: unknown): Game | undefined {
  const gameId = (data as { gameId?: unknown } | null | undefined)?.gameId;
  if (typeof gameId !== 'number' || !Number.isInteger(gameId)) return undefined;
  return Object.prototype.hasOwnProperty.call(games, gameId) ? games[gameId] : undefined;
}

function listenForJoin(socket: Socket) {
  let joined = false;

  socket.on('join.player', (data: unknown) => {
    if (joined) {
      logger.info('Socket %s already joined a game, ignoring join.player', socket.id);
      return;
    }
    const game = findGame(data);
    if (!game) {
      logger.warn('Socket %s tried to join unknown game', socket.id);
      socket.emit('join.error.notfound');
      return;
    }

    // A client holding the seat's token takes the seat back on this new socket.
    const token = validToken((data as { token?: unknown } | null | undefined)?.token);
    const seated = token ? game.findByToken(token) : undefined;
    if (seated) {
      joined = true;
      game.reconnectPlayer(seated, socket);
      return;
    }

    joined = true;
    const playerName = uniqueNamesGenerator(playerNameConfig);
    const player = new Player(socket, playerName, 0, 0, 0, 0, 1);
    // Seated when the lobby has a free seat, otherwise queued as a spectator.
    game.joinPlayer(player);
  });

  socket.on('join.spectator', (data: { gameId: number }) => {
    if (joined) {
      logger.info('Socket %s already joined a game, ignoring join.spectator', socket.id);
      return;
    }
    const game = findGame(data);
    if (!game) {
      logger.warn('Socket %s tried to spectate unknown game', socket.id);
      socket.emit('join.error.notfound');
      return;
    }

    joined = true;
    const spectatorName = uniqueNamesGenerator(playerNameConfig);
    const player = new Player(socket, spectatorName, 0, 0, 0, 0);
    game.joinSpectator(player);
  });
}

function setupSocket(socket: Socket) {
  logger.info('A client connected.');
  listenForJoin(socket);

  socket.on('error', (err: Error) => {
    logger.error(err);
  });
}

export { knobs, resetKnobs, MAX_GAMES, MAX_GAME_NAME_LENGTH, EMPTY_GAME_TTL_MS, MAX_SEATS, RECONNECT_WINDOW_MS, SEATS, assignSide, createBot, Game, Player, Zombie, PlayerStats, healthFromCode, speedFromCode, fireDelayFromCode, getElo, updateElo, getLeaderboard };

export default {
  setupSocket,
  games,
  newGame: createGame,
  getLeaderboard,
};
