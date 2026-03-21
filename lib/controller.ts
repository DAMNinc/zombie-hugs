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

type GamePhase = 'lobby' | 'countdown' | 'playing' | 'round_over' | 'match_over';

const playerNameConfig = { dictionaries: [adjectives, names], length: 2 };
const zombieNameConfig = { dictionaries: [colors, animals], length: 2 };

const MAX_HP = 10;
const POINTS_TO_WIN = 10;
const MAX_ROUNDS = 3;
const ROUNDS_TO_WIN = 2;
const COUNTDOWN_SECONDS = 3;
const COMBO_WINDOW_MS = 2000;
const SHIELD_DURATION_MS = 3000;
const SHIELD_COOLDOWN_MS = 15000;
const UPGRADE_THRESHOLDS = [5, 8];

function healthFromCode(code: number): number {
  switch (code) {
    case 1: // Fox
      return 1;
    case 2: // Horse
      return 2;
    case 3: // Flamingo
      return 1;
    case 4: // Horde
      return 1;
    default:
      return 1;
  }
}

function speedFromCode(code: number): number {
  switch (code) {
    case 4: // Horde - slower
      return 200;
    default:
      return 300;
  }
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

    player.socket.on('fire', (position: Position, weaponCode: number) => {
      if (this.phase !== 'playing') return;

      logger.verbose('A zombie was added in game %s', this.id, position);

      const upgradeLevel = player.upgradeLevel;
      const baseHealth = healthFromCode(weaponCode);
      const health = upgradeLevel >= 2 ? baseHealth + 1 : baseHealth;
      const baseSpeed = speedFromCode(weaponCode);
      const speed = upgradeLevel >= 1 ? baseSpeed + 50 : baseSpeed;

      if (weaponCode === 4) {
        // Horde: fire 5 small zombies in a spread
        for (let i = 0; i < 5; i++) {
          const spreadX = (i - 2) * 60;
          const hordePos = { x: position.x + spreadX, y: position.y, z: position.z };
          const zombieName = uniqueNamesGenerator(zombieNameConfig);
          const zombie = new Zombie(zombieName, hordePos, player.direction * -1, player.id, health, weaponCode, speed);
          this.zombies[zombie.id] = zombie;
          this.emitAll('zombie', zombie.toJSON(), player.id);
        }
      } else {
        const zombieName = uniqueNamesGenerator(zombieNameConfig);
        const zombie = new Zombie(zombieName, position, player.direction * -1, player.id, health, weaponCode, speed);
        this.zombies[zombie.id] = zombie;
        this.emitAll('zombie', zombie.toJSON(), player.id);
      }

      this.stats[player.id].zombiesFired += (weaponCode === 4 ? 5 : 1);
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
      if (this.phase !== 'playing') return;
      const now = Date.now();
      if (player.shield.active) return;
      if (now < player.shield.cooldownUntil) return;

      player.shield.active = true;
      player.shield.expiresAt = now + SHIELD_DURATION_MS;
      player.shield.cooldownUntil = now + SHIELD_COOLDOWN_MS;
      this.emitAll('shield.activate', player.id);
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
        this.emitAll('game.start');
      }
    }, 1000);
  }

  checkRematch() {
    const playerIds = Object.keys(this.players);
    if (playerIds.length < 2) return;

    const allWant = playerIds.every(id => this.players[id].wantsRematch);
    if (!allWant) return;

    // Reset everything
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
    this.phase = 'lobby';
    this.emitAll('game.rematch');

    // Auto-ready after rematch
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

    // Auto-ready for next round
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
  }

  update(elapsed: number) {
    if (this.updating) return;
    if (this.phase !== 'playing') return;

    this.updating = true;
    const now = Date.now();

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

      // Check shield collision
      let shieldDestroyed = false;
      for (const pid in this.players) {
        const player = this.players[pid];
        if (!player.shield.active) continue;
        if (zombie.firedByPlayer === pid) continue; // own shield doesn't block own creatures

        const shieldZ = player.position.z;
        const zDist = Math.abs(zombie.position.z - shieldZ);
        const xDist = Math.abs(zombie.position.x - player.position.x);
        if (zDist < 150 && xDist < 300) {
          this.emitAll('zombie.shielded', zombie.id, pid);
          delete this.zombies[key];
          shieldDestroyed = true;
          break;
        }
      }
      if (shieldDestroyed) continue;

      if (this.isOutOfBounds(zombie)) {
        const firingPlayer = this.players[zombie.firedByPlayer];

        // Find the opponent (the player who got scored against)
        let opponentId: string | null = null;
        for (const pid in this.players) {
          if (pid !== zombie.firedByPlayer) {
            opponentId = pid;
            break;
          }
        }

        if (firingPlayer) {
          // Combo tracking
          const timeSinceLast = now - firingPlayer.lastScoreTime;
          if (timeSinceLast < COMBO_WINDOW_MS && firingPlayer.lastScoreTime > 0) {
            firingPlayer.comboCount++;
            const comboBonus = Math.floor(firingPlayer.comboCount * 0.5);
            firingPlayer.score += 1 + comboBonus;
            this.emitAll('combo', firingPlayer.id, firingPlayer.comboCount);
          } else {
            firingPlayer.comboCount = 0;
            firingPlayer.score += 1;
          }
          firingPlayer.lastScoreTime = now;

          // Check upgrade thresholds
          const oldLevel = firingPlayer.upgradeLevel;
          firingPlayer.upgradeLevel = UPGRADE_THRESHOLDS.filter(t => firingPlayer.score >= t).length;
          if (firingPlayer.upgradeLevel > oldLevel) {
            this.emitAll('player.upgrade', firingPlayer.id, firingPlayer.upgradeLevel);
          }

          this.stats[zombie.firedByPlayer].zombiesScored++;
        }

        // Deal damage to opponent
        if (opponentId && this.players[opponentId]) {
          this.players[opponentId].hp -= 1;
          this.emitAll('player.damage', opponentId, this.players[opponentId].hp);
        }

        this.emitAll('zombie.out-of-bounds', zombie.id, zombie.firedByPlayer);
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

          // Track stats
          if (this.stats[zombie.firedByPlayer]) this.stats[zombie.firedByPlayer].zombiesDestroyed++;
          if (this.stats[otherZombie.firedByPlayer]) this.stats[otherZombie.firedByPlayer].zombiesDestroyed++;

          // Horse push-through: if horse vs 1-HP creature, horse just takes 1 damage but continues
          this.zombies[key].health -= 1;
          if (this.zombies[key].health <= 0) {
            delete this.zombies[key];
          }

          this.zombies[otherKey].health -= 1;
          if (this.zombies[otherKey].health <= 0) {
            delete this.zombies[otherKey];
          }

          // Horse with remaining HP doesn't break — it continues checking collisions
          if (!this.zombies[key]) break;
          // If the zombie survived (e.g. horse), continue checking other collisions
        }
      }
    }

    this.updating = false;
  }

  checkRoundEnd(): boolean {
    if (this.phase !== 'playing') return false;
    const playerIds = Object.keys(this.players);
    if (playerIds.length < 2) return false;

    let roundWinner: string | null = null;

    // Check HP depletion
    for (const id of playerIds) {
      if (this.players[id].hp <= 0) {
        // The other player wins the round
        roundWinner = playerIds.find(pid => pid !== id) || null;
        break;
      }
    }

    // Check score target
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

    // Check match end
    if (this.roundWins[roundWinner] >= ROUNDS_TO_WIN) {
      this.phase = 'match_over';
      this.emitAll('match.over', {
        winner: roundWinner,
        loser: roundLoser,
        roundWins: this.roundWins,
        stats: this.stats,
      });
    } else {
      this.phase = 'round_over';
      this.round++;

      // Auto-reset for next round after a short delay
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
    }, 1000);

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
      case -1: // Custom keycode for touch
      case 37: // Leftarrow
      case 65: // a key
        this.left = directionBool;
        break;
      case 1: // Custom keycode for touch
      case 39: // Right arrow
      case 68: // d key
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

  constructor(
    name: string,
    position: Position,
    direction: number,
    firedByPlayer: string,
    health: number = 1,
    weaponCode: number = 1,
    speed: number = 300,
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
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      position: this.position,
      direction: this.direction,
      health: this.health,
      weaponCode: this.weaponCode,
    };
  }

  isCollision(zombie: Zombie): boolean {
    if (this.direction === zombie.direction) return false;

    // Flamingo (code 3) flies high — only collides with other flamingos
    if (this.weaponCode === 3 && zombie.weaponCode !== 3) return false;
    if (this.weaponCode !== 3 && zombie.weaponCode === 3) return false;

    const xDiff = Math.abs(this.position.x - zombie.position.x);
    const zDiff = Math.abs(this.position.z - zombie.position.z);
    if (xDiff < 100 && zDiff < 100) return true;
    return false;
  }

  update(elapsed: number) {
    this.position.z += elapsed * this.speed * this.direction;

    // Fox zigzag (weaponCode 1)
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
};
