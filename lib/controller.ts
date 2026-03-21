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

interface Position {
  x: number;
  y: number;
  z: number;
}

type GamePhase = 'lobby' | 'countdown' | 'playing' | 'round_over' | 'match_over' | 'sudden_death';

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

// Sudden death constants
const SUDDEN_DEATH_TIME_MS = 90000;

// Wall constants
const WALL_COST = 3;
const WALL_DURATION_MS = 5000;
const WALL_WIDTH = 300;

// Spectator vote constants
const SPECTATOR_VOTE_COOLDOWN_MS = 15000;

// Synergy constants
const SYNERGY_WINDOW_MS = 2000;

// Charged shot constants
const MAX_CHARGE_MS = 3000;

// ELO constants
const ELO_K = 32;
const ELO_DEFAULT = 1000;

interface PowerUp {
  id: string;
  type: PowerUpType;
  position: Position;
  expiresAt: number;
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
}

interface ReplayEvent {
  time: number;
  type: string;
  data: any;
}

interface ActivePowerUp {
  type: PowerUpType;
  expiresAt: number;
}

interface FiredCreatureRecord {
  weaponCode: number;
  time: number;
}

function healthFromCode(code: number): number {
  switch (code) {
    case 1: return 1;
    case 2: return 2;
    case 3: return 1;
    case 4: return 3;
    case 5: return 1;
    default: return 1;
  }
}

function speedFromCode(code: number): number {
  switch (code) {
    case 5: return 200;
    default: return 300;
  }
}

