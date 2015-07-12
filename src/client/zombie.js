'use strict';

/* global THREE */

var io = require('socket.io-client');

var camera = null,
    camController = null,
    scene = null,
    renderer = null,
    gameState = null,
    clock = null,
    animationId = null,
    animating = false,
    Player = require('./player'),
    Fox = require('./fox'),
    Terrain = require('./terrain'),
    CamController = require('./camController'),
    socket = io();

function updateGameState(elapsed) {
  for (var key in gameState.players) {
    gameState.players[key].update(elapsed);
  }

  for (var key in gameState.zombies) {
    gameState.zombies[key].update(elapsed);
  }

  if (camController != null) {
    camController.update(elapsed);
  }
}

/**
 * Handle a resize of the viewport
 */
function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupEvents() {
  // Event for receiving information about zombies.
  socket.on('zombie', function(zombie) {
    console.log('Zombie added', zombie);

    var fox = new Fox(zombie.direction);

    // Set the fox at the mesh position.
    // The fox is "standing over the y-axis" so a little bit is
    // subtracted from the y-axis coordinate.
    fox.foxObj.mesh.position.x = zombie.position.x;
    fox.foxObj.mesh.position.y = zombie.position.y-50;
    fox.foxObj.mesh.position.z = zombie.position.z;

    // Rotate 180 degrees to face away from player.
    if (zombie.direction === -1) {
      fox.foxObj.mesh.rotation.y = Math.PI;
    }

    var mesh = fox.getMesh();

    // Add the mesh of the zombie to the scene.
    scene.add(mesh);

    // Save a reference to the zombie so it can be updated.
    gameState.zombies[zombie.id] = fox;
  });

  // Event for receiving player information from the server.
  // Used for signalling how the server perceives this player.
  // This event will not be emitted for spectators.
  socket.on('player', function(player) {
    gameState.myId = player.id;
    console.log('I am player', player.id);

    var p = new Player(player.id, player.position, player.direction);
    gameState.players[player.id] = p;

    camera.position.z = player.position.z;

    // Rotate 180 degrees to look at the other player
    if (player.direction === -1) {
      camera.rotation.y = Math.PI;
    }

    camController = new CamController(camera, socket, player.direction);
  });

  // Event for receiving opponent information from the server.
  socket.on('opponent', function(player) {
    console.log('opponent: ', player.id);

    var p = new Player(player.id, player.position, player.direction);
    gameState.players[player.id] = p;

    if (player.id !== gameState.myId) {
      // render player
      scene.add(p.getMesh());
    }
  });

  // Event for receiving spectator information from the server.
  socket.on('spectator', function(player) {
    console.log('spectator joined: ', player.id);
  });

  socket.on('move.start', function(keyCode, playerId) {
    console.log('Player move start', keyCode, playerId);
    gameState.players[playerId].toggleMovement(keyCode, true);
  });

  socket.on('move.end', function(keyCode, playerId) {
    console.log('Player move end', keyCode, playerId);
    gameState.players[playerId].toggleMovement(keyCode, false);
  });

  socket.on('state', function(state) {
    for (var key in state.zombies) {
      var serverZombie = state.zombies[key];
      var clientZombie = gameState.zombies[key];
      if (!serverZombie || !clientZombie) {
        return console.error('Server zombie or client zombie missing!');
      }
      clientZombie.setPosition(serverZombie.position);
    }

    for (var key in state.players) {
      var serverPlayer = state.players[key];
      var clientPlayer = gameState.players[key];
      if (!serverPlayer || !clientPlayer) {
        return console.error('Server player or client player missing!');
      }
      clientPlayer.setPosition(serverPlayer.position);
    }
  });
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId) {
  // Init scene and camera.
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

  // Init timetaking
  clock = new THREE.Clock(true);

  // Init gamestate
  gameState = {
    myId: null,
    players: {},
    zombies: {}
  };

  var terrain = new Terrain(128, 128, camera.position.y);
  scene.add(terrain.getMesh());

  // Init renderer and add its DOM element to the given render area.
  renderer = new THREE.WebGLRenderer({ alpha: true });
  var renderArea = document.getElementById(renderAreaId);
  if (renderArea.hasChildNodes()) {
    renderArea.removeChild(renderArea.childNodes[0]);
  }
  renderArea.appendChild(renderer.domElement);

  // Trigger a resize and set up a window event for resizing.
  handleResize();
  window.addEventListener('resize', handleResize);
}

/**
 * Animates everything.
 */
function animate() {
  if (animating) {
    // clock.getDelta returns the time in seconds since last call.
    var elapsed = clock.getDelta();
    updateGameState(elapsed);

    // Re-animate and render.
    animationId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
}

function ZombieHugs() {}

/**
 * Starts the game.
 */
ZombieHugs.prototype.start = function(renderArea) {
  // Cancel the previous animation loop.
  if (animationId !== null) cancelAnimationFrame(animationId);
  init(renderArea);
  gameState.game = this;
  setupEvents();
  animating = true;
  animate();
};

ZombieHugs.prototype.stop = function() {
  animating = false;
};

/**
 * Tells the game that a player wants to join the current game.
 */
ZombieHugs.prototype.joinPlayer = function(gameId) {
  // Tell the server that we would like to join as a player. This might not be
  // possible if there are already two players so listen for a join error event
  var self = this;
  socket.on('join.error.full', function() {
    // A join error means that we cannot join as player.
    // Join as spectator instead...
    // TODO: Add nice modal popup or something :-)
    self.joinSpectator(gameId);
  });

  socket.emit('join.player', {gameId: gameId});
};

/**
 * Tells the game that a player wants to join as spectator.
 */
ZombieHugs.prototype.joinSpectator = function(gameId) {
  socket.emit('join.spectator', {gameId: gameId});
  camController = new CamController(camera);
};

window.ZombieHugs = new ZombieHugs();
