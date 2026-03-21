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

// New feature state
let hazardMeshes: any[] = [];
let powerUpMeshes: Record<string, any> = {};
let wallMeshes: Record<string, any> = {};
let currentReplay: any[] | null = null;

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

    // Update charge bar and camera mode indicator
    if (hud && !camController.isSpectatorMode()) {
      hud.updateCharge(camController.getChargePct());
      hud.updateCameraMode(camController.isThirdPerson());

      // Show/hide own player mesh based on camera mode
      const myPlayer = gameState.players[gameState.myId];
      if (myPlayer) {
        myPlayer.getMesh().visible = camController.isThirdPerson();
      }
    }
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

  // Rotate power-up meshes
  for (const puId in powerUpMeshes) {
    if (powerUpMeshes[puId]) {
      powerUpMeshes[puId].rotation.y += elapsed * 2;
      powerUpMeshes[puId].position.y = 20 + Math.sin(Date.now() / 300) * 10;
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
    case Constants.ZOMBIE:
      zombieModel = models!.getZombieModel();
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
  const s = 0.25 * (zombieModel.scale || 1);
  fox.getMesh().scale.set(s, s, s);
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

// === NEW FEATURE VISUAL HELPERS ===

const POWERUP_COLORS: Record<string, number> = {
  rapid_fire: 0xff6600,
  speed_boost: 0x00ff88,
  heal: 0xff0066,
  double_points: 0xffff00,
};

function addPowerUpMesh(powerUp: any): void {
  const color = POWERUP_COLORS[powerUp.type] || 0xffffff;
  const geometry = new THREE.BoxGeometry(40, 40, 40);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(powerUp.position.x, 20, powerUp.position.z);
  scene.add(mesh);
  powerUpMeshes[powerUp.id] = mesh;
}

function removePowerUpMesh(id: string): void {
  if (powerUpMeshes[id]) {
    scene.remove(powerUpMeshes[id]);
    delete powerUpMeshes[id];
  }
}

const HAZARD_COLORS: Record<string, number> = {
  damage: 0xff0000,
  slow: 0x0066ff,
  wind: 0x00ff66,
};

function renderHazards(hazards: any[]): void {
  // Clear old hazard meshes
  for (const mesh of hazardMeshes) {
    scene.remove(mesh);
  }
  hazardMeshes = [];

  for (const h of hazards) {
    const color = HAZARD_COLORS[h.type] || 0xffffff;
    const geometry = new THREE.PlaneGeometry(h.width, h.depth);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(h.position.x, 1, h.position.z);
    scene.add(mesh);
    hazardMeshes.push(mesh);
  }
}

function addWallMesh(wall: any): void {
  const geometry = new THREE.BoxGeometry(wall.width, 100, 20);
  const color = wall.ownerId === 'spectator' ? 0x9933ff : 0xaa8833;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(wall.position.x, 50, wall.position.z);
  scene.add(mesh);
  wallMeshes[wall.id] = mesh;
}

function removeWallMesh(id: string): void {
  if (wallMeshes[id]) {
    scene.remove(wallMeshes[id]);
    delete wallMeshes[id];
  }
}

function clearArenaFeatures(): void {
  for (const id in powerUpMeshes) removePowerUpMesh(id);
  for (const id in wallMeshes) removeWallMesh(id);
  for (const mesh of hazardMeshes) scene.remove(mesh);
  hazardMeshes = [];
}

// === REPLAY SYSTEM ===

function playReplay(replay: any[]): void {
  if (!replay || replay.length === 0) return;
  if (hud) hud.showReplayControls(replay, () => {});

  let index = 0;
  const startTime = Date.now();
  const baseTime = replay[0].time;

  const tick = () => {
    const elapsed = Date.now() - startTime;
    while (index < replay.length && replay[index].time - baseTime <= elapsed) {
      const event = replay[index];
      if (killFeed) {
        killFeed.add(`[REPLAY] ${event.type}`, '#2196f3');
      }
      index++;
    }
    if (index < replay.length) {
      requestAnimationFrame(tick);
    } else {
      if (hud) hud.hideReplayControls();
      if (killFeed) killFeed.add('Replay complete', '#2196f3');
    }
  };
  tick();
}

function setupEvents(): void {
  // Event for receiving information about zombies.
  socket.on('zombie', (zombie: any, playerId: string) => {
    gameConsole.log('Zombie added for ' + playerId);

    const weaponCode = zombie.weaponCode || gameState.players[playerId]?.getWeaponCode() || 1;
    const zombieModel = getZombieModelFromCode(weaponCode);

    const fox = createFoxFromModel(zombie.direction, zombie.position, zombieModel, zombie.name, weaponCode);
    if (zombieModel.scale) {
      const s = zombieModel.scale;
      fox.getMesh().scale.set(s, s, s);
    }

    // Scale up based on charge ratio (0 = normal, 1 = up to 2x size)
    const chargeRatio = zombie.chargeRatio || 0;
    if (chargeRatio > 0.1) {
      const chargeScale = 1 + chargeRatio; // 1.0 to 2.0x
      const mesh = fox.getMesh();
      mesh.scale.set(
        mesh.scale.x * chargeScale,
        mesh.scale.y * chargeScale,
        mesh.scale.z * chargeScale,
      );
    }

    scene.add(fox.getMesh());
    gameState.zombies[zombie.id] = fox;

    if (audio) {
      if (chargeRatio > 0.3) {
        audio.play('charged_fire');
      } else {
        audio.play('fire');
      }
    }
  });

  // Event for receiving player information from the server.
  socket.on('player', (player: any) => {
    gameState.myId = player.id;
    gameConsole.info('I am: ' + player.name);

    const p = new Player(player.id, player.name, player.position, player.direction, models!.getPlayer(player.direction));
    setWeapon(p, Constants.FOX);

    gameState.players[player.id] = p;

    // Add own mesh to scene but hide it (visible in 3rd person)
    scene.add(p.getMesh());
    p.getMesh().visible = false;

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
      // Sync speed (can change from kill buffs, hazards, sudden death)
      if (serverZombie.speed && clientZombie.speed !== serverZombie.speed) {
        clientZombie.setSpeed(serverZombie.speed);
      }
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

        // Update active power-up display
        if (hud && serverPlayer.activePowerUps && serverPlayer.activePowerUps.length > 0) {
          hud.showPowerUp(serverPlayer.activePowerUps[0]);
        } else if (hud) {
          hud.hidePowerUp();
        }
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

      // Sudden death indicator
      if (state.suddenDeath) {
        hud.showSuddenDeath();
      }
    }

    // Sync walls from state
    if (state.walls) {
      // Remove walls no longer in state
      for (const wId in wallMeshes) {
        if (!state.walls[wId]) removeWallMesh(wId);
      }
      // Add walls not yet rendered
      for (const wId in state.walls) {
        if (!wallMeshes[wId]) addWallMesh(state.walls[wId]);
      }
    }

    // Sync power-ups from state
    if (state.powerUps) {
      for (const puId in powerUpMeshes) {
        if (!state.powerUps[puId]) removePowerUpMesh(puId);
      }
      for (const puId in state.powerUps) {
        if (!powerUpMeshes[puId]) addPowerUpMesh(state.powerUps[puId]);
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

  socket.on('zombie.shielded', (zombieId: string, _shieldPlayerId: string) => {
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
    for (const key in gameState.zombies) {
      removeZombie(key);
    }
    for (const pid in shieldMeshes) {
      removeShieldMesh(pid);
    }
    clearArenaFeatures();
    gameState.shieldCooldownUntil = 0;
    if (hud) {
      hud.hideSuddenDeath();
      hud.hidePowerUp();
    }
  });

  socket.on('match.over', (data: any) => {
    const iWon = data.winner === gameState.myId;
    const winnerName = getPlayerName(data.winner);
    const opponentId = getOpponentId() || '';

    if (hud) {
      hud.showMatchOver(winnerName, iWon, data.roundWins, data.stats, gameState.myId, opponentId, data.elo, data.leaderboard);
    }
    if (audio) audio.play('game_over');
    if (killFeed) killFeed.add(iWon ? 'VICTORY!' : 'DEFEAT', iWon ? '#4caf50' : '#f44336');

    // Store replay for playback
    currentReplay = data.replay || null;

    // Rematch + Replay button handlers
    setTimeout(() => {
      const rematchBtn = document.getElementById('rematch-btn');
      if (rematchBtn) {
        rematchBtn.addEventListener('click', () => {
          socket.emit('rematch');
          const status = document.getElementById('rematch-status');
          if (status) status.textContent = 'Waiting for opponent...';
        });
      }

      const replayBtn = document.getElementById('replay-btn');
      if (replayBtn && currentReplay) {
        replayBtn.addEventListener('click', () => {
          if (currentReplay) playReplay(currentReplay);
        });
      }
    }, 100);
  });

  socket.on('game.rematch', () => {
    if (hud) hud.hideMatchOver();
    for (const key in gameState.zombies) {
      removeZombie(key);
    }
    clearArenaFeatures();
    gameState.shieldCooldownUntil = 0;
    if (hud) {
      hud.hideSuddenDeath();
      hud.hidePowerUp();
    }
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
  socket.on('player.damage', (playerId: string, _newHp: number) => {
    if (playerId === gameState.myId && screenShake) {
      screenShake.trigger(8);
    }
  });

  // Ping/pong for latency
  socket.on('pong', () => {
    const latency = Date.now() - pingStart;
    if (hud) hud.updatePing(latency);
  });

  // === NEW FEATURE EVENTS ===

  // Power-up events
  socket.on('powerup.spawn', (powerUp: any) => {
    addPowerUpMesh(powerUp);
  });

  socket.on('powerup.expire', (puId: string) => {
    removePowerUpMesh(puId);
  });

  socket.on('powerup.collect', (puId: string, playerId: string, type: string) => {
    removePowerUpMesh(puId);
    if (audio) audio.play('powerup');
    const name = getPlayerName(playerId);
    const labels: Record<string, string> = {
      rapid_fire: 'Rapid Fire',
      speed_boost: 'Speed Boost',
      heal: 'Heal',
      double_points: '2X Points',
    };
    if (killFeed) killFeed.add(`${name} got ${labels[type] || type}!`, '#ff0');
    if (playerId === gameState.myId && hud) {
      hud.showPowerUp(type);
    }
  });

  // Heal event
  socket.on('player.heal', (playerId: string, _newHp: number) => {
    if (killFeed) killFeed.add(`${getPlayerName(playerId)} healed!`, '#ff0066');
  });

  // Hazard events
  socket.on('hazards', (hazards: any[]) => {
    renderHazards(hazards);
  });

  socket.on('zombie.hazard', (zombieId: string, _hazardId: string) => {
    const zombie = gameState.zombies[zombieId];
    if (zombie) {
      gameState.explosions.push(new Explosion(scene, zombie.getMesh().position, 0));
      if (killFeed) killFeed.add(`${zombie.name} destroyed by hazard!`, '#ff4444');
      removeZombie(zombieId);
    }
  });

  // Wall events
  socket.on('wall.place', (wall: any) => {
    addWallMesh(wall);
    if (audio) audio.play('wall');
    if (killFeed) {
      const owner = wall.ownerId === 'spectator' ? 'Spectator' : getPlayerName(wall.ownerId);
      killFeed.add(`${owner} placed a wall!`, '#aa8833');
    }
  });

  socket.on('wall.expire', (wallId: string) => {
    removeWallMesh(wallId);
  });

  socket.on('zombie.walled', (zombieId: string, _wallId: string) => {
    const zombie = gameState.zombies[zombieId];
    if (zombie) {
      gameState.explosions.push(new Explosion(scene, zombie.getMesh().position, 2));
      if (killFeed) killFeed.add(`${zombie.name} blocked by wall!`, '#aa8833');
      removeZombie(zombieId);
    }
  });

  // Sudden death
  socket.on('sudden.death', () => {
    if (hud) hud.showSuddenDeath();
    if (audio) audio.play('sudden_death');
    if (killFeed) killFeed.add('SUDDEN DEATH! All creatures buffed!', '#ff0000');
    if (screenShake) screenShake.trigger(20);
  });

  // Synergy events
  socket.on('synergy', (playerId: string, type: string) => {
    if (audio) audio.play('synergy');
    const names: Record<string, string> = {
      air_strike: 'Air Strike',
      stampede: 'Stampede',
      juggernaut: 'Juggernaut',
      twin_strike: 'Twin Strike',
    };
    if (killFeed) killFeed.add(`${getPlayerName(playerId)} triggered ${names[type] || type}!`, '#0ff');
    if (playerId === gameState.myId && hud) {
      hud.showSynergy(type);
    }
  });

  // Creature kill buff
  socket.on('zombie.killbuff', (zombieId: string) => {
    // Visual feedback — brief glow effect on the surviving creature
    const zombie = gameState.zombies[zombieId];
    if (zombie) {
      const mesh = zombie.getMesh();
      const originalScale = mesh.scale.x;
      mesh.scale.set(originalScale * 1.3, originalScale * 1.3, originalScale * 1.3);
      setTimeout(() => {
        mesh.scale.set(originalScale, originalScale, originalScale);
      }, 300);
    }
  });

  // Spectator events
  socket.on('spectator.event', (eventType: string, spectatorName: string) => {
    const labels: Record<string, string> = {
      speed_burst: 'triggered Speed Burst!',
      spawn_obstacle: 'spawned an obstacle!',
      heal_all: 'healed all players!',
    };
    if (killFeed) killFeed.add(`Spectator ${spectatorName} ${labels[eventType] || eventType}`, '#9933ff');
    if (screenShake) screenShake.trigger(5);
  });

  // ELO
  socket.on('elo', (elo: number) => {
    if (hud) hud.updateElo(elo);
  });
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId: string, isSpectator: boolean): void {
  models = new Models();

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 10);
  hemiLight.color.setHSL(0.6, 1, 0.6);
  hemiLight.groundColor.setHSL(0.095, 1, 0.75);
  hemiLight.position.set(0, 500, 0);
  scene.add(hemiLight);

  clock = new THREE.Clock(true);

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

  renderer = new THREE.WebGLRenderer({ alpha: true });
  const renderArea = document.getElementById(renderAreaId);
  if (renderArea) {
    if (renderArea.hasChildNodes()) {
      renderArea.removeChild(renderArea.childNodes[0]);
    }
    renderArea.appendChild(renderer.domElement);
  }

  audio = new Audio();
  screenShake = new ScreenShake(camera);
  killFeed = new KillFeed();
  hud = new HUD(isSpectator);

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

  // Set up spectator vote buttons
  if (hud) {
    const panel = hud.getSpectatorPanel();
    panel.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.dataset.voteType) {
        socket.emit('spectator.vote', target.dataset.voteType);
      }
    });
  }
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
