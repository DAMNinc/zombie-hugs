import * as THREE from 'three';
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
import HUD from './hud';
import Audio from './audio';
import ScreenShake from './screenshake';
import KillFeed from './killfeed';

// Expose THREE globally for non-bundled scripts (gallery.js)
(window as any).THREE = THREE;

let camera: any = null;
let camController: CamController | null = null;
let scene: any = null;
let renderer: any = null;
let gameState: any = null;
let models: Models | null = null;
let clock: any = null;
let animationId: number | null = null;
let animating = false;
let hud: HUD | null = null;
let audio: Audio | null = null;
let screenShake: ScreenShake | null = null;
let killFeed: KillFeed | null = null;
let shieldMeshes: Record<string, any> = {};
let pingStart: number = 0;
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

  if (screenShake) {
    screenShake.update(elapsed);
  }

  if (camController != null) {
    camController.update(elapsed);
  }

  // Update shield cooldown display
  if (hud && camController && !camController.isSpectatorMode()) {
    const now = Date.now();
    const cooldownEnd = gameState.shieldCooldownUntil || 0;
    if (now >= cooldownEnd) {
      hud.updateShieldCooldown(true, 1);
    } else {
      const total = 15000;
      const remaining = cooldownEnd - now;
      hud.updateShieldCooldown(false, 1 - (remaining / total));
    }
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
  if (!zombie) return;
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
    case Constants.HORDE:
      zombieModel = models!.getHorde();
      break;
  }
  return zombieModel;
}

