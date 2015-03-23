'use strict';

var logger = require('./logger');

var gameCounter = 0;
var games = {};

var Game = function(id) {
	this.id = id;
	this.players = {};
  this.locationModifier = -1;
};

Game.prototype.joinPlayer = function(player) {
  var self = this;
  
  this.players[player.id] = player;
  
  for (var key in this.players) {
    // When more than one player has conneted, notify all players that the
    // opponent has joined.
    this.players[key].sendOpponentInfo(player);
    player.sendOpponentInfo(this.players[key]); 
  }

  logger.info(
    '%s joined game %s', player.id, this.id);

  // Start listening for zombies from the player.
  player.socket.on('fire', function(position) {
    logger.verbose('A zombie was added in game %s', self.id, position);

    var zombie = { 
        position: position,
        direction: player.direction * -1
      };

    for (var key in self.players) {
      self.players[key].socket.emit('zombie', zombie);
    }
  });

  player.socket.on('move.start', function(keyCode) {
    for (var key in self.players) {
      self.players[key].socket.emit('move.start', keyCode, player.id);
    }
  });

  player.socket.on('move.end', function(keyCode) {
    for (var key in self.players) {
      self.players[key].socket.emit('move.end', keyCode, player.id);
    }
  });
};

/**
 * Represents a connection to a player client.
 */
var Player = function(socket, x, y, z, direction) {
  // TODO: Deprecate this ID since it is unnecessary to store it.
  this.id = socket.id;
  this.position = { x: x, 
                    y: y,
                    z: z };
  this.direction = direction;
  this.socket = socket;
};

Player.prototype.toJSON = function() {
  return {
    id: this.id,
    position: this.position,
    direction: this.direction
  };
};

Player.prototype.sendPlayerInfo = function() {
  this.socket.emit('player', this.toJSON());
};

Player.prototype.sendOpponentInfo = function(opponent) {
  this.socket.emit('opponent', opponent.toJSON());
};

var createGame = function() {
	var gameId = gameCounter++;
	games[gameId] = new Game(gameId);
  return gameId;
};

var listenForJoin = function(socket) {
  socket.on('join', function(data) {
    var game = games[data.gameId];
    var player = new Player(socket, 0, 0, 1000*game.locationModifier, game.locationModifier);

    game.locationModifier *= -1;

    player.sendPlayerInfo();
    game.joinPlayer(player);
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
