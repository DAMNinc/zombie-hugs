import * as THREE from 'three';
import { io } from 'socket.io-client';
import Models from './models';
import Player from './player';
import Constants from './constants';
import CamController from './camController';
import Explosion from './explosion';
import Terrain from './terrain';
import Fox from './fox';
import HUD from './hud';
import Audio from './audio';
import ScreenShake from './screenshake';
import KillFeed from './killfeed';
import { disposeObject } from './dispose';
import { parseLegacyJSON } from './LegacyJSONLoader';

// Expose THREE and helpers globally for non-bundled scripts (gallery.js)
(window as any).THREE = THREE;
(window as any).parseLegacyJSON = parseLegacyJSON;

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
// Mirrors SHIELD_COOLDOWN_MS in lib/controller.ts.
const SHIELD_COOLDOWN_MS = 15000;
let killFeed: KillFeed | null = null;
let shieldMeshes: Record<string, any> = {};
let pingStart: number = 0;
const socket = io();

// New feature state
let hazardMeshes: any[] = [];
let powerUpMeshes: Record<string, any> = {};
let wallMeshes: Record<string, any> = {};

function updateGameState(elapsed: number): void {
  for (const key in gameState.players) {
    gameState.players[key].update(elapsed);
  }

  for (const key in gameState.zombies) {
    gameState.zombies[key].update(elapsed);
  }

  // Drop finished explosions: remove from the scene and free their GPU buffers.
  gameState.explosions = gameState.explosions.filter((explosion: Explosion) => {
    if (explosion.update(elapsed)) return true;
    explosion.dispose();
    return false;
  });

  // Take last frame's shake offset off the camera before the controller moves it; re-apply after.
  if (screenShake) screenShake.clear();

  if (camController != null) {
    camController.update(elapsed);

    // Update charge bar and camera mode indicator
    if (hud && !camController.isSpectatorMode()) {
      hud.updateCharge(camController.getChargePct());
      hud.updateCameraMode(camController.isThirdPerson());
      hud.updateWeaponBar(camController.weapon, (c) => camController!.getCooldownPct(c));

      // Show/hide own player mesh based on camera mode
      const myPlayer = gameState.players[gameState.myId];
      if (myPlayer) {
        myPlayer.getMesh().visible = camController.isThirdPerson();
      }
    }
  }

  if (screenShake) screenShake.update(elapsed);

  // Update shield cooldown display
  if (hud && camController && !camController.isSpectatorMode()) {
    const now = Date.now();
    const cooldownEnd = gameState.shieldCooldownUntil || 0;
    const shieldReady = now >= cooldownEnd;
    const shieldPct = shieldReady ? 1 : 1 - ((cooldownEnd - now) / SHIELD_COOLDOWN_MS);
    hud.updateShieldCooldown(shieldReady, shieldPct);
    hud.updateMobileBar(camController.weapon, (c) => camController!.getCooldownPct(c), shieldReady, shieldPct);
  }

  // Pulse hazards
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
  for (const group of hazardMeshes) {
    const mat = group.userData?.fillMat;
    if (mat) mat.opacity = 0.25 + 0.25 * pulse;
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
  disposeObject(zombie.getMesh());
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
  // Unknown weapon codes fall back to the fox model.
  return zombieModel || models!.getZombie();
}

function createFoxFromModel(direction: number, position: any, model: any, name?: string, weaponCode?: number, health?: number, speed?: number): Fox {
  const fox = new Fox(direction, model, name, weaponCode, health, speed);

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
  const zombieModel = getZombieModelFromCode(code);

  const startPosition = {
    x: player.getMesh().position.x,
    y: player.getMesh().position.y,
    z: player.getMesh().position.z,
  };
  startPosition.z += player.getDirection() * -1 * 100;
  startPosition.y += 50;
  startPosition.x += player.getDirection() * -1 * 25;

  // Build the new mesh first so a failure never leaves the player without a weapon.
  const fox = createFoxFromModel(player.getDirection() * -1, startPosition, zombieModel);
  fox.setSpeed(0);
  const s = 0.25 * (zombieModel.scale || 1);
  fox.getMesh().scale.set(s, s, s);

  const currentWeaponMesh = player.getCurrentWeapon();
  if (currentWeaponMesh) {
    scene.remove(currentWeaponMesh.getMesh());
    disposeObject(currentWeaponMesh.getMesh());
  }
  scene.add(fox.getMesh());

  player.setWeapon(code, fox);
}

const OWN_COLOR = 0x4caf50;
const OPP_COLOR = 0xf44336;
let ringGeometry: THREE.RingGeometry | null = null;
const ringMaterials: Record<string, THREE.MeshBasicMaterial> = {};

// Shared by all creatures: marked so disposeObject skips them.
function getRingGeometry(): THREE.RingGeometry {
  if (!ringGeometry) {
    ringGeometry = new THREE.RingGeometry(55, 80, 32);
    ringGeometry.userData.shared = true;
  }
  return ringGeometry;
}

function getRingMaterial(mine: boolean): THREE.MeshBasicMaterial {
  const key = mine ? 'mine' : 'opp';
  if (!ringMaterials[key]) {
    const m = new THREE.MeshBasicMaterial({
      color: mine ? OWN_COLOR : OPP_COLOR,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    m.userData.shared = true;
    ringMaterials[key] = m;
  }
  return ringMaterials[key];
}

function addZombie(zombie: any, playerId: string | undefined, playSound: boolean): void {
  if (gameState.zombies[zombie.id]) return;
  const weaponCode = zombie.weaponCode || (playerId && gameState.players[playerId]?.getWeaponCode()) || 1;
  const zombieModel = getZombieModelFromCode(weaponCode);

  const fox = createFoxFromModel(zombie.direction, zombie.position, zombieModel, zombie.name, weaponCode, zombie.health, zombie.speed);
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

  // Owner tint: a ring under the creature, green for mine and red for the opponent's.
  // The state payload has no owner, so fall back to the direction (creatures move against their owner's side).
  let ownerId = playerId;
  if (!ownerId) {
    for (const pid in gameState.players) {
      if (gameState.players[pid].direction === -zombie.direction) ownerId = pid;
    }
  }
  if (ownerId) {
    const mesh = fox.getMesh();
    const ring = new THREE.Mesh(getRingGeometry(), getRingMaterial(ownerId === gameState.myId));
    ring.name = 'owner-ring';
    // Undo the creature's scale so the ring has the same world size for every type.
    const k = 1 / (mesh.scale.x || 1);
    ring.scale.set(k, k, k);
    ring.position.y = 44 * k; // mesh sits 40 below the creature position; this puts the ring just above ground
    ring.rotation.x = -Math.PI / 2;
    mesh.add(ring);
  }

  scene.add(fox.getMesh());
  gameState.zombies[zombie.id] = fox;

  if (playSound && audio) {
    if (chargeRatio > 0.3) {
      audio.play('charged_fire');
    } else {
      audio.play('fire');
    }
  }
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
    disposeObject(shieldMeshes[playerId]);
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
    disposeObject(powerUpMeshes[id]);
    delete powerUpMeshes[id];
  }
}

const HAZARD_COLORS: Record<string, number> = {
  damage: 0xff2222,
  slow: 0x2288ff,
  wind: 0xaaffff,
};
const HAZARD_LABELS: Record<string, string> = { damage: 'DAMAGE', slow: 'SLOW', wind: 'WIND' };
const HAZARD_HEIGHT = 70;
let hazardKillAnnounced = false;

function makeHazardLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 34);
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(text, 128, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(160, 40, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function removeHazardMeshes(): void {
  for (const mesh of hazardMeshes) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  hazardMeshes = [];
}

function renderHazards(hazards: any[]): void {
  removeHazardMeshes();
  hazardKillAnnounced = false; // 'hazards' is re-sent for every round

  for (const h of hazards) {
    const color = HAZARD_COLORS[h.type] || 0xffffff;
    const group = new THREE.Group();
    group.position.set(h.position.x, 0, h.position.z);

    // Floor fill (pulses)
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(h.width, h.depth), fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 1;
    group.add(fill);

    // Edges of the volume, readable from first person
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(h.width, HAZARD_HEIGHT, h.depth)),
      new THREE.LineBasicMaterial({ color }),
    );
    edges.position.y = HAZARD_HEIGHT / 2;
    group.add(edges);

    // Faint translucent walls so the zone reads as a volume
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(h.width, HAZARD_HEIGHT, h.depth),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    walls.position.y = HAZARD_HEIGHT / 2;
    group.add(walls);

    const label = makeHazardLabel(HAZARD_LABELS[h.type] || String(h.type).toUpperCase(), color);
    label.position.y = HAZARD_HEIGHT + 40;
    group.add(label);

    group.userData.fillMat = fillMat;
    scene.add(group);
    hazardMeshes.push(group);
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
    disposeObject(wallMeshes[id]);
    delete wallMeshes[id];
  }
}

// Everything the server resets between rounds, rematches and when the opponent leaves.
function clearRoundState(): void {
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
    hud.hideUpgrade();
    hud.hideCombo();
  }
}

