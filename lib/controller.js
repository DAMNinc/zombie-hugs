'use strict';

var logger = require('./logger');

var gameCounter = 0;
var games = {};

var Game = function(id) {
	this.id = id;
	this.players = {};
	this.spectators = {};
  this.locationModifier = -1;
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
    this.players[key].sendOpponentInfo(player);
    player.sendOpponentInfo(this.players[key]);
  }

  // Start listening for zombies from the player.
  var self = this;
  player.socket.on('fire', function(position) {
    logger.verbose('A zombie was added in game %s', self.id, position);

    var zombie = {
        position: position,
        direction: player.direction * -1
      };

    self.emitAll('zombie', zombie);
  });

  player.socket.on('move.start', function(keyCode) {
    self.emitAll('move.start', keyCode, player.id);
  });

  player.socket.on('move.end', function(keyCode) {
    self.emitAll('move.end', keyCode, player.id);
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
  socket.on('join.player', function(data) {
    var game = games[data.gameId];
    var player = new Player(
      socket, 0, 0,1000*game.locationModifier, game.locationModifier);

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
