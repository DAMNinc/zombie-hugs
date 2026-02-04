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

const playerNameConfig = { dictionaries: [adjectives, names], length: 2 };
const zombieNameConfig = { dictionaries: [colors, animals], length: 2 };

function healthFromCode(code: number): number {
  switch (code) {
    case 1: // Fox
      return 1;
    case 2: // Horse
      return 2;
    case 3: // Flamingo
      return 1;
    default:
      return 1;
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

    for (const key in this.players) {
      if (this.players[key] !== player) {
        this.players[key].sendOpponentInfo(player);
        player.sendOpponentInfo(this.players[key]);
      }
    }

    player.socket.on('fire', (position: Position, weaponCode: number) => {
      logger.verbose('A zombie was added in game %s', this.id, position);

      const health = healthFromCode(weaponCode);
      const zombieName = uniqueNamesGenerator(zombieNameConfig);
      const zombie = new Zombie(zombieName, position, player.direction * -1, player.id, health);
      this.zombies[zombie.id] = zombie;
      this.emitAll('zombie', zombie.toJSON(), player.id);
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

    player.socket.on('exit', () => {
      this.exitPlayer(player);
    });

    player.socket.on('pingpong', () => {
      logger.debug(`Ping from ${player.name} (${player.id})`);
      player.lastPing = Date.now();
    });
  }

  exitPlayer(player: Player) {
    logger.info(`Player ${player.name} (${player.id}) exited`);
    this.emitAll('player.exit', player.id);
    delete this.players[player.id];
    this.locationModifier *= -1; // TODO: This doesn't work properly:-)
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
  }

  update(elapsed: number) {
    if (this.updating) return;

    this.updating = true;

    for (const key in this.players) {
      const player = this.players[key];
      player.update(elapsed);
    }

    for (const key of Object.keys(this.zombies)) {
      if (!this.zombies[key]) continue;

      const zombie = this.zombies[key];
      zombie.update(elapsed);

      if (this.isOutOfBounds(zombie)) {
        this.emitAll('zombie.out-of-bounds', zombie.id, zombie.firedByPlayer);
        if (zombie.firedByPlayer in this.players) {
          this.players[zombie.firedByPlayer].score += 1;
        }
        delete this.zombies[key];
        continue;
      }

      for (const otherKey in this.zombies) {
        if (key === otherKey) continue;

        const otherZombie = this.zombies[otherKey];
        if (zombie.isCollision(otherZombie)) {
          this.emitAll('zombie.collision', zombie.id, otherZombie.id);

          this.zombies[key].health -= 1;
          if (this.zombies[key].health <= 0) {
            delete this.zombies[key];
          }

          this.zombies[otherKey].health -= 1;
          if (this.zombies[otherKey].health <= 0) {
            delete this.zombies[otherKey];
          }

          break;
        }
      }
    }

    this.updating = false;
  }

  toJSON() {
    const state: { players: Record<string, any>; zombies: Record<string, any> } = {
      players: {},
      zombies: {},
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
    // TODO: use real bounds instead of magic numbers.
    return zombie.position.z < -1500 || zombie.position.z > 1500;
  }
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

  constructor(
    socket: Socket,
    name: string,
    x: number,
    y: number,
    z: number,
    direction: number,
    weaponCode: number = 1,
  ) {
    this.id = socket.id;
    this.name = name;
    this.position = { x, y, z };
    this.direction = direction;
    this.socket = socket;
    this.left = false;
    this.right = false;
    this.weaponCode = weaponCode;
    this.lastPing = Date.now();
    this.score = 0;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      position: this.position,
      direction: this.direction,
      weaponCode: this.weaponCode,
      score: this.score,
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

  constructor(name: string, position: Position, direction: number, firedByPlayer: string, health: number = 1) {
    this.id = crypto.randomBytes(4).toString('hex');
    this.name = name;
    this.position = position;
    this.direction = direction;
    this.speed = 300;
    this.firedByPlayer = firedByPlayer;
    this.health = health;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      position: this.position,
      direction: this.direction,
      health: this.health,
    };
  }

  isCollision(zombie: Zombie): boolean {
    if (this.direction === zombie.direction) return false;
    const xDiff = Math.abs(this.position.x - zombie.position.x);
    const zDiff = Math.abs(this.position.z - zombie.position.z);
    if (xDiff < 100 && zDiff < 100) return true;
    return false;
  }

  update(elapsed: number) {
    this.position.z += elapsed * this.speed * this.direction;
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
