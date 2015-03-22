'use strict';

var io = require('socket.io-client');

var camera = null,
    scene = null,
    renderer = null,
    gameState = null,
    clock = null,
    animationId = null,
    animating = false,
    Player = require('./player'),
    Opponent = require('./opponent'),
    Fox = require('./fox'),
    Sphere = require('./sphere'),
    Terrain = require('./terrain'),
    socket = io();

function updateGameState(elapsed) {
  if (gameState.player != null) {
    gameState.player.update(elapsed);
  }

  if (gameState.opponent != null) {
    gameState.opponent.update(elapsed);
  }

  for (var i = 0; i < gameState.zombies.length; i++) {
    gameState.zombies[i].update(elapsed);
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
    gameState.opponent.fire();
  });

  // Event for receiving player information from the server.
  // Used for signalling how the server perceives this player.
  socket.on('player', function(player) {
    gameState.player.setId(player.id);
    console.log('I am player', player.id);
  });

  socket.on('opponent', function(player) {
    gameState.opponent = new Opponent(gameState.game, socket);
    gameState.opponent.setId(player.id);
    scene.add(gameState.opponent.mesh);
    console.log('My opponent is', gameState.opponent.id);
  });
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId) {
  // Init scene and camera.
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);
  camera.position.z = 2000;
  

  // Init timetaking
  clock = new THREE.Clock(true);

  // Init gamestate
  gameState = {
    game: null,
    player: null,
    opponent: null,
    zombies: []
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
ZombieHugs.prototype.start = function(renderArea, gameId) {
  // Cancel the previous animation loop.
  if (animationId !== null) cancelAnimationFrame(animationId);
  init(renderArea);
  gameState.game = this;
  setupEvents();
  animating = true;
  animate();
  // TODO: Start as spectator, make a join button that calls this function.
  this.joinGame(gameId);
};

ZombieHugs.prototype.stop = function() {
  animating = false;
};

ZombieHugs.prototype.getGame = function() {
  return game;
};

/**
 * Tells the game that a player wants to join the current game. If the game
 * already has two players, it cannot be joined as a player.
 */
ZombieHugs.prototype.joinGame = function(gameId) {
  // Create a new player and give the player a reference to this game.
  // The player also controls the camera of the scene.
  gameState.player = new Player(this, camera, socket);
  socket.emit('join', {gameId: gameId});
};

/**
 * Adds the given object to the scene.
 */
ZombieHugs.prototype.addZombie = function(zombie, player) {

    var mesh = zombie.getMesh();

    // Add the mesh of the zombie to the scene.
    scene.add(mesh);

    // Save a reference to the zombie so it can be updated.
    gameState.zombies.push(zombie);

    var zombie = {
      x: mesh.position.x,
      player: gameState.player.id
    };

    // Only emit on the socket when it is the current player that adds a
    // zombie.
    if (player === gameState.player) {
      socket.emit('zombie', zombie);
    }
};

window.ZombieHugs = new ZombieHugs();