function createFoxFromModel(direction: number, position: any, model: any, name?: string, weaponCode?: number): Fox {
  const fox = new Fox(direction, model, name, weaponCode);

  fox.foxObj.mesh.position.x = position.x + model.offset.x;
  fox.foxObj.mesh.position.y = position.y - 50 + model.offset.y;
  fox.foxObj.mesh.position.z = position.z + model.offset.z;

  // Store baseX for zigzag
  fox.baseX = position.x;

  // Rotate 180 degrees to face away from player.
  if (direction === -1) {
    fox.foxObj.mesh.rotation.y = Math.PI;
  }

  // Horde creatures are smaller
  if (weaponCode === Constants.HORDE) {
    fox.foxObj.mesh.scale.set(0.4, 0.4, 0.4);
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

function getOpponentId(): string | null {
  for (const key in gameState.players) {
    if (key !== gameState.myId) return key;
  }
  return null;
}

function getPlayerName(id: string): string {
  const player = gameState.players[id];
  return player ? player.name : 'Unknown';
}

function addShieldMesh(playerId: string): void {
  const player = gameState.players[playerId];
  if (!player) return;

  // Remove existing shield mesh
  removeShieldMesh(playerId);

  const geometry = new THREE.BoxGeometry(600, 200, 20);
  const material = new THREE.MeshBasicMaterial({
    color: 0x2196f3,
    transparent: true,
    opacity: 0.4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(player.getMesh().position.x, player.getMesh().position.y + 50, player.getMesh().position.z);
  scene.add(mesh);
  shieldMeshes[playerId] = mesh;
}

function removeShieldMesh(playerId: string): void {
  if (shieldMeshes[playerId]) {
    scene.remove(shieldMeshes[playerId]);
    delete shieldMeshes[playerId];
  }
}

function setupEvents(): void {
  // Event for receiving information about zombies.
  socket.on('zombie', (zombie: any, playerId: string) => {
    gameConsole.log('Zombie added for ' + playerId);

    const weaponCode = zombie.weaponCode || gameState.players[playerId]?.getWeaponCode() || 1;
    const zombieModel = getZombieModelFromCode(weaponCode);

    const fox = createFoxFromModel(zombie.direction, zombie.position, zombieModel, zombie.name, weaponCode);

    scene.add(fox.getMesh());
    gameState.zombies[zombie.id] = fox;

    if (audio) audio.play('fire');
  });

  // Event for receiving player information from the server.
  socket.on('player', (player: any) => {
    gameState.myId = player.id;
    gameConsole.info('I am: ' + player.name);

    const p = new Player(player.id, player.name, player.position, player.direction, models!.getPlayer(player.direction));
    setWeapon(p, Constants.FOX);

    gameState.players[player.id] = p;

    camera.position.z = player.position.z;

    if (player.direction === -1) {
      camera.rotation.y = Math.PI;
    }

    camController = new CamController(camera, socket, player.direction);

    // Setup mobile weapon buttons
    if (hud) {
      hud.createMobileWeaponButtons((code: number) => {
        if (camController) {
          camController.selectWeaponByCode(code);
        }
      });
    }

    // Send ready signal
    socket.emit('ready');
  });

  // Event for receiving opponent information from the server.
  socket.on('opponent', (player: any) => {
    gameConsole.info('The opponent has joined the game: ' + player.name);

    const p = new Player(player.id, player.name, player.position, player.direction, models!.getPlayer(player.direction));
    setWeapon(p, player.weaponCode);

    gameState.players[player.id] = p;

    if (player.id !== gameState.myId) {
      scene.add(p.getMesh());
    }

    // Send ready if both are in
    socket.emit('ready');
  });

  // Event for receiving spectator information from the server.
  socket.on('spectator', (_player: any) => {
    gameConsole.info('A spectator has joined...');
  });

  socket.on('move.start', (keyCode: number, playerId: string) => {
    gameConsole.log('Player move start');
    if (gameState.players[playerId]) {
      gameState.players[playerId].toggleMovement(keyCode, true);
    }
  });

  socket.on('move.end', (keyCode: number, playerId: string) => {
    gameConsole.log('Player move end');
    if (gameState.players[playerId]) {
      gameState.players[playerId].toggleMovement(keyCode, false);
    }
  });

  socket.on('state', (state: any) => {
    for (const key in state.zombies) {
      const serverZombie = state.zombies[key];
      const clientZombie = gameState.zombies[key];
      if (!serverZombie || !clientZombie) {
        continue;
      }
      clientZombie.setPosition(serverZombie.position);
    }

    // Remove client zombies that don't exist on server
    for (const key in gameState.zombies) {
      if (!state.zombies[key]) {
        removeZombie(key);
      }
    }

    const opponentId = getOpponentId();

    for (const key in state.players) {
      const serverPlayer = state.players[key];
      const clientPlayer = gameState.players[key];
      if (!serverPlayer || !clientPlayer) {
        continue;
      }
      clientPlayer.setPosition(serverPlayer.position);
      clientPlayer.setScore(serverPlayer.score);

      if (clientPlayer.id === gameState.myId) {
        Score.update(serverPlayer.score);
      }
    }

    // Update HUD
    if (hud && gameState.myId) {
      const myPlayer = state.players[gameState.myId];
      const oppPlayer = opponentId ? state.players[opponentId] : null;

      if (myPlayer) {
        hud.updateScore(myPlayer.score, oppPlayer?.score || 0);
        hud.updateHP(myPlayer.hp, oppPlayer?.hp || Constants.MAX_HP);
      }

      if (state.round) {
        hud.updateRound(state.round, state.roundWins, gameState.myId, opponentId || undefined);
      }
    }
  });

  socket.on('zombie.collision', (zombieId1: string, zombieId2: string) => {
    const zombie1 = gameState.zombies[zombieId1];
    const zombie2 = gameState.zombies[zombieId2];
    if (!zombie1 || !zombie2) return;

    gameConsole.info('Collision between ' + zombie1.name + ' and ' + zombie2.name);

    const wc = zombie1.weaponCode || zombie2.weaponCode || 0;
    gameState.explosions.push(new Explosion(scene, zombie1.getMesh().position, wc));

    if (audio) audio.play('collision');
    if (killFeed) killFeed.add(`${zombie1.name} vs ${zombie2.name}`, '#ff8800');

    zombie1.health -= 1;
    if (zombie1.health <= 0) {
      removeZombie(zombieId1);
    }

    zombie2.health -= 1;
    if (zombie2.health <= 0) {
      removeZombie(zombieId2);
    }
  });

  socket.on('zombie.out-of-bounds', (zombieId: string, firedByPlayerId: string) => {
    const zombie = gameState.zombies[zombieId];
    if (!zombie) return;
    gameConsole.info(zombie.name + ' has left the building!');

    if (killFeed) {
      const scorerName = getPlayerName(firedByPlayerId);
      killFeed.add(`${scorerName} scored! (${zombie.name})`, '#44ff44');
    }

    if (audio) audio.play('score');

    // Screen shake when scored against
    if (firedByPlayerId !== gameState.myId && screenShake) {
      screenShake.trigger(15);
      if (audio) audio.play('damage');
    }

    removeZombie(zombieId);
  });

  socket.on('zombie.shielded', (zombieId: string, shieldPlayerId: string) => {
    const zombie = gameState.zombies[zombieId];
    if (zombie) {
      gameState.explosions.push(new Explosion(scene, zombie.getMesh().position, 0));
      if (killFeed) killFeed.add(`Shield blocked ${zombie.name}!`, '#2196f3');
      removeZombie(zombieId);
    }
  });

  socket.on('weapon.set', (code: number, playerId: string) => {
    const player = gameState.players[playerId];
    if (!player) return;
    gameConsole.info(player.name + ' switch to ' + code);
    setWeapon(player, code);
    if (audio) audio.play('weapon_switch');
  });

  socket.on('player.exit', (playerId: string) => {
    const player = gameState.players[playerId];
    if (!player) return;
    gameConsole.info('Player exited! ' + player.name);
    scene.remove(player.getMesh());
    delete gameState.players[playerId];
  });

  // Game lifecycle events
  socket.on('game.countdown', (seconds: number) => {
    if (hud) hud.showCountdown(seconds);
    if (audio) audio.play('countdown');
  });

  socket.on('game.start', () => {
    if (hud) hud.showGameStart();
    if (audio) audio.play('game_start');
  });

  socket.on('round.end', (data: any) => {
    if (hud) {
      const iWon = data.winner === gameState.myId;
      const winnerName = getPlayerName(data.winner);
      hud.showRoundEnd(winnerName, data.round, iWon);
    }
    if (killFeed) {
      killFeed.add(`Round ${data.round} over!`, '#ffffff');
    }
  });

  socket.on('round.reset', () => {
    // Clear all zombies from the scene for the new round
    for (const key in gameState.zombies) {
      removeZombie(key);
    }
    // Clear shield meshes
    for (const pid in shieldMeshes) {
      removeShieldMesh(pid);
    }
    gameState.shieldCooldownUntil = 0;
  });

  socket.on('match.over', (data: any) => {
    const iWon = data.winner === gameState.myId;
    const winnerName = getPlayerName(data.winner);
    const opponentId = getOpponentId() || '';

    if (hud) {
      hud.showMatchOver(winnerName, iWon, data.roundWins, data.stats, gameState.myId, opponentId);
    }
    if (audio) audio.play('game_over');
    if (killFeed) killFeed.add(iWon ? 'VICTORY!' : 'DEFEAT', iWon ? '#4caf50' : '#f44336');

    // Rematch button handler
    setTimeout(() => {
      const rematchBtn = document.getElementById('rematch-btn');
      if (rematchBtn) {
        rematchBtn.addEventListener('click', () => {
          socket.emit('rematch');
          const status = document.getElementById('rematch-status');
          if (status) status.textContent = 'Waiting for opponent...';
        });
      }
    }, 100);
  });

  socket.on('game.rematch', () => {
    if (hud) hud.hideMatchOver();
    // Clear all zombies from scene
    for (const key in gameState.zombies) {
      removeZombie(key);
    }
    gameState.shieldCooldownUntil = 0;
  });

  // Shield events
  socket.on('shield.activate', (playerId: string) => {
    addShieldMesh(playerId);
    if (playerId === gameState.myId) {
      gameState.shieldCooldownUntil = Date.now() + 15000;
    }
    if (audio) audio.play('shield');
    if (killFeed) killFeed.add(`${getPlayerName(playerId)} activated shield!`, '#2196f3');
  });

  socket.on('shield.expire', (playerId: string) => {
    removeShieldMesh(playerId);
  });

  // Combo event
  socket.on('combo', (playerId: string, count: number) => {
    if (playerId === gameState.myId && hud) {
      hud.showCombo(count);
    }
    if (audio) audio.play('combo');
    if (killFeed) killFeed.add(`${getPlayerName(playerId)} COMBO x${count}!`, '#ff0');
  });

  // Upgrade event
  socket.on('player.upgrade', (playerId: string, level: number) => {
    if (playerId === gameState.myId && hud) {
      hud.showUpgrade(level);
    }
    if (killFeed) killFeed.add(`${getPlayerName(playerId)} creatures upgraded!`, '#ff0');
  });

  // Damage event
  socket.on('player.damage', (playerId: string, newHp: number) => {
    if (playerId === gameState.myId && screenShake) {
      screenShake.trigger(8);
    }
  });

  // Ping/pong for latency
  socket.on('pong', () => {
    const latency = Date.now() - pingStart;
    if (hud) hud.updatePing(latency);
  });
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId: string, isSpectator: boolean): void {
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
    shieldCooldownUntil: 0,
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

  // Init new systems
  audio = new Audio();
  screenShake = new ScreenShake(camera);
  killFeed = new KillFeed();
  hud = new HUD(isSpectator);

  // Trigger a resize and set up a window event for resizing.
  handleResize();
  window.addEventListener('resize', handleResize);
}

/**
 * Animates everything.
 */
function animate(): void {
  if (animating) {
    const elapsed = clock.getDelta();
    updateGameState(elapsed);

    animationId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
}

/**
 * Tells the game that a player wants to join the current game.
 */
function joinPlayer(gameId: number): void {
  socket.on('join.error.full', () => {
    joinSpectator(gameId);
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
    if (animationId !== null) cancelAnimationFrame(animationId);
    init(params.renderAreaId, params.isSpectator);
    document.getElementById(params.exitButtonId)?.addEventListener('click', () => {
      exitGame(params.gameId);
    });

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

        if (params.isSpectator) {
          joinSpectator(params.gameId);
        } else {
          joinPlayer(params.gameId);
        }
      }
    };

    this.pingInterval = setInterval(() => {
      pingStart = Date.now();
      socket.emit('pingpong');
    }, 1000);

    checkReady();
  }

  stop(): void {
    animating = false;
  }
}

(window as any).ZombieHugs = new ZombieHugs();
