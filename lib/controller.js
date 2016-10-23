'use strict';

var logger = require('./logger');
var crypto = require('crypto');

var gameCounter = 0;
var games = {};

var Game = function(id, gameName) {
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
Game.prototype.emitAll = function() {
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
Game.prototype.joinPlayer = function(player) {
  // If there are already 2 players, send a join error to the client.
  if (Object.keys(this.players).length >= 2) {
    logger.info(
      '%s cannot join game %s as player. Game is full', player.id, this.id);
    return player.socket.emit('join.error.full');
  }

  logger.info('%s joined game %s as player', player.id, this.id);

  this.players[player.id] = player;

  for (var key in this.players) {
    // When more than one player has conneted, notify all players that the
    // opponent has joined.
    if (this.players[key] !== player) {
      this.players[key].sendOpponentInfo(player);
      player.sendOpponentInfo(this.players[key]);
    }
  }

  // Start listening for zombies from the player.
  var self = this;
  player.socket.on('fire', function(position) {
    logger.verbose('A zombie was added in game %s', self.id, position);

    var zombie = new Zombie(position, player.direction * -1);
    self.zombies[zombie.id] = zombie;
    self.emitAll('zombie', zombie.toJSON(), player.id);
  });

  player.socket.on('move.start', function(keyCode) {
    player.toggleMovement(keyCode, true);
    self.emitAll('move.start', keyCode, player.id);
  });

  player.socket.on('move.end', function(keyCode) {
    player.toggleMovement(keyCode, false);
    self.emitAll('move.end', keyCode, player.id);
  });

  player.socket.on('weapon.set', function(code) {
    console.log('Player ' + player.id + ' switch to ' + code);
    player.setWeaponCode(code);
    self.emitAll('weapon.set', code, player.id);
  });
};


/**
 * Joins a spectator player to this game. A spectator might emit events but the
 * server does not care about them (right now at least).
 * @param {Player} spectator - An instance of a player.
 */
Game.prototype.joinSpectator = function(spectator) {
  logger.info('%s joined game %s as spectator', spectator.id, this.id);

  // Tell the spectator about all players.
  for (var key in this.players) {
    spectator.sendOpponentInfo(this.players[key]);
  }

  // Add the spectator to the game.
  this.spectators[spectator.id] = spectator;

  this.emitAll('spectator', spectator.toJSON());
};

Game.prototype.update = function(elapsed) {
  if (this.updating) return;

  this.updating = true;

  for (var key in this.players) {
    var player = this.players[key];
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
      this.emitAll("zombie.out-of-bounds", zombie.id);
      delete this.zombies[key];
      continue;
    }

    // Check collisions.
    for (let otherKey of Object.keys(this.zombies)) {
      // Don't check against itself :-)
      if (key === otherKey) continue;

      let otherZombie = this.zombies[otherKey];
      if (zombie.isCollision(otherZombie)) {
        this.emitAll("zombie.collision", zombie.id, otherZombie.id);
        delete this.zombies[key];
        delete this.zombies[otherKey];
        break;
      }
    }
  }

  this.updating = false;
};

/**
 * Returns a JSON compatible object that respresents the current gamestate.
 */
Game.prototype.toJSON = function() {
  var state = {
    players: {},
    zombies: {}
  };

  for (var key in this.players) {
    var player = this.players[key];
    state.players[key] = player.toJSON();
  }

  for (var key in this.zombies) {
    var zombie = this.zombies[key];
    state.zombies[key] = zombie.toJSON();
  }

  return state;
};

/**
 * Returns the elapsed game time since the last time the function was called,
 * in seconds.
 */
Game.prototype.elapsed = function() {
  var newTime = Date.now();
  var elapsed = newTime - this.timestamp;
  this.timestamp = newTime;
  return elapsed/1000;
};

Game.prototype.start = function() {
  var self = this;
  setInterval(function() {
    self.emitAll('state', self.toJSON());
  }, 1000);

  setInterval(function() {
    self.update(self.elapsed());
  }, 100);
};

Game.prototype.isOutOfBounds = function(zombie) {
  // TODO: use real bounds instead of magic numbers.
  return zombie.position.z < -1500 || zombie.position.z > 1500;
}


/**
 * Represents a connection to a player client.
 */
var Player = function(socket, x, y, z, direction, weaponCode) {
  this.id = socket.id;
  this.position = { x: x,
                    y: y,
                    z: z };
  this.direction = direction;
  this.socket = socket;
  this.left = false;
  this.right = false;
  this.weaponCode = weaponCode;
};

Player.prototype.toJSON = function() {
  return {
    id: this.id,
    position: this.position,
    direction: this.direction,
    weaponCode: this.weaponCode
  };
};

Player.prototype.sendPlayerInfo = function() {
  this.socket.emit('player', this.toJSON());
};

Player.prototype.sendOpponentInfo = function(opponent) {
  this.socket.emit('opponent', opponent.toJSON());
};
Player.prototype.setWeaponCode = function(code) {
  this.weaponCode = code;
}

Player.prototype.update = function(elapsed) {
  var curPosX = this.position.x;

  // How much to move.
  var tr = 100.0;

  if (this.left) {
    curPosX -= tr*elapsed*this.direction;
  }
  else if (this.right) {
    curPosX += tr*elapsed*this.direction;
  }

  this.position.x = curPosX;
};

Player.prototype.toggleMovement = function(keyCode, directionBool) {
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
  constructor(position, direction) {
    this.id = crypto.pseudoRandomBytes(4).toString('hex');
    this.position = position;
    this.direction = direction;
    this.speed = 300;
  }

  toJSON() {
    return {
      id: this.id,
      position: this.position,
      direction: this.direction
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

var createGame = function(gameName) {
	var gameId = gameCounter++;
	games[gameId] = new Game(gameId, gameName);
  games[gameId].start();
  return gameId;
};

var listenForJoin = function(socket) {
  socket.on('join.player', function(data) {
    var game = games[data.gameId];
    var player = new Player(
      socket, 0, 0,1000*game.locationModifier, game.locationModifier, 1);

    game.locationModifier *= -1;

    player.sendPlayerInfo();
    game.joinPlayer(player);
  });

  socket.on('join.spectator', function(data) {
    var game = games[data.gameId];
    var player = new Player(socket, 0, 0, 0, 0);
    game.joinSpectator(player);
  });
};

var setupSocket = function(socket) {
  logger.info('A client connected.');
  listenForJoin(socket);

  socket.on('error', function(err) {
    logger.error(err);
  });
};

module.exports = {
  setupSocket: setupSocket,
  games: games,
  newGame: createGame
};