function clearArenaFeatures(): void {
  for (const id in powerUpMeshes) removePowerUpMesh(id);
  for (const id in wallMeshes) removeWallMesh(id);
  removeHazardMeshes();
}

function setupEvents(): void {
  // Event for receiving information about zombies.
  socket.on('zombie', (zombie: any, playerId: string) => {
    addZombie(zombie, playerId, true);
  });

  // Event for receiving player information from the server.
  socket.on('player', (player: any) => {
    gameState.myId = player.id;

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
    camController.clearShake = () => screenShake?.clear();

    // Weapon bar (desktop), mobile weapon buttons, one-time controls hint
    if (hud) {
      hud.createWeaponBar((code: number) => {
        if (camController) camController.selectWeaponByCode(code);
      });
      hud.createMobileWeaponButtons((code: number) => {
        if (camController) {
          camController.selectWeaponByCode(code);
        }
      }, {
        shield: () => camController?.activateShield(),
        wall: () => camController?.placeWall(),
        camera: () => camController?.toggleCameraMode(),
      });
      // After the mobile bar, so the hint knows whether the touch HUD is active.
      hud.showControlsHint();
    }

    // Alone in the lobby until an opponent shows up.
    if (hud) hud.showWaiting(false);

    // Send ready signal
    socket.emit('ready');
  });

  // Event for receiving opponent information from the server.
  socket.on('opponent', (player: any) => {

    const p = new Player(player.id, player.name, player.position, player.direction, models!.getPlayer(player.direction));
    setWeapon(p, player.weaponCode);

    gameState.players[player.id] = p;

    if (player.id !== gameState.myId) {
      scene.add(p.getMesh());
      if (hud) hud.hideWaiting();
    }

    socket.emit('ready');
  });

  socket.on('move.start', (keyCode: number, playerId: string) => {
    if (gameState.players[playerId]) {
      gameState.players[playerId].toggleMovement(keyCode, true);
    }
  });

  socket.on('move.end', (keyCode: number, playerId: string) => {
    if (gameState.players[playerId]) {
      gameState.players[playerId].toggleMovement(keyCode, false);
    }
  });

  socket.on('state', (state: any) => {
    for (const key in state.zombies) {
      const serverZombie = state.zombies[key];
      if (!serverZombie) continue;
      const clientZombie = gameState.zombies[key];
      if (!clientZombie) {
        // Exists on the server but not locally (missed spawn): create it.
        addZombie(serverZombie, undefined, false);
        continue;
      }
      clientZombie.setPosition(serverZombie.position);
      // Server is authoritative for health
      if (typeof serverZombie.health === 'number') clientZombie.health = serverZombie.health;
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
      const scoreGain = serverPlayer.score - clientPlayer.score;
      if (hud && scoreGain > 0) {
        hud.floatScore(scoreGain, clientPlayer.id === gameState.myId);
      }
      clientPlayer.setScore(serverPlayer.score);

      if (clientPlayer.id === gameState.myId) {
        if (camController) {
          camController.rapidFire = !!serverPlayer.activePowerUps?.includes('rapid_fire');
        }
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
        hud.updateScore(myPlayer.score, oppPlayer?.score ?? 0);
        hud.updateHP(myPlayer.hp, oppPlayer?.hp ?? Constants.MAX_HP);
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


    const wc = zombie1.weaponCode || zombie2.weaponCode || 0;
    gameState.explosions.push(new Explosion(scene, zombie1.getMesh().position, wc));

    if (audio) audio.play('collision');
    if (killFeed) killFeed.add(`${zombie1.name} vs ${zombie2.name}`, '#ff8800');

    // Creatures are not removed here: the collision event does not say who died.
    // The server's next `state` (which omits dead creatures) removes them.
    zombie1.health -= 1;
    zombie2.health -= 1;
  });

  socket.on('zombie.out-of-bounds', (zombieId: string, firedByPlayerId: string) => {
    const zombie = gameState.zombies[zombieId];
    if (!zombie) return;

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
    setWeapon(player, code);
    if (audio) audio.play('weapon_switch');
  });

  socket.on('player.exit', (playerId: string) => {
    const player = gameState.players[playerId];
    if (!player) return;
    scene.remove(player.getMesh());
    delete gameState.players[playerId];
    // The opponent (not me) left: wait for a replacement.
    if (playerId !== gameState.myId && gameState.myId && hud) hud.showWaiting(true);
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
    clearRoundState();
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
    clearRoundState();
  });

  // The opponent left mid-game: the server reset to the lobby, so clear the leftover round state.
  socket.on('game.reset', () => {
    if (hud) hud.hideMatchOver();
    clearRoundState();
  });

  // Shield events
  socket.on('shield.activate', (playerId: string) => {
    addShieldMesh(playerId);
    if (playerId === gameState.myId) {
      gameState.shieldCooldownUntil = Date.now() + SHIELD_COOLDOWN_MS;
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
    if (playerId === gameState.myId) {
      if (screenShake) screenShake.trigger(8);
      if (hud) hud.flashDamage();
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
      if (killFeed && !hazardKillAnnounced) {
        hazardKillAnnounced = true;
        killFeed.add(`A damage zone took ${zombie.name}!`, '#ff4444');
      }
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

  // Sky gradient background
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 1;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d')!;
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, '#1a3a5c');    // deep blue top
  skyGrad.addColorStop(0.3, '#4a90d9');  // mid blue
  skyGrad.addColorStop(0.6, '#87CEEB');  // light blue
  skyGrad.addColorStop(0.85, '#b8dced'); // pale horizon
  skyGrad.addColorStop(1, '#d4e8d0');    // greenish haze at bottom
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 1, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  const skyGeo = new THREE.SphereGeometry(4500, 32, 15);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);

  camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

  // Lighting: warm sun + cool fill
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 2);
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

  // Arena boundary markers — corner posts
  const postGeo = new THREE.CylinderGeometry(5, 5, 80, 8);
  const postMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const arenaHalfX = 500;
  const arenaHalfZ = 1500;
  const postY = -10;
  const corners = [
    [-arenaHalfX, postY, -arenaHalfZ],
    [arenaHalfX, postY, -arenaHalfZ],
    [-arenaHalfX, postY, arenaHalfZ],
    [arenaHalfX, postY, arenaHalfZ],
  ];
  for (const [px, py, pz] of corners) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, py, pz);
    scene.add(post);
  }

  // Arena side lines (thin white boxes along the edges)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  // Side lines (X edges)
  for (const xSide of [-arenaHalfX, arenaHalfX]) {
    const lineGeo = new THREE.BoxGeometry(4, 2, arenaHalfZ * 2);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(xSide, -48, 0);
    scene.add(line);
  }
  // End lines (Z edges)
  for (const zSide of [-arenaHalfZ, arenaHalfZ]) {
    const lineGeo = new THREE.BoxGeometry(arenaHalfX * 2, 2, 4);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, -48, zSide);
    scene.add(line);
  }
  // Center line
  const centerLineGeo = new THREE.BoxGeometry(arenaHalfX * 2, 2, 3);
  const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.4 });
  const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
  centerLine.position.set(0, -48, 0);
  scene.add(centerLine);

  const explosion = new Explosion(scene, { x: 0, y: 0, z: 0 });
  gameState.explosions.push(explosion);

  renderer = new THREE.WebGLRenderer({ alpha: false });
  renderer.setClearColor(0x87CEEB);
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

  socket.on('join.error.notfound', () => {
    window.location.href = '/';
  });

  socket.emit('join.player', { gameId: gameId });
}

/**
 * Tells the game that a player wants to join as spectator.
 */
function joinSpectator(gameId: number): void {
  socket.on('join.error.notfound', () => {
    window.location.href = '/';
  });

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
        setTimeout(checkReady, 1000);
      } else {
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