function fireDelayFromCode(code: number): number {
  switch (code) {
    case 1: return 1000;
    case 2: return 1500;
    case 3: return 500;
    case 4: return 2000;
    case 5: return 3000;
    default: return 1000;
  }
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
const games: Record<number, Game> = {};

class Game {
  id: number;
  gameName: string;
  startTime: Date;
  players: Record<string, Player>;
  spectators: Record<string, Player>;
  zombies: Record<string, Zombie>;
  locationModifier: number;
  timestamp: number;
  updating: boolean;
  phase: GamePhase;
  round: number;
  roundWins: Record<string, number>;
  stats: Record<string, PlayerStats>;

  // New feature state
  powerUps: Record<string, PowerUp>;
  hazards: Hazard[];
  walls: Record<string, Wall>;
  replay: ReplayEvent[];
  roundStartTime: number;
  suddenDeath: boolean;
  lastPowerUpSpawn: number;
  lastSpectatorVote: number;

  constructor(id: number, gameName?: string) {
    this.id = id;
    this.gameName = gameName ? gameName : 'That DAMN game';
    this.startTime = new Date();
    this.players = {};
    this.spectators = {};
    this.zombies = {};
    this.locationModifier = -1;
    this.timestamp = Date.now();
    this.updating = false;
    this.phase = 'lobby';
    this.round = 1;
    this.roundWins = {};
    this.stats = {};

    this.powerUps = {};
    this.hazards = [];
    this.walls = {};
    this.replay = [];
    this.roundStartTime = 0;
    this.suddenDeath = false;
    this.lastPowerUpSpawn = 0;
    this.lastSpectatorVote = 0;
  }

  recordReplay(type: string, data: any) {
    this.replay.push({ time: Date.now() - this.roundStartTime, type, data });
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
    const hazardTypes: Array<'damage' | 'slow' | 'wind'> = ['damage', 'slow', 'wind'];
    for (let i = 0; i < HAZARD_COUNT; i++) {
      const type = hazardTypes[i % hazardTypes.length];
      const hazard: Hazard = {
        id: crypto.randomBytes(4).toString('hex'),
        position: {
          x: (Math.random() - 0.5) * 600,
          y: 0,
          z: (Math.random() - 0.5) * 1200,
        },
        width: 150 + Math.random() * 150,
        depth: 200 + Math.random() * 200,
        type,
        windDirection: type === 'wind' ? (Math.random() > 0.5 ? 1 : -1) : undefined,
      };
      this.hazards.push(hazard);
    }
    this.emitAll('hazards', this.hazards);
  }

  spawnPowerUp() {
    const now = Date.now();
    if (now - this.lastPowerUpSpawn < POWERUP_SPAWN_INTERVAL_MS) return;
    // Max 3 power-ups on field at once
    if (Object.keys(this.powerUps).length >= 3) return;

    this.lastPowerUpSpawn = now;
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const powerUp: PowerUp = {
      id: crypto.randomBytes(4).toString('hex'),
      type,
      position: {
        x: (Math.random() - 0.5) * 600,
        y: 0,
        z: (Math.random() - 0.5) * 1400,
      },
      expiresAt: now + POWERUP_DURATION_MS,
    };
    this.powerUps[powerUp.id] = powerUp;
    this.emitAll('powerup.spawn', powerUp);
    this.recordReplay('powerup.spawn', powerUp);
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
      // Check player collection
      for (const pid in this.players) {
        const player = this.players[pid];
        const dx = Math.abs(player.position.x - pu.position.x);
        const dz = Math.abs(player.position.z - pu.position.z);
        if (dx < POWERUP_COLLECT_RADIUS && dz < POWERUP_COLLECT_RADIUS) {
          this.applyPowerUp(player, pu);
          this.emitAll('powerup.collect', puId, pid, pu.type);
          this.recordReplay('powerup.collect', { id: puId, player: pid, type: pu.type });
          delete this.powerUps[puId];
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
    if (this.suddenDeath) return;
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
      this.recordReplay('sudden.death', {});
    }
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
      this.recordReplay('synergy', { player: player.id, type: 'air_strike' });
    }
    // Horse + Horde = "Stampede" — extra horde creatures
    if (weaponCode === 5 && recentCodes.includes(2)) {
      extraCreatures = 3;
      this.emitAll('synergy', player.id, 'stampede');
      this.recordReplay('synergy', { player: player.id, type: 'stampede' });
    }
    // Zombie + Horse = "Juggernaut" — extra HP
    if (weaponCode === 2 && recentCodes.includes(4)) {
      healthBonus = 2;
      this.emitAll('synergy', player.id, 'juggernaut');
      this.recordReplay('synergy', { player: player.id, type: 'juggernaut' });
    }
    // Fox + Fox = "Twin Strike" — fires 2 foxes
    if (weaponCode === 1 && recentCodes.filter(c => c === 1).length >= 2) {
      extraCreatures = 1;
      this.emitAll('synergy', player.id, 'twin_strike');
      this.recordReplay('synergy', { player: player.id, type: 'twin_strike' });
    }

    return { speedMult, healthBonus, extraCreatures };
  }

  joinPlayer(player: Player) {
    if (Object.keys(this.players).length >= 2) {
      logger.info('%s cannot join game %s as player. Game is full', player.name, this.id);
      return player.socket.emit('join.error.full');
    }

    logger.info('%s joined game %s as player', player.name, this.id);

    this.players[player.id] = player;
    this.roundWins[player.id] = 0;
    this.stats[player.id] = new PlayerStats();

    for (const key in this.players) {
      if (this.players[key] !== player) {
        this.players[key].sendOpponentInfo(player);
        player.sendOpponentInfo(this.players[key]);
      }
    }

    player.socket.on('fire', (position: Position, weaponCode: number, chargeTime?: number) => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;

      // Fire rate check (server-authoritative)
      const now = Date.now();
      let delay = fireDelayFromCode(weaponCode);
      if (player.hasPowerUp('rapid_fire')) delay *= 0.5;
      if (now - player.lastFireTime < delay) return;
      player.lastFireTime = now;

      logger.verbose('A zombie was added in game %s', this.id, position);

      const upgradeLevel = player.upgradeLevel;
      const baseHealth = healthFromCode(weaponCode);
      let health = upgradeLevel >= 2 ? baseHealth + 1 : baseHealth;
      const baseSpeed = speedFromCode(weaponCode);
      let speed = upgradeLevel >= 1 ? baseSpeed + 50 : baseSpeed;

      // Charged shot bonus
      const charge = Math.min(chargeTime || 0, MAX_CHARGE_MS);
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
        this.zombies[zombie.id] = zombie;
        this.emitAll('zombie', zombie.toJSON(), player.id);
        this.recordReplay('zombie', { zombie: zombie.toJSON(), player: player.id });
      };

      if (weaponCode === 5) {
        const count = 5 + synergy.extraCreatures;
        for (let i = 0; i < count; i++) {
          const spreadX = (i - Math.floor(count / 2)) * 60;
          const hordePos = { x: position.x + spreadX, y: position.y, z: position.z };
          createZombie(hordePos, health, speed);
        }
        this.stats[player.id].zombiesFired += count;
      } else {
        createZombie(position, health, speed);
        // Extra creatures from synergy
        for (let i = 0; i < synergy.extraCreatures; i++) {
          const offset = (i + 1) * 80;
          createZombie({ x: position.x + offset, y: position.y, z: position.z }, health, speed);
        }
        this.stats[player.id].zombiesFired += 1 + synergy.extraCreatures;
      }
    });

    player.socket.on('move.start', (keyCode: number) => {
      player.toggleMovement(keyCode, true);
      this.emitAll('move.start', keyCode, player.id);
    });

    player.socket.on('move.end', (keyCode: number) => {
      player.toggleMovement(keyCode, false);
      this.emitAll('move.end', keyCode, player.id);
    });

    player.socket.on('weapon.set', (code: number) => {
      logger.debug('Player ' + player.id + ' switch to ' + code);
      player.setWeaponCode(code);
      this.emitAll('weapon.set', code, player.id);
    });

    player.socket.on('shield', () => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;
      const now = Date.now();
      if (player.shield.active) return;
      if (now < player.shield.cooldownUntil) return;

      player.shield.active = true;
      player.shield.expiresAt = now + SHIELD_DURATION_MS;
      player.shield.cooldownUntil = now + SHIELD_COOLDOWN_MS;
      this.emitAll('shield.activate', player.id);
      this.recordReplay('shield.activate', { player: player.id });
    });

    // Wall placement
    player.socket.on('place.wall', (x: number) => {
      if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;
      if (player.score < WALL_COST) return;

      player.score -= WALL_COST;
      const now = Date.now();
      const wall: Wall = {
        id: crypto.randomBytes(4).toString('hex'),
        position: { x, y: 0, z: player.position.z + player.direction * -200 },
        width: WALL_WIDTH,
        ownerId: player.id,
        expiresAt: now + WALL_DURATION_MS,
      };
      this.walls[wall.id] = wall;
      this.emitAll('wall.place', wall);
      this.recordReplay('wall.place', wall);
    });

    player.socket.on('ready', () => {
      player.ready = true;
      this.checkReady();
    });

    player.socket.on('rematch', () => {
      player.wantsRematch = true;
      this.checkRematch();
    });

    player.socket.on('exit', () => {
      this.exitPlayer(player);
    });

    player.socket.on('pingpong', () => {
      logger.debug(`Ping from ${player.name} (${player.id})`);
      player.lastPing = Date.now();
      player.socket.emit('pong');
    });

    // Send ELO info
    player.socket.emit('elo', getElo(player.name));
  }

  checkReady() {
    const playerIds = Object.keys(this.players);
    if (playerIds.length < 1) return;
    if (this.phase !== 'lobby' && this.phase !== 'round_over') return;

    const allReady = playerIds.every(id => this.players[id].ready);
    if (!allReady) return;

    this.startCountdown();
  }

  startCountdown() {
    this.phase = 'countdown';
    let remaining = COUNTDOWN_SECONDS;

    this.emitAll('game.countdown', remaining);

    const countdownInterval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        this.emitAll('game.countdown', remaining);
      } else {
        clearInterval(countdownInterval);
        this.phase = 'playing';
        this.roundStartTime = Date.now();
        this.suddenDeath = false;
        this.lastPowerUpSpawn = 0;
        this.replay = [];
        this.generateHazards();
        this.emitAll('game.start');
        this.recordReplay('game.start', {});
      }
    }, 1000);
  }

  checkRematch() {
    const playerIds = Object.keys(this.players);
    if (playerIds.length < 2) return;

    const allWant = playerIds.every(id => this.players[id].wantsRematch);
    if (!allWant) return;

    this.round = 1;
    this.roundWins = {};
    this.stats = {};
    for (const id of playerIds) {
      this.roundWins[id] = 0;
      this.stats[id] = new PlayerStats();
      this.players[id].resetForRound();
      this.players[id].wantsRematch = false;
    }
    this.zombies = {};
    this.powerUps = {};
    this.walls = {};
    this.phase = 'lobby';
    this.emitAll('game.rematch');

    for (const id of playerIds) {
      this.players[id].ready = true;
    }
    this.checkReady();
  }

  resetForNextRound() {
    for (const key in this.players) {
      this.players[key].resetForRound();
    }
    this.zombies = {};
    this.powerUps = {};
    this.walls = {};
    this.suddenDeath = false;

    for (const key in this.players) {
      this.players[key].ready = true;
    }
    this.checkReady();
  }

  exitPlayer(player: Player) {
    logger.info(`Player ${player.name} (${player.id}) exited`);
    this.emitAll('player.exit', player.id);
    delete this.players[player.id];
    this.locationModifier *= -1;
    if (Object.keys(this.players).length === 0) {
      logger.info(`No more players in ${this.id}!`);
    }
  }

  joinSpectator(spectator: Player) {
    logger.info('%s joined game %s as spectator', spectator.id, this.id);

    for (const key in this.players) {
      spectator.sendOpponentInfo(this.players[key]);
    }

    this.spectators[spectator.id] = spectator;
    this.emitAll('spectator', spectator.toJSON());

    spectator.socket.on('pingpong', () => {
      spectator.lastPing = Date.now();
      spectator.socket.emit('pong');
    });

    // Spectator interference voting
    spectator.socket.on('spectator.vote', (eventType: string) => {
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
          this.recordReplay('spectator.event', { type: 'speed_burst' });
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
          };
          this.walls[wall.id] = wall;
          this.emitAll('wall.place', wall);
          this.emitAll('spectator.event', 'spawn_obstacle', spectator.name);
          this.recordReplay('spectator.event', { type: 'spawn_obstacle' });
          break;
        }
        case 'heal_all': {
          for (const pid in this.players) {
            this.players[pid].hp = Math.min(MAX_HP, this.players[pid].hp + 2);
            this.emitAll('player.heal', pid, this.players[pid].hp);
          }
          this.emitAll('spectator.event', 'heal_all', spectator.name);
          this.recordReplay('spectator.event', { type: 'heal_all' });
          break;
        }
      }
    });

    // Send current hazards and power-ups
    spectator.socket.emit('hazards', this.hazards);
    for (const puId in this.powerUps) {
      spectator.socket.emit('powerup.spawn', this.powerUps[puId]);
    }
  }

  update(elapsed: number) {
    if (this.updating) return;
    if (this.phase !== 'playing' && this.phase !== 'sudden_death') return;

    this.updating = true;
    const now = Date.now();

    // Spawn power-ups
    this.spawnPowerUp();

    // Check power-up collection
    this.checkPowerUpCollisions();

    // Check wall expiry
    this.checkWalls();

    // Check sudden death
    this.checkSuddenDeath();

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
      player.update(elapsed);
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
              // Tick damage — reduce health slowly
              if (!zombie.lastHazardDamage || now - zombie.lastHazardDamage > 500) {
                zombie.health -= 1;
                zombie.lastHazardDamage = now;
                if (zombie.health <= 0) {
                  this.emitAll('zombie.hazard', zombie.id, hazard.id);
                  delete this.zombies[key];
                }
              }
              break;
            case 'slow':
              zombie.position.z -= elapsed * zombie.speed * zombie.direction * 0.5; // counteract half movement
              break;
            case 'wind':
              zombie.position.x += elapsed * 150 * (hazard.windDirection || 1);
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
        if (wz < 50 && wx < wall.width / 2) {
          this.emitAll('zombie.walled', zombie.id, wId);
          this.recordReplay('zombie.walled', { zombie: zombie.id, wall: wId });
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
        if (zDist < 150 && xDist < 300) {
          this.emitAll('zombie.shielded', zombie.id, pid);
          this.recordReplay('zombie.shielded', { zombie: zombie.id, player: pid });
          delete this.zombies[key];
          shieldDestroyed = true;
          break;
        }
      }
      if (shieldDestroyed) continue;

      if (this.isOutOfBounds(zombie)) {
        const firingPlayer = this.players[zombie.firedByPlayer];

        let opponentId: string | null = null;
        for (const pid in this.players) {
          if (pid !== zombie.firedByPlayer) {
            opponentId = pid;
            break;
          }
        }

        if (firingPlayer) {
          const timeSinceLast = now - firingPlayer.lastScoreTime;
          let points = 1;

          // Double points power-up
          if (firingPlayer.hasPowerUp('double_points')) points *= 2;

          if (timeSinceLast < COMBO_WINDOW_MS && firingPlayer.lastScoreTime > 0) {
            firingPlayer.comboCount++;
            const comboBonus = Math.floor(firingPlayer.comboCount * 0.5);
            firingPlayer.score += points + comboBonus;
            this.emitAll('combo', firingPlayer.id, firingPlayer.comboCount);
          } else {
            firingPlayer.comboCount = 0;
            firingPlayer.score += points;
          }
          firingPlayer.lastScoreTime = now;

          const oldLevel = firingPlayer.upgradeLevel;
          firingPlayer.upgradeLevel = UPGRADE_THRESHOLDS.filter(t => firingPlayer.score >= t).length;
          if (firingPlayer.upgradeLevel > oldLevel) {
            this.emitAll('player.upgrade', firingPlayer.id, firingPlayer.upgradeLevel);
          }

          this.stats[zombie.firedByPlayer].zombiesScored++;
        }

        if (opponentId && this.players[opponentId]) {
          this.players[opponentId].hp -= 1;
          this.emitAll('player.damage', opponentId, this.players[opponentId].hp);
        }

        this.emitAll('zombie.out-of-bounds', zombie.id, zombie.firedByPlayer);
        this.recordReplay('zombie.out-of-bounds', { zombie: zombie.id, player: zombie.firedByPlayer });
        delete this.zombies[key];

        if (this.checkRoundEnd()) break;
        continue;
      }

      for (const otherKey in this.zombies) {
        if (key === otherKey) continue;

        const otherZombie = this.zombies[otherKey];
        if (!otherZombie) continue;

        if (zombie.isCollision(otherZombie)) {
          this.emitAll('zombie.collision', zombie.id, otherZombie.id);
          this.recordReplay('zombie.collision', { a: zombie.id, b: otherZombie.id });

          if (this.stats[zombie.firedByPlayer]) this.stats[zombie.firedByPlayer].zombiesDestroyed++;
          if (this.stats[otherZombie.firedByPlayer]) this.stats[otherZombie.firedByPlayer].zombiesDestroyed++;

          this.zombies[key].health -= 1;
          this.zombies[otherKey].health -= 1;

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

    this.updating = false;
  }

  checkRoundEnd(): boolean {
    if (this.phase !== 'playing' && this.phase !== 'sudden_death') return false;
    const playerIds = Object.keys(this.players);
    if (playerIds.length < 2) return false;

    let roundWinner: string | null = null;

    for (const id of playerIds) {
      if (this.players[id].hp <= 0) {
        roundWinner = playerIds.find(pid => pid !== id) || null;
        break;
      }
    }

    if (!roundWinner) {
      for (const id of playerIds) {
        if (this.players[id].score >= POINTS_TO_WIN) {
          roundWinner = id;
          break;
        }
      }
    }

    if (!roundWinner) return false;

    this.roundWins[roundWinner] = (this.roundWins[roundWinner] || 0) + 1;

    const roundLoser = playerIds.find(pid => pid !== roundWinner) || '';

    this.emitAll('round.end', {
      winner: roundWinner,
      loser: roundLoser,
      round: this.round,
      roundWins: this.roundWins,
      scores: {
        [roundWinner]: this.players[roundWinner]?.score || 0,
        [roundLoser]: this.players[roundLoser]?.score || 0,
      },
    });

    if (this.roundWins[roundWinner] >= ROUNDS_TO_WIN) {
      this.phase = 'match_over';

      // Update ELO
      const winnerName = this.players[roundWinner]?.name || '';
      const loserName = this.players[roundLoser]?.name || '';
      if (winnerName && loserName) {
        updateElo(winnerName, loserName);
      }

      this.emitAll('match.over', {
        winner: roundWinner,
        loser: roundLoser,
        roundWins: this.roundWins,
        stats: this.stats,
        replay: this.replay,
        elo: {
          [roundWinner]: getElo(winnerName),
          [roundLoser]: getElo(loserName),
        },
        leaderboard: getLeaderboard(),
      });
    } else {
      this.phase = 'round_over';
      this.round++;

      setTimeout(() => {
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
    };

    for (const key in this.players) {
      state.players[key] = this.players[key].toJSON();
    }

    for (const key in this.zombies) {
      state.zombies[key] = this.zombies[key].toJSON();
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
    setInterval(() => {
      this.emitAll('state', this.toJSON());
    }, 200);

    setInterval(() => {
      this.update(this.elapsed());
    }, 100);

    setInterval(() => {
      this.checkPing();
    }, 5000);
  }

  checkPing() {
    Object.keys(this.players).forEach((key) => {
      const player = this.players[key];
      if (Date.now() - player.lastPing >= 5000) {
        logger.warn(`Player ${player.id} did not ping for a long time!`);
        this.exitPlayer(player);
      }
    });
  }

  isOutOfBounds(zombie: Zombie): boolean {
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
    };
  }

  sendPlayerInfo() {
    this.socket.emit('player', this.toJSON());
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
    this.ready = false;
    this.shield = { active: false, cooldownUntil: 0, expiresAt: 0 };
    this.lastScoreTime = 0;
    this.comboCount = 0;
    this.upgradeLevel = 0;
    this.activePowerUps = [];
    this.recentFires = [];
    this.lastFireTime = 0;
    this.position.x = 0;
  }

  update(elapsed: number) {
    let curPosX = this.position.x;
    const tr = 100.0;

    if (this.left) {
      curPosX -= tr * elapsed * this.direction;
    } else if (this.right) {
      curPosX += tr * elapsed * this.direction;
    }

    this.position.x = curPosX;
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
  lastHazardDamage: number;
  chargeRatio: number;

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
    this.lastHazardDamage = 0;
    this.chargeRatio = chargeRatio;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      position: this.position,
      direction: this.direction,
      health: this.health,
      weaponCode: this.weaponCode,
      speed: this.speed,
      chargeRatio: this.chargeRatio,
    };
  }

  isCollision(zombie: Zombie): boolean {
    if (this.direction === zombie.direction) return false;

    if (this.weaponCode === 3 && zombie.weaponCode !== 3) return false;
    if (this.weaponCode !== 3 && zombie.weaponCode === 3) return false;

    const xDiff = Math.abs(this.position.x - zombie.position.x);
    const zDiff = Math.abs(this.position.z - zombie.position.z);
    if (xDiff < 100 && zDiff < 100) return true;
    return false;
  }

  update(elapsed: number) {
    this.position.z += elapsed * this.speed * this.direction;

    if (this.weaponCode === 1) {
      const timeSinceSpawn = (Date.now() - this.spawnTime) / 1000;
      this.position.x = this.baseX + Math.sin(timeSinceSpawn * 4) * 50;
    }
  }
}

function createGame(gameName?: string): number {
  const gameId = gameCounter++;
  games[gameId] = new Game(gameId, gameName);
  games[gameId].start();
  return gameId;
}

function listenForJoin(socket: Socket) {
  socket.on('join.player', (data: { gameId: number }) => {
    const game = games[data.gameId];
    const playerName = uniqueNamesGenerator(playerNameConfig);
    const player = new Player(
      socket,
      playerName,
      0,
      0,
      1000 * game.locationModifier,
      game.locationModifier,
      1,
    );

    game.locationModifier *= -1;

    player.sendPlayerInfo();
    game.joinPlayer(player);
  });

  socket.on('join.spectator', (data: { gameId: number }) => {
    const game = games[data.gameId];
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

export default {
  setupSocket,
  games,
  newGame: createGame,
  getLeaderboard,
};
