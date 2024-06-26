'use strict';

const THREE = require('three');
const { io } = require('socket.io-client');
import Models from "./models";
import Player from "./player";
import Constants from "./constants";
import CamController from './camController';
import Explosion from './explosion';
import Terrain from './terrain';
import Fox from './fox';
import console from './console';
import Score from './score';

let camera = null,
  camController = null,
  scene = null,
  renderer = null,
  gameState = null,
  models = null,
  clock = null,
  animationId = null,
  animating = false,
  socket = io();

function updateGameState(elapsed) {
  for (let key in gameState.players) {
    gameState.players[key].update(elapsed);
  }

  for (let key in gameState.zombies) {
    gameState.zombies[key].update(elapsed);
  }

  for (let explosion of gameState.explosions) {
    explosion.update(elapsed);
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

function removeZombie(zombieId) {
  const zombie = gameState.zombies[zombieId];
  scene.remove(zombie.getMesh());
  delete gameState.zombies[zombieId];
}

function getZombieModelFromCode(code) {
  let zombieModel;
  switch (code) {
    case Constants.FOX:
      zombieModel = models.getZombie();
      break;
    case Constants.HORSE:
      zombieModel = models.getHorse();
      break;
    case Constants.FLAMINGO:
      zombieModel = models.getFlamingo();
      break;
  }
  return zombieModel;
}

function createFoxFromModel(direction, position, model, name) {
  var fox = new Fox(direction, model, name);

  // Set the fox at the mesh position.
  // The fox is "standing over the y-axis" so a little bit is
  // subtracted from the y-axis coordinate.
  fox.foxObj.mesh.position.x = position.x + model.offset.x;
  fox.foxObj.mesh.position.y = position.y - 50 + model.offset.y;
  fox.foxObj.mesh.position.z = position.z + model.offset.z;

  // Rotate 180 degrees to face away from player.
  if (direction === -1) {
    fox.foxObj.mesh.rotation.y = Math.PI;
  }

  return fox;
}

function setWeapon(player, code) {
  console.log('called for ' + player.name);
  var zombieModel = getZombieModelFromCode(code);

  const startPosition = { x: player.getMesh().position.x, y: player.getMesh().position.y, z: player.getMesh().position.z };
  startPosition.z += player.getDirection() * -1 * 100;
  startPosition.y += 50;
  startPosition.x += player.getDirection() * -1 * 25;

  const currentWeaponMesh = player.getCurrentWeapon();
  if (currentWeaponMesh) {
    scene.remove(currentWeaponMesh.getMesh());
  }

  const fox = createFoxFromModel(player.getDirection() * -1, startPosition, zombieModel);
  fox.setSpeed(0);
  fox.getMesh().scale.set(0.25, 0.25, 0.25);
  scene.add(fox.getMesh());

  player.setWeapon(code, fox);
}

function setupEvents() {
  // Event for receiving information about zombies.
  socket.on('zombie', function (zombie, playerId) {
    console.log('Zombie added for ' + playerId, zombie);

    const zombieModel = getZombieModelFromCode(gameState.players[playerId].getWeaponCode());

    var fox = createFoxFromModel(zombie.direction, zombie.position, zombieModel, zombie.name);

    // Add the mesh of the zombie to the scene.
    scene.add(fox.getMesh());

    // Save a reference to the zombie so it can be updated.
    gameState.zombies[zombie.id] = fox;
  });

  // Event for receiving player information from the server.
  // Used for signalling how the server perceives this player.
  // This event will not be emitted for spectators.
  socket.on('player', function (player) {
    gameState.myId = player.id;
    console.info('I am: ' + player.name);

    var p = new Player(player.id, player.name, player.position, player.direction, models.getPlayer(player.direction));
    setWeapon(p, Constants.FOX);

    gameState.players[player.id] = p;

    camera.position.z = player.position.z;

    // Rotate 180 degrees to look at the other player
    if (player.direction === -1) {
      camera.rotation.y = Math.PI;
    }

    camController = new CamController(camera, socket, player.direction);
  });

  // Event for receiving opponent information from the server.
  socket.on('opponent', function (player) {
    console.info('The opponent has joined the game: ' + player.name);

    var p = new Player(player.id, player.name, player.position, player.direction, models.getPlayer(player.direction));
    setWeapon(p, player.weaponCode);

    gameState.players[player.id] = p;

    if (player.id !== gameState.myId) {
      // render player
      scene.add(p.getMesh());
    }
  });

  // Event for receiving spectator information from the server.
  socket.on('spectator', function (player) {
    console.info('A spectator has joined...');
  });

  socket.on('move.start', function (keyCode, playerId) {
    console.log('Player move start', keyCode, playerId);
    gameState.players[playerId].toggleMovement(keyCode, true);
  });

  socket.on('move.end', function (keyCode, playerId) {
    console.log('Player move end', keyCode, playerId);
    gameState.players[playerId].toggleMovement(keyCode, false);
  });

  socket.on('state', function (state) {
    for (let key in state.zombies) {
      const serverZombie = state.zombies[key];
      const clientZombie = gameState.zombies[key];
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
      clientPlayer.setScore(serverPlayer.score);
      if (clientPlayer.id === gameState.myId) Score.update(serverPlayer.score);
    }
  });

  socket.on('zombie.collision', function (zombieId1, zombieId2) {
    const zombie1 = gameState.zombies[zombieId1];
    const zombie2 = gameState.zombies[zombieId2];
    console.info('Collision between ' + zombie1.name + ' and ' + zombie2.name);

    gameState.explosions.push(new Explosion(scene, zombie1.getMesh().position));

    zombie1.health -= 1;
    console.info('Zombie1 health: ' + zombie1.health);
    if (zombie1.health <= 0) {
      removeZombie(zombieId1);
    }

    zombie2.health -= 1;
    console.info('Zombie2 health: ' + zombie2.health);
    if (zombie2.health <= 0) {
      removeZombie(zombieId2);
    }
  });

  socket.on('zombie.out-of-bounds', function (zombieId) {
    const zombie = gameState.zombies[zombieId];
    console.info(zombie.name + ' has left the building!');
    removeZombie(zombieId);
  });

  socket.on('weapon.set', function (code, playerId) {
    var player = gameState.players[playerId];

    console.info(player.name + ' switch to ' + code);

    setWeapon(player, code);
  });

  socket.on('player.exit', function (playerId) {
    var player = gameState.players[playerId];
    console.info('Player exited!', player.name);
    scene.remove(player.getMesh());
    delete gameState.players[playerId];
  });
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId) {
  // load models
  models = new Models();

  // Init scene and camera.
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

  var hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 10);
  hemiLight.color.setHSL(0.6, 1, 0.6);
  hemiLight.groundColor.setHSL(0.095, 1, 0.75);
  hemiLight.position.set(0, 500, 0);
  scene.add(hemiLight);

  // Init timetaking
  clock = new THREE.Clock(true);

  // Init gamestate
  gameState = {
    myId: null,
    players: {},
    zombies: {},
    explosions: []
  };

  const terrain = new Terrain(128, 128, camera.position.y);
  scene.add(terrain.getMesh());

  const explosion = new Explosion(scene, { x: 0, y: 0, z: 0 });
  gameState.explosions.push(explosion);

  // Init renderer and add its DOM element to the given render area.
  renderer = new THREE.WebGLRenderer({ alpha: true });
  const renderArea = document.getElementById(renderAreaId);
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

/**
 * Tells the game that a player wants to join the current game.
 */
function joinPlayer(gameId) {
  // Tell the server that we would like to join as a player. This might not be
  // possible if there are already two players so listen for a join error event
  socket.on('join.error.full', function () {
    // A join error means that we cannot join as player.
    // Join as spectator instead...
    joinSpectator(gameId);

    // Tell the window about it. Someone might be listening :-)
    const ev = new Event('join.spectator.full');
    window.dispatchEvent(ev);
  });

  socket.emit('join.player', { gameId: gameId });
}

/**
 * Tells the game that a player wants to join as spectator.
 */
function joinSpectator(gameId) {
  socket.emit('join.spectator', { gameId: gameId });
  camController = new CamController(camera);
}

function exitGame(gameId) {
  socket.emit('exit', { gameId: gameId });
  window.location.href = '/';
}

function ZombieHugs() { }

/**
 * Starts the game.
 */
ZombieHugs.prototype.start = function (params) {
  // Cancel the previous animation loop.
  if (animationId !== null) cancelAnimationFrame(animationId);
  init(params.renderAreaId);
  document.getElementById(params.exitButtonId)
    .addEventListener('click', () => {
      exitGame(params.gameId);
    });

  // wait until models have been loaded

  const checkReady = () => {
    if (!models.isReady()) {
      console.log("Waiting for models...");
      setTimeout(checkReady, 1000);
    } else {
      console.log("Models loaded");
      gameState.game = this;
      setupEvents();
      animating = true;
      animate();

      // Join as spectator or player
      if (params.isSpectator) {
        joinSpectator(params.gameId);
      } else {
        joinPlayer(params.gameId);
      }
    }
  };

  this.pingInterval = setInterval(() => {
    // 'ping' is reserved...
    socket.emit('pingpong');
  }, 1000);

  checkReady();
};

ZombieHugs.prototype.stop = function () {
  animating = false;
};

window.ZombieHugs = new ZombieHugs();
