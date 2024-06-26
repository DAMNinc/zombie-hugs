'use strict';

const crypto = require('crypto');
const { uniqueNamesGenerator, adjectives, colors, animals, names } = require('unique-names-generator');
const logger = require('./logger');

const playerNameConfig = { dictionaries: [adjectives, names], length: 2 };
const zombieNameConfig = { dictionaries: [colors, animals], length: 2 };

function healthFromCode(code) {
  // This is duplicate code from src/client/constants.js
  switch(code) {
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

var gameCounter = 0;
var games = {};

var Game = function (id, gameName) {
  this.id = id;
  this.gameName = gameName ? gameName : 'That DAMN game';
  this.startTime = new Date();
  this.players = {};
  this.spectators = {};
  this.zombies = {};
  this.locationModifier = -1;

  this.timestamp = Date.now();
};

/**
 * Emits an event to all game listeners, both players and spectators.
 */
Game.prototype.emitAll = function () {
  for (var key in this.players) {
    var player = this.players[key];
    player.socket.emit.apply(player.socket, arguments);
  }

  for (var key in this.spectators) {
    var spectator = this.spectators[key];
    spectator.socket.emit.apply(spectator.socket, arguments);
  }
};

/**
 * Joins a player character to this game. The server listens for movement and
 * fire events from the player.
 * @param {Player} player - An instance of a player.
 */
Game.prototype.joinPlayer = function (player) {
  // If there are already 2 players, send a join error to the client.
  if (Object.keys(this.players).length >= 2) {
    logger.info('%s cannot join game %s as player. Game is full', player.name, this.id);
    return player.socket.emit('join.error.full');
  }

  logger.info('%s joined game %s as player', player.name, this.id);

  this.players[player.id] = player;

  for (var key in this.players) {
    // When more than one player has connected, notify all players that the
    // opponent has joined.
    if (this.players[key] !== player) {
      this.players[key].sendOpponentInfo(player);
      player.sendOpponentInfo(this.players[key]);
    }
  }

  // Start listening for zombies from the player.
  player.socket.on('fire', (position, weaponCode) => {
    logger.verbose('A zombie was added in game %s', this.id, position);

    const health = healthFromCode(weaponCode);

    const zombieName = uniqueNamesGenerator(zombieNameConfig);
    const zombie = new Zombie(zombieName, position, player.direction * -1, player.id, health);
    this.zombies[zombie.id] = zombie;
    this.emitAll('zombie', zombie.toJSON(), player.id);
  });

  player.socket.on('move.start', keyCode => {
    player.toggleMovement(keyCode, true);
    this.emitAll('move.start', keyCode, player.id);
  });

  player.socket.on('move.end', keyCode => {
    player.toggleMovement(keyCode, false);
    this.emitAll('move.end', keyCode, player.id);
  });

  player.socket.on('weapon.set', code => {
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
};

Game.prototype.exitPlayer = function (player) {
  logger.info(`Player ${player.name} (${player.id}) exited`);
  this.emitAll('player.exit', player.id);
  delete this.players[player.id];
  this.locationModifier *= -1; // TODO: This doesn't work properly:-)
  if (Object.keys(this.players).length === 0) {
    logger.info(`No more players in ${this.id}!`);
  }
};

/**
 * Joins a spectator player to this game. A spectator might emit events but the
 * server does not care about them (right now at least).
 * @param {Player} spectator - An instance of a player.
 */
Game.prototype.joinSpectator = function (spectator) {
  logger.info('%s joined game %s as spectator', spectator.id, this.id);

  // Tell the spectator about all players.
  for (var key in this.players) {
    spectator.sendOpponentInfo(this.players[key]);
  }

  // Add the spectator to the game.
  this.spectators[spectator.id] = spectator;

  this.emitAll('spectator', spectator.toJSON());
};

Game.prototype.update = function (elapsed) {
  if (this.updating) return;

  this.updating = true;

  for (let key in this.players) {
    const player = this.players[key];
    player.update(elapsed);
  }

  for (let key of Object.keys(this.zombies)) {
    // Zombie might have been deleted already.
    if (!this.zombies[key]) continue;

    // Update position and stuff.
    let zombie = this.zombies[key];
    zombie.update(elapsed);

    // Check out of bounds
    if (this.isOutOfBounds(zombie)) {
      this.emitAll("zombie.out-of-bounds", zombie.id, zombie.firedByPlayer);
      if (zombie.firedByPlayer in this.players) {
        this.players[zombie.firedByPlayer].score += 1;
      }
      delete this.zombies[key];
      continue;
    }

    // Check collisions.
    for (let otherKey in this.zombies) {
      // Don't check against itself :-)
      if (key === otherKey) continue;

      let otherZombie = this.zombies[otherKey];
      if (zombie.isCollision(otherZombie)) {
        this.emitAll("zombie.collision", zombie.id, otherZombie.id);
        //this.players[zombie.firedByPlayer].score += 1;
        //this.players[otherZombie.firedByPlayer].score += 1;
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
};

/**
 * Returns a JSON compatible object that respresents the current gamestate.
 */
Game.prototype.toJSON = function () {
  const state = {
    players: {},
    zombies: {}
  };

  for (let key in this.players) {
    const player = this.players[key];
    state.players[key] = player.toJSON();
  }

  for (let key in this.zombies) {
    const zombie = this.zombies[key];
    state.zombies[key] = zombie.toJSON();
  }

  return state;
};

/**
 * Returns the elapsed game time since the last time the function was called,
 * in seconds.
 */
Game.prototype.elapsed = function () {
  const newTime = Date.now();
  const elapsed = newTime - this.timestamp;
  this.timestamp = newTime;
  return elapsed / 1000;
};

Game.prototype.start = function () {
  setInterval(() => {
    this.emitAll('state', this.toJSON());
  }, 1000);

  setInterval(() => {
    this.update(this.elapsed());
  }, 100);

  setInterval(() => {
    this.checkPing();
  }, 5000);
};

Game.prototype.checkPing = function () {
  Object.keys(this.players).forEach(key => {
    const player = this.players[key];
    if (Date.now() - player.lastPing >= 5000) {
      logger.warn(`Player ${player.id} did not ping for a long time!`);
      this.exitPlayer(player);
    }
  });
};

Game.prototype.isOutOfBounds = function (zombie) {
  // TODO: use real bounds instead of magic numbers.
  return zombie.position.z < -1500 || zombie.position.z > 1500;
}

/**
 * Represents a connection to a player client.
 */
var Player = function (socket, name, x, y, z, direction, weaponCode) {
  this.id = socket.id;
  this.name = name;
  this.position = {
    x: x,
    y: y,
    z: z
  };
  this.direction = direction;
  this.socket = socket;
  this.left = false;
  this.right = false;
  this.weaponCode = weaponCode;
  this.lastPing = Date.now();
  this.score = 0;
};

Player.prototype.toJSON = function () {
  return {
    id: this.id,
    name: this.name,
    position: this.position,
    direction: this.direction,
    weaponCode: this.weaponCode,
    score: this.score
  };
};

Player.prototype.sendPlayerInfo = function () {
  this.socket.emit('player', this.toJSON());
};

Player.prototype.sendOpponentInfo = function (opponent) {
  this.socket.emit('opponent', opponent.toJSON());
};

Player.prototype.setWeaponCode = function (code) {
  this.weaponCode = code;
}

Player.prototype.update = function (elapsed) {
  let curPosX = this.position.x;

  // How much to move.
  const tr = 100.0;

  if (this.left) {
    curPosX -= tr * elapsed * this.direction;
  }
  else if (this.right) {
    curPosX += tr * elapsed * this.direction;
  }

  this.position.x = curPosX;
};

Player.prototype.toggleMovement = function (keyCode, directionBool) {
  switch (keyCode) {
    case -1:  // Custom keycode for touch
    case 37:  // Leftarrow
    case 65:  // a key
      this.left = directionBool;
      break;
    case 1:  // Custom keycode for touch
    case 39:  // Right arrow
    case 68:  // d key
      this.right = directionBool;
      break;
  }
};

class Zombie {
  constructor(name, position, direction, firedByPlayer, health = 1) {
    this.id = crypto.pseudoRandomBytes(4).toString('hex');
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
      health: this.health
    };
  }

  isCollision(zombie) {
    if (this.direction === zombie.direction) return false;
    let xDiff = Math.abs(this.position.x - zombie.position.x);
    let zDiff = Math.abs(this.position.z - zombie.position.z);
    if (xDiff < 100 && zDiff < 100) return true;
    return false;
  }

  update(elapsed) {
    this.position.z += elapsed * this.speed * this.direction;
  }
}

var createGame = function (gameName) {
  const gameId = gameCounter++;
  games[gameId] = new Game(gameId, gameName);
  games[gameId].start();
  return gameId;
};

var listenForJoin = function (socket) {
  socket.on('join.player', function (data) {
    const game = games[data.gameId];
    const playerName = uniqueNamesGenerator(playerNameConfig);
    const player = new Player(
      socket, playerName, 0, 0, 1000 * game.locationModifier, game.locationModifier, 1);

    game.locationModifier *= -1;

    player.sendPlayerInfo();
    game.joinPlayer(player);
  });

  socket.on('join.spectator', function (data) {
    const game = games[data.gameId];
    const spectatorName = uniqueNamesGenerator(playerNameConfig);
    const player = new Player(socket, spectatorName, 0, 0, 0, 0);
    game.joinSpectator(player);
  });
};

var setupSocket = function (socket) {
  logger.info('A client connected.');
  listenForJoin(socket);

  socket.on('error', function (err) {
    logger.error(err);
  });
};

module.exports = {
  setupSocket: setupSocket,
  games: games,
  newGame: createGame
};
