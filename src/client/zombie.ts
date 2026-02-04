import { io } from 'socket.io-client';
import Models from './models';
import Player from './player';
import Constants from './constants';
import CamController from './camController';
import Explosion from './explosion';
import Terrain from './terrain';
import Fox from './fox';
import gameConsole from './console';
import Score from './score';

let camera: any = null;
let camController: CamController | null = null;
let scene: any = null;
let renderer: any = null;
let gameState: any = null;
let models: Models | null = null;
let clock: any = null;
let animationId: number | null = null;
let animating = false;
const socket = io();

function updateGameState(elapsed: number): void {
  for (const key in gameState.players) {
    gameState.players[key].update(elapsed);
  }

  for (const key in gameState.zombies) {
    gameState.zombies[key].update(elapsed);
  }

  for (const explosion of gameState.explosions) {
    explosion.update(elapsed);
  }

  if (camController != null) {
    camController.update(elapsed);
  }
}

/**
 * Handle a resize of the viewport
 */
function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function removeZombie(zombieId: string): void {
  const zombie = gameState.zombies[zombieId];
  scene.remove(zombie.getMesh());
  delete gameState.zombies[zombieId];
}

function getZombieModelFromCode(code: number): any {
  let zombieModel: any;
  switch (code) {
    case Constants.FOX:
      zombieModel = models!.getZombie();
      break;
    case Constants.HORSE:
      zombieModel = models!.getHorse();
      break;
    case Constants.FLAMINGO:
      zombieModel = models!.getFlamingo();
      break;
  }
  return zombieModel;
}

function createFoxFromModel(direction: number, position: any, model: any, name?: string): Fox {
  const fox = new Fox(direction, model, name);

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

function setWeapon(player: Player, code: number): void {
  gameConsole.log('called for ' + player.name);
  const zombieModel = getZombieModelFromCode(code);

  const startPosition = {
    x: player.getMesh().position.x,
    y: player.getMesh().position.y,
    z: player.getMesh().position.z,
  };
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

function setupEvents(): void {
  // Event for receiving information about zombies.
  socket.on('zombie', (zombie: any, playerId: string) => {
    gameConsole.log('Zombie added for ' + playerId);

    const zombieModel = getZombieModelFromCode(gameState.players[playerId].getWeaponCode());

    const fox = createFoxFromModel(zombie.direction, zombie.position, zombieModel, zombie.name);

    // Add the mesh of the zombie to the scene.
    scene.add(fox.getMesh());

    // Save a reference to the zombie so it can be updated.
    gameState.zombies[zombie.id] = fox;
  });

  // Event for receiving player information from the server.
  // Used for signalling how the server perceives this player.
  // This event will not be emitted for spectators.
  socket.on('player', (player: any) => {
    gameState.myId = player.id;
    gameConsole.info('I am: ' + player.name);

    const p = new Player(player.id, player.name, player.position, player.direction, models!.getPlayer(player.direction));
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
  socket.on('opponent', (player: any) => {
    gameConsole.info('The opponent has joined the game: ' + player.name);

    const p = new Player(player.id, player.name, player.position, player.direction, models!.getPlayer(player.direction));
    setWeapon(p, player.weaponCode);

    gameState.players[player.id] = p;

    if (player.id !== gameState.myId) {
      // render player
      scene.add(p.getMesh());
    }
  });

  // Event for receiving spectator information from the server.
  socket.on('spectator', (_player: any) => {
    gameConsole.info('A spectator has joined...');
  });

  socket.on('move.start', (keyCode: number, playerId: string) => {
    gameConsole.log('Player move start');
    gameState.players[playerId].toggleMovement(keyCode, true);
  });

  socket.on('move.end', (keyCode: number, playerId: string) => {
    gameConsole.log('Player move end');
    gameState.players[playerId].toggleMovement(keyCode, false);
  });

  socket.on('state', (state: any) => {
    for (const key in state.zombies) {
      const serverZombie = state.zombies[key];
      const clientZombie = gameState.zombies[key];
      if (!serverZombie || !clientZombie) {
        return gameConsole.error('Server zombie or client zombie missing!');
      }
      clientZombie.setPosition(serverZombie.position);
    }

    for (const key in state.players) {
      const serverPlayer = state.players[key];
      const clientPlayer = gameState.players[key];
      if (!serverPlayer || !clientPlayer) {
        return gameConsole.error('Server player or client player missing!');
      }
      clientPlayer.setPosition(serverPlayer.position);
      clientPlayer.setScore(serverPlayer.score);
      if (clientPlayer.id === gameState.myId) Score.update(serverPlayer.score);
    }
  });

  socket.on('zombie.collision', (zombieId1: string, zombieId2: string) => {
    const zombie1 = gameState.zombies[zombieId1];
    const zombie2 = gameState.zombies[zombieId2];
    gameConsole.info('Collision between ' + zombie1.name + ' and ' + zombie2.name);

    gameState.explosions.push(new Explosion(scene, zombie1.getMesh().position));

    zombie1.health -= 1;
    gameConsole.info('Zombie1 health: ' + zombie1.health);
    if (zombie1.health <= 0) {
      removeZombie(zombieId1);
    }

    zombie2.health -= 1;
    gameConsole.info('Zombie2 health: ' + zombie2.health);
    if (zombie2.health <= 0) {
      removeZombie(zombieId2);
    }
  });

  socket.on('zombie.out-of-bounds', (zombieId: string) => {
    const zombie = gameState.zombies[zombieId];
    gameConsole.info(zombie.name + ' has left the building!');
    removeZombie(zombieId);
  });

  socket.on('weapon.set', (code: number, playerId: string) => {
    const player = gameState.players[playerId];
    gameConsole.info(player.name + ' switch to ' + code);
    setWeapon(player, code);
  });

  socket.on('player.exit', (playerId: string) => {
    const player = gameState.players[playerId];
    gameConsole.info('Player exited! ' + player.name);
    scene.remove(player.getMesh());
    delete gameState.players[playerId];
  });
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId: string): void {
  // load models
  models = new Models();

  // Init scene and camera.
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 10);
  hemiLight.color.setHSL(0.6, 1, 0.6);
  hemiLight.groundColor.setHSL(0.095, 1, 0.75);
  hemiLight.position.set(0, 500, 0);
  scene.add(hemiLight);

  // Init timetaking
  clock = new THREE.Clock(true);

  // Init gamestate
  gameState = {
    myId: null,
    players: {} as Record<string, any>,
    zombies: {} as Record<string, any>,
    explosions: [] as Explosion[],
  };

  const terrain = new Terrain(128, 128, camera.position.y);
  scene.add(terrain.getMesh());

  const explosion = new Explosion(scene, { x: 0, y: 0, z: 0 });
  gameState.explosions.push(explosion);

  // Init renderer and add its DOM element to the given render area.
  renderer = new THREE.WebGLRenderer({ alpha: true });
  const renderArea = document.getElementById(renderAreaId);
  if (renderArea) {
    if (renderArea.hasChildNodes()) {
      renderArea.removeChild(renderArea.childNodes[0]);
    }
    renderArea.appendChild(renderer.domElement);
  }

  // Trigger a resize and set up a window event for resizing.
  handleResize();
  window.addEventListener('resize', handleResize);
}

/**
 * Animates everything.
 */
function animate(): void {
  if (animating) {
    // clock.getDelta returns the time in seconds since last call.
    const elapsed = clock.getDelta();
    updateGameState(elapsed);

    // Re-animate and render.
    animationId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
}

/**
 * Tells the game that a player wants to join the current game.
 */
function joinPlayer(gameId: number): void {
  // Tell the server that we would like to join as a player. This might not be
  // possible if there are already two players so listen for a join error event
  socket.on('join.error.full', () => {
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
function joinSpectator(gameId: number): void {
  socket.emit('join.spectator', { gameId: gameId });
  camController = new CamController(camera, null, 0);
}

function exitGame(gameId: number): void {
  socket.emit('exit', { gameId: gameId });
  window.location.href = '/';
}

interface GameParams {
  renderAreaId: string;
  exitButtonId: string;
  gameId: number;
  isSpectator: boolean;
}

class ZombieHugs {
  pingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Starts the game.
   */
  start(params: GameParams): void {
    // Cancel the previous animation loop.
    if (animationId !== null) cancelAnimationFrame(animationId);
    init(params.renderAreaId);
    document.getElementById(params.exitButtonId)?.addEventListener('click', () => {
      exitGame(params.gameId);
    });

    // wait until models have been loaded
    const checkReady = () => {
      if (!models!.isReady()) {
        gameConsole.log('Waiting for models...');
        setTimeout(checkReady, 1000);
      } else {
        gameConsole.log('Models loaded');
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
  }

  stop(): void {
    animating = false;
  }
}

(window as any).ZombieHugs = new ZombieHugs();
