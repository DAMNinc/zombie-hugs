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
import { attackerAngle, hitLine, StandingRow } from './brawlModel';
import EasterEggs, { rareScore, RARE_SCORE_COLOR } from './easterEggs';
import Lobby from './lobby';
import PlayerTag from './playerTag';
import TargetUI from './targetUI';
import {
  playerYaw, ArenaKind, Edge, EdgeView, SEAT_EDGES, SQUARE_HALF, EDGE_TRAVEL, arenaFromState, creatureYaw, cycleTarget,
  edgePoint, headingOf, isEdge, lateralOf, opponentsInOrder, resolveEdge, seatColor, viewFor,
} from './arena';
import { seatTokenKey } from './lobbyModel';
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
let easterEggs: EasterEggs | null = null;
let shieldMeshes: Record<string, any> = {};
let pingStart: number = 0;
let lobby: Lobby | null = null;
let seatKey: string | null = null; // sessionStorage key of this tab's seat token (players only)
let spectatorGameId: number | null = null; // set when this tab joined as a plain spectator
let queued = false; // seated-player join answered with join.queued: spectating until promoted
let arena: ArenaKind = 'lane';
let laneGroup: THREE.Group | null = null;
let squareGroup: THREE.Group | null = null;
const edgeParts: Partial<Record<Edge, { line: THREE.Mesh; glow: THREE.Mesh; ticks: THREE.Mesh[] }>> = {};
const playerTags: Record<string, PlayerTag> = {};
let targetUI: TargetUI | null = null;
let matchPhase = '';
let spectatorOverview = false;
const socket = io();

function readSeatToken(): string | undefined {
  try { return (seatKey && sessionStorage.getItem(seatKey)) || undefined; } catch (_e) { return undefined; }
}
function storeSeatToken(token: string): void {
  try { if (seatKey) sessionStorage.setItem(seatKey, token); } catch (_e) { /* private mode: no reconnect token */ }
}

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

  updateBrawlVisuals();

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

function createFoxFromModel(heading: { x: number; z: number }, position: any, model: any, name?: string, weaponCode?: number, health?: number, speed?: number): Fox {
  const fox = new Fox(heading.z < 0 ? -1 : 1, model, name, weaponCode, health, speed, heading);

  fox.foxObj.mesh.position.x = position.x + model.offset.x;
  fox.foxObj.mesh.position.y = position.y - 50 + model.offset.y;
  fox.foxObj.mesh.position.z = position.z + model.offset.z;

  // Store baseX for zigzag
  fox.baseX = position.x;
  fox.baseZ = position.z;
  fox.squareArena = arena === 'square';

  // Face the heading (duel: 0 or 180 degrees, as before).
  fox.foxObj.mesh.rotation.y = creatureYaw(heading);

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
  const v = player.view;
  startPosition.z += v.inward.z * 100 - v.right.z * 25;
  startPosition.y += 50;
  startPosition.x += v.inward.x * 100 - v.right.x * 25;

  // Build the new mesh first so a failure never leaves the player without a weapon.
  const fox = createFoxFromModel(v.inward, startPosition, zombieModel);
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

function getRingMaterial(mine: boolean, seatHex?: string): THREE.MeshBasicMaterial {
  const key = seatHex || (mine ? 'mine' : 'opp');
  if (!ringMaterials[key]) {
    const m = new THREE.MeshBasicMaterial({
      color: seatHex ? new THREE.Color(seatHex) : (mine ? OWN_COLOR : OPP_COLOR),
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

  const fox = createFoxFromModel(headingOf(zombie), zombie.position, zombieModel, zombie.name, weaponCode, zombie.health, zombie.speed);
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
  let ownerId = playerId || (typeof zombie.ownerId === 'string' ? zombie.ownerId : undefined);
  if (!ownerId && arena === 'lane') {
    for (const pid in gameState.players) {
      if (gameState.players[pid].direction === -zombie.direction) ownerId = pid;
    }
  }
  if (ownerId) {
    const mesh = fox.getMesh();
    const ring = new THREE.Mesh(getRingGeometry(), getRingMaterial(
      ownerId === gameState.myId,
      arena === 'square' ? gameState.players[ownerId]?.color : undefined,
    ));
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
  if (arena === 'square') {
    const t = gameState.players[gameState.myId]?.targetId;
    if (t && gameState.players[t]) return t;
  }
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
  if (powerUp.central) {
    // The central power-up is bigger and glows: a halo and a light beam so it reads from every edge.
    mesh.userData.central = true;
    mesh.scale.setScalar(3);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 12),
      new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.BackSide }),
    );
    mesh.add(halo);
    const beam = makeBeacon(14, 420, 0.3);
    beam.position.y = 20;
    mesh.add(beam);
    removeTelegraph();
  }
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
  if (wall.axis === 'z') mesh.rotation.y = Math.PI / 2; // brawl W/E walls extend along z
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
    hud.brawl.reset();
  }
}

function clearArenaFeatures(): void {
  removeTelegraph();
  for (const id in powerUpMeshes) removePowerUpMesh(id);
  for (const id in wallMeshes) removeWallMesh(id);
  removeHazardMeshes();
}

function removePlayer(id: string): void {
  const existing = gameState.players[id];
  if (!existing) return;
  scene.remove(existing.getMesh());
  // Only the geometry is a per-player clone; the materials are shared with other players.
  existing.getMesh().geometry?.dispose();
  removeTag(id);
  delete gameState.players[id];
  updateEdgeColors();
  refreshTargetUI();
}

// === BRAWL ARENA, TAGS AND TARGETING ===

function buildSquareArena(): THREE.Group {
  const g = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(6, 6, 90, 8);
  const postMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sx * SQUARE_HALF, -5, sz * SQUARE_HALF);
      g.add(post);
    }
  }
  const len = SQUARE_HALF * 2;
  for (const edge of SEAT_EDGES) {
    const alongX = edge === 'N' || edge === 'S';
    const p = edgePoint(edge, 0);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? len : 10, 3, alongX ? 10 : len),
      new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.85 }),
    );
    line.position.set(p.x, -47, p.z);
    g.add(line);
    // Pulsing wall of light: only visible on the edge being targeted.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 140),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    glow.position.set(p.x, 20, p.z);
    if (!alongX) glow.rotation.y = Math.PI / 2;
    g.add(glow);
    const parts = { line, glow, ticks: [] as THREE.Mesh[] };
    edgeParts[edge] = parts;
    // Posts at the travel limit (±EDGE_TRAVEL) mark where players stop; the corners stay clear.
    for (const t of [-EDGE_TRAVEL, EDGE_TRAVEL]) {
      const q = edgePoint(edge, t);
      const tick = new THREE.Mesh(new THREE.BoxGeometry(14, 40, 14), new THREE.MeshBasicMaterial({ color: 0xcccccc }));
      tick.position.set(q.x, -30, q.z);
      g.add(tick);
      parts.ticks.push(tick);
    }
  }
  return g;
}

function playerForEdge(edge: Edge): any {
  for (const id in gameState.players) {
    if (gameState.players[id].view.edge === edge) return gameState.players[id];
  }
  return null;
}

function updateEdgeColors(): void {
  for (const edge of SEAT_EDGES) {
    const parts = edgeParts[edge];
    if (!parts) continue;
    const owner = arena === 'square' ? playerForEdge(edge) : null;
    const hex = owner?.color || '#cccccc';
    (parts.line.material as THREE.MeshBasicMaterial).color.set(hex);
    (parts.glow.material as THREE.MeshBasicMaterial).color.set(hex);
    for (const t of parts.ticks) (t.material as THREE.MeshBasicMaterial).color.set(hex);
  }
}

function viewOf(p: { edge?: unknown; seat?: unknown }, direction: number): EdgeView {
  return viewFor(arena, resolveEdge(p.edge, p.seat, direction));
}

function ensureTag(p: Player): void {
  if (arena !== 'square' || typeof p.seat !== 'number' || playerTags[p.id]) return;
  const tag = new PlayerTag(p.seat, p.name, p.color || seatColor(p.seat));
  scene.add(tag.group);
  playerTags[p.id] = tag;
}

function removeTag(id: string): void {
  if (!playerTags[id]) return;
  playerTags[id].dispose();
  delete playerTags[id];
}

/** Server metadata (seat, colour, edge, alive, target) from player/opponent/state payloads. */
function applyMeta(p: Player, d: any): void {
  if (typeof d.seat === 'number') p.seat = d.seat;
  if (isEdge(d.edge)) p.edge = d.edge;
  if (typeof d.color === 'string') p.color = d.color;
  else if (p.color === undefined && typeof p.seat === 'number') p.color = seatColor(p.seat);
  if (typeof d.alive === 'boolean') p.alive = d.alive;
  if (typeof d.targetId === 'string' || d.targetId === null) p.targetId = d.targetId;
  ensureTag(p);
}

/** Put a player on its edge for the current arena; the camera follows when it is the local player. */
function orient(p: Player): void {
  // From the server's raw edge/seat: p.view may have been built for the lane (W/E map to S there).
  const view = viewOf({ edge: p.edge, seat: p.seat }, p.direction);
  const last = p.lastServer;
  const onEdge = last && Math.abs(view.fixedAxis === 'z' ? last.z : last.x) > SQUARE_HALF - 100;
  const lateral = onEdge && last ? lateralOf(view, last) : 0;
  const pt = edgePoint(view.edge, lateral);
  p.setView(view, pt.x, pt.z);
  setWeapon(p, p.getWeaponCode());
  if (p.id === gameState.myId && camController && !camController.isSpectatorMode()) {
    camController.setView(view, lateral);
  }
}

function setSpectatorCamera(): void {
  if (!camController || !camController.isSpectatorMode()) return;
  if (arena === 'square') {
    camera.position.set(0, 1500, 1750);
    camera.rotation.set(-0.72, 0, 0);
    spectatorOverview = true;
  } else if (spectatorOverview) {
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    spectatorOverview = false;
  }
}

function applyArena(kind: ArenaKind): void {
  if (kind === arena) return;
  arena = kind;
  if (laneGroup) laneGroup.visible = kind === 'lane';
  if (squareGroup) squareGroup.visible = kind === 'square';
  for (const id in gameState.players) {
    const p = gameState.players[id] as Player;
    orient(p);
    if (kind === 'square') ensureTag(p);
    else removeTag(id);
  }
  updateEdgeColors();
  setSpectatorCamera();
  refreshTargetUI();
}

function myPlayer(): Player | null {
  return gameState.myId ? gameState.players[gameState.myId] || null : null;
}

function selectTarget(id: string): void {
  const me = myPlayer();
  if (!me || arena !== 'square' || id === me.targetId) return;
  socket.emit('target.set', id);
  me.targetId = id; // optimistic; the server's `target` broadcast confirms or corrects
  refreshTargetUI();
}

function cycleMyTarget(): void {
  const me = myPlayer();
  if (!me || arena !== 'square') return;
  const next = cycleTarget(Object.values(gameState.players) as Player[], me.id, me.targetId, 1);
  if (next) selectTarget(next);
}

const isTouch = (): boolean => 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;

function refreshTargetUI(): void {
  if (!targetUI) return;
  const me = myPlayer();
  const live = arena === 'square' && !!me && !(camController?.isSpectatorMode()) && matchPhase !== 'lobby' && matchPhase !== 'match_over';
  // Tab is only taken over during a live brawl; elsewhere it keeps moving keyboard focus.
  if (camController) camController.onCycleTarget = live ? cycleMyTarget : null;
  targetUI.setVisible(live);
  document.body.classList.toggle('brawl-targets', live);
  if (!live || !me) return;
  const opps = opponentsInOrder(Object.values(gameState.players) as Player[], me.id)
    .map((p) => ({ id: p.id, name: p.name, seat: p.seat ?? 0, color: p.color || '#ffffff', alive: p.alive }));
  targetUI.update(opps, me.targetId, !isTouch());
}

/** Per frame: seat tags follow the models and the current target is highlighted (model, ring, arrow, edge glow). */
function updateBrawlVisuals(): void {
  if (arena !== 'square') {
    for (const e of SEAT_EDGES) {
      const g = edgeParts[e]?.glow.material as THREE.MeshBasicMaterial | undefined;
      if (g) g.opacity = 0;
    }
    for (const id in gameState.players) if (id !== gameState.myId) gameState.players[id].getMesh().visible = true;
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
  if (telegraph) {
    telegraph.mesh.scale.set(1 + 0.35 * pulse, 1, 1 + 0.35 * pulse);
    ((telegraph.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.28 * pulse;
  }
  for (const id in powerUpMeshes) {
    const m = powerUpMeshes[id];
    if (m.userData.central) m.scale.setScalar(2.6 + 0.4 * pulse);
  }
  for (const id in gameState.players) {
    // A knocked-out player's model is hidden until `player.respawn` (the seat tag stays, dimmed).
    if (id !== gameState.myId) gameState.players[id].getMesh().visible = gameState.players[id].alive;
  }
  const me = myPlayer();
  const targetId = me && !camController?.isSpectatorMode() ? me.targetId : null;
  for (const id in gameState.players) {
    const p = gameState.players[id] as Player;
    const tag = playerTags[id];
    if (!tag) continue;
    tag.update(p.getMesh().position, id === targetId, p.alive, pulse);
    tag.group.visible = p.getMesh().visible || id !== gameState.myId;
  }
  for (const e of SEAT_EDGES) {
    const g = edgeParts[e]?.glow.material as THREE.MeshBasicMaterial | undefined;
    if (!g) continue;
    const owner = playerForEdge(e);
    g.opacity = owner && owner.id === targetId ? 0.15 + 0.3 * pulse : 0;
  }
}

/** Brawl HUD from a `state` payload: standings, round clock, sudden-death roster, knocked-out dimming. */
function updateBrawlHud(state: any): void {
  if (!hud) return;
  const live = state.mode === 'brawl' && (state.phase === 'playing' || state.phase === 'sudden_death' || state.phase === 'countdown');
  if (state.mode !== 'brawl') { hud.brawl.setActive(false); hud.brawl.reset(); }
  else if (state.phase !== 'match_over') hud.brawl.setActive(live);
  killFeed?.setMaxEntries(live ? (isTouch() ? 4 : 6) : 8);
  if (!live) return;
  hud.brawl.setMyId(gameState.myId ?? '');
  const down = new Set<string>();
  for (const id in state.players) if (state.players[id] && state.players[id].alive === false) down.add(id);
  if (Array.isArray(state.standings)) hud.brawl.setStandings(state.standings as StandingRow[], down);
  const sudden = state.phase === 'sudden_death';
  const tied: string[] = sudden && Array.isArray(state.suddenPlayerIds) ? state.suddenPlayerIds.map((id: string) => getPlayerName(id)) : [];
  hud.brawl.setRound(typeof state.roundRemainingMs === 'number' ? state.roundRemainingMs : 0, sudden, tied);
}

const TELEGRAPH_COLOR = 0xffd700;
let telegraph: { id: string; mesh: THREE.Group } | null = null;

function makeBeacon(radius: number, height: number, opacity: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24, 1, true), mat);
  col.position.y = height / 2 - 40;
  g.add(col);
  return g;
}

function showTelegraph(data: any): void {
  removeTelegraph();
  const mesh = makeBeacon(70, 420, 0.25);
  mesh.position.set(data.position?.x ?? 0, 0, data.position?.z ?? 0);
  scene.add(mesh);
  telegraph = { id: data.id, mesh };
  hud?.brawl.telegraph(typeof data.spawnAt === 'number' ? data.spawnAt : Date.now() + 3000);
}

function removeTelegraph(): void {
  if (!telegraph) return;
  scene.remove(telegraph.mesh);
  disposeObject(telegraph.mesh);
  telegraph = null;
  hud?.brawl.telegraph(0);
}

function buildPlayer(data: any, weaponCode: number): Player {
  const view = viewOf(data, data.direction);
  const p = new Player(data.id, data.name, data.position, view.direction, models!.getPlayer(view.direction, playerYaw(view.inward)), view);
  applyMeta(p, data);
  setWeapon(p, weaponCode);
  return p;
}

function setupEvents(): void {
  // Event for receiving information about zombies.
  socket.on('zombie', (zombie: any, playerId: string) => {
    addZombie(zombie, playerId, true);
  });

  // Event for receiving player information from the server.
  socket.on('player', (player: any) => {
    if (typeof player.token === 'string') storeSeatToken(player.token);

    // Promoted from the queue: switch from the spectator camera to the player flow in place.
    if (queued) {
      queued = false;
      lobby?.clearQueued();
    }

    gameState.myId = player.id;
    lobby?.setMyId(player.id);

    // The server re-sends `player` (roster changes, reconnect): treat it as an update, never a second copy.
    removePlayer(player.id);
    const p = buildPlayer(player, Constants.FOX);
    const view = p.view;
    gameState.players[player.id] = p;

    // Add own mesh to scene but hide it (visible in 3rd person)
    scene.add(p.getMesh());
    p.getMesh().visible = false;

    if (arena === 'square') {
      // Brawl: camera on the player's own edge, looking at the centre.
      camera.position[view.fixedAxis] = view.fixed;
      camera.position[view.lateral] = player.position[view.lateral];
    } else {
      camera.position.z = player.position.z;
    }
    camera.position.y = 0; // a promoted spectator leaves the overview camera
    camera.rotation.set(0, view.yaw, 0);
    spectatorOverview = false;

    camController?.dispose();
    camController = new CamController(camera, socket, view.direction, view);
    camController.clearShake = () => screenShake?.clear();
    updateEdgeColors();
    refreshTargetUI();

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

    // The lobby panel (driven by the server's `lobby` event) replaces the old waiting overlay;
    // its Ready button sends `ready`.
  });

  socket.on('lobby', (payload: any) => {
    // Anyone not on a seat is gone (e.g. the practice bot after End practice).
    const seated = new Set<string>((payload.seats || []).filter((x: any) => x).map((x: any) => x.id));
    for (const id of Object.keys(gameState.players)) {
      if (!seated.has(id)) removePlayer(id);
    }
    lobby?.update(payload);
  });

  socket.on('join.queued', (data: any) => {
    queued = true;
    if (!camController) camController = new CamController(camera, null, 0);
    setSpectatorCamera();
    hud?.hideCountdown();
    lobby?.setMyId(socket.id || '');
    lobby?.setQueued(data && typeof data.position === 'number' ? data.position : 0);
  });

  socket.on('player.disconnected', (data: any) => {
    if (data && data.id) lobby?.playerDropped(data.id, Number(data.until));
  });

  socket.on('player.reconnected', (id: string) => {
    lobby?.playerReconnected(id);
  });

  // Event for receiving opponent information from the server.
  socket.on('opponent', (player: any) => {
    if (player.id === gameState.myId) return; // own entry is managed by the `player` event
    removePlayer(player.id); // repeated opponent events are updates

    const p = buildPlayer(player, player.weaponCode);
    gameState.players[player.id] = p;

    scene.add(p.getMesh());
    updateEdgeColors();
    refreshTargetUI();
  });

  // Brawl targeting: `target (playerId, targetId)`.
  socket.on('target', (playerId: string, targetId: string | null) => {
    const p = gameState.players[playerId];
    if (!p) return;
    p.targetId = typeof targetId === 'string' ? targetId : null;
    if (playerId === gameState.myId) refreshTargetUI();
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
    // Covers spectators/reloads joining mid-round (state is broadcast every 200 ms)
    if (easterEggs) easterEggs.setPhase(state.phase === 'playing' || state.phase === 'sudden_death');
    matchPhase = state.phase || matchPhase;
    const wanted = arenaFromState(state.mode);
    if (wanted) applyArena(wanted);
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
      if (typeof serverZombie.vx === 'number' && typeof serverZombie.vz === 'number') {
        const h = headingOf(serverZombie);
        if (Math.abs(h.x - clientZombie.hx) > 0.01 || Math.abs(h.z - clientZombie.hz) > 0.01) clientZombie.setHeading(h.x, h.z);
      }
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
      applyMeta(clientPlayer, serverPlayer);
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

    updateBrawlHud(state);

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

      // Sudden death indicator (brawl shows it in the round clock)
      if (state.suddenDeath && state.mode !== 'brawl') {
        hud.showSuddenDeath();
      }
    }

    refreshTargetUI();

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
    if (killFeed && arena !== 'square') killFeed.add(`${zombie1.name} vs ${zombie2.name}`, '#ff8800');

    // Creatures are not removed here: the collision event does not say who died.
    // The server's next `state` (which omits dead creatures) removes them.
    zombie1.health -= 1;
    zombie2.health -= 1;
  });

  socket.on('zombie.out-of-bounds', (zombieId: string, firedByPlayerId: string, hitPlayerId?: string | null) => {
    const zombie = gameState.zombies[zombieId];
    if (!zombie) return;

    if (killFeed) {
      const scorerName = getPlayerName(firedByPlayerId);
      if (arena === 'square') {
        // Brawl: "Bob ⟶ Cleo" in the attacker's seat colour; creatures that leave an empty edge are not news.
        if (hitPlayerId) {
          const victim = getPlayerName(hitPlayerId);
          killFeed.add(hitLine(scorerName, victim), '#ffffff',
            { badge: gameState.players[firedByPlayerId]?.color, mergeKey: `hit:${firedByPlayerId}>${hitPlayerId}`, format: (n) => hitLine(scorerName, victim, n) });
        }
      } else {
        const special = rareScore(easterEggs, audio, scorerName, zombie.name);
        if (special) killFeed.add(special, RARE_SCORE_COLOR);
        else killFeed.add(`${scorerName} scored! (${zombie.name})`, '#44ff44');
      }
    }

    // Brawl: the score sound only when I fired or was hit; the hit itself shakes via player.damage.
    if (audio && (arena !== 'square' || firedByPlayerId === gameState.myId || hitPlayerId === gameState.myId)) audio.play('score');

    // Screen shake when scored against. Lane: any creature that is not mine is aimed at me.
    // Square: not here; a hit on me arrives as player.damage (shake, flash, attacker arrow).
    if (arena !== 'square' && firedByPlayerId !== gameState.myId && screenShake) {
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
    lobby?.playerLeft(playerId);
    const player = gameState.players[playerId];
    if (!player) return;
    if (easterEggs) easterEggs.setPhase(false);
    removePlayer(playerId);
  });

  // Game lifecycle events
  socket.on('game.countdown', (seconds: number) => {
    if (easterEggs) easterEggs.setPhase(false);
    if (hud) hud.showCountdown(seconds);
    if (audio) audio.play('countdown');
  });

  socket.on('game.start', (data: any) => {
    matchPhase = 'playing';
    if (data && data.arena && (data.arena.kind === 'square' || data.arena.kind === 'lane')) applyArena(data.arena.kind);
    refreshTargetUI();
    if (easterEggs) easterEggs.setPhase(true);
    if (hud) hud.showGameStart();
    if (audio) audio.play('game_start');
  });

  socket.on('round.end', (data: any) => {
    if (easterEggs) easterEggs.setPhase(false);
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
    if (easterEggs) easterEggs.setPhase(false);
    clearRoundState();
  });

  socket.on('match.over', (data: any) => {
    if (easterEggs) easterEggs.setPhase(false);
    const iWon = data.winner === gameState.myId;
    const winnerName = getPlayerName(data.winner);
    const opponentId = getOpponentId() || '';

    if (hud) {
      hud.showMatchOver(winnerName, iWon, data.roundWins || {}, data.stats || {}, gameState.myId, opponentId, data.elo, data.leaderboard, {
        mode: data.mode,
        winnerId: data.winner,
        standings: data.standings,
      });
    }
    if (audio) audio.play('game_over');
    removeTelegraph();
    if (data.mode === 'brawl') hud?.brawl.showResults();
    if (killFeed) killFeed.add(iWon ? 'VICTORY!' : 'DEFEAT', iWon ? '#4caf50' : '#f44336');

    // Rematch / Back to lobby button handlers
    setTimeout(() => {
      document.getElementById('lobby-return-btn')?.addEventListener('click', () => socket.emit('lobby.return'));
      const rematchBtn = document.getElementById('rematch-btn');
      if (rematchBtn) {
        rematchBtn.addEventListener('click', () => {
          socket.emit('rematch');
          const status = document.getElementById('rematch-status');
          if (status) status.textContent = data.mode === 'brawl' ? 'Waiting for the others...' : 'Waiting for opponent...';
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
    if (killFeed && arena !== 'square') killFeed.add(`${getPlayerName(playerId)} COMBO x${count}!`, '#ff0');
  });

  // Upgrade event
  socket.on('player.upgrade', (playerId: string, level: number) => {
    if (playerId === gameState.myId && hud) {
      hud.showUpgrade(level);
    }
    if (killFeed && arena !== 'square') killFeed.add(`${getPlayerName(playerId)} creatures upgraded!`, '#ff0');
  });

  // Damage event
  socket.on('player.damage', (playerId: string, _newHp: number, attackerId?: string) => {
    if (playerId === gameState.myId) {
      if (screenShake) screenShake.trigger(8);
      if (hud) hud.flashDamage();
      const attacker = attackerId ? gameState.players[attackerId] : null;
      const me = myPlayer();
      if (hud && attacker && me && arena === 'square') {
        hud.brawl.hit(attacker.name, attacker.color || '#ffffff', attackerAngle(me.view, attacker.view.edge));
      }
    }
  });

  // Brawl knockouts and respawns
  socket.on('player.ko', (data: { id: string; by: string | null; respawnAt: number }) => {
    const victim = gameState.players[data.id];
    if (!victim) return;
    victim.alive = false;
    const byName = data.by && gameState.players[data.by] ? getPlayerName(data.by) : null;
    if (killFeed) {
      const line = byName ? `${byName} \u27F6 ${victim.name}  KO!` : `${victim.name} knocked out!`;
      killFeed.add(line, '#ffffff', { strong: true, badge: data.by ? gameState.players[data.by]?.color : '#ffffff' });
    }
    if (data.id === gameState.myId) {
      hud?.brawl.knockedOut(byName, data.respawnAt);
      if (screenShake) screenShake.trigger(20);
    }
    refreshTargetUI();
  });

  socket.on('player.respawn', (playerId: string) => {
    const p = gameState.players[playerId];
    if (p) p.alive = true;
    if (playerId === gameState.myId) hud?.brawl.respawned();
    refreshTargetUI();
  });

  socket.on('powerup.telegraph', (data: any) => {
    if (arena === 'square' && data && typeof data.id === 'string') showTelegraph(data);
  });

  socket.on('standings', (rows: StandingRow[]) => {
    if (hud && Array.isArray(rows) && hud.brawl.isActive()) {
      hud.brawl.setStandings(rows, new Set(Object.values(gameState.players).filter((p: any) => !p.alive).map((p: any) => p.id)));
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
    const central = !!powerUpMeshes[puId]?.userData.central;
    removePowerUpMesh(puId);
    if (audio) audio.play('powerup');
    const name = getPlayerName(playerId);
    const labels: Record<string, string> = {
      rapid_fire: 'Rapid Fire',
      speed_boost: 'Speed Boost',
      heal: 'Heal',
      double_points: '2X Points',
    };
    if (killFeed) {
      if (central) killFeed.add(`\u2605 ${name} captured the centre: ${labels[type] || type}!`, '#ffffff', { strong: true, badge: gameState.players[playerId]?.color });
      else if (arena !== 'square') killFeed.add(`${name} got ${labels[type] || type}!`, '#ff0');
    }
    if (playerId === gameState.myId && hud) {
      hud.showPowerUp(type);
    }
  });

  // Heal event
  socket.on('player.heal', (playerId: string, _newHp: number) => {
    if (killFeed && arena !== 'square') killFeed.add(`${getPlayerName(playerId)} healed!`, '#ff0066');
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
  socket.on('sudden.death', (data?: { mode?: string; playerIds?: string[] }) => {
    const brawl = data?.mode === 'brawl';
    if (hud && !brawl) hud.showSuddenDeath();
    if (audio) audio.play('sudden_death');
    if (killFeed) {
      if (!brawl) killFeed.add('SUDDEN DEATH! All creatures buffed!', '#ff0000');
    }
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
    if (killFeed && arena !== 'square') killFeed.add(`${getPlayerName(playerId)} triggered ${names[type] || type}!`, '#0ff');
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

  laneGroup = new THREE.Group();
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
    laneGroup.add(post);
  }

  // Arena side lines (thin white boxes along the edges)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  // Side lines (X edges)
  for (const xSide of [-arenaHalfX, arenaHalfX]) {
    const lineGeo = new THREE.BoxGeometry(4, 2, arenaHalfZ * 2);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(xSide, -48, 0);
    laneGroup.add(line);
  }
  // End lines (Z edges)
  for (const zSide of [-arenaHalfZ, arenaHalfZ]) {
    const lineGeo = new THREE.BoxGeometry(arenaHalfX * 2, 2, 4);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, -48, zSide);
    laneGroup.add(line);
  }
  // Center line
  const centerLineGeo = new THREE.BoxGeometry(arenaHalfX * 2, 2, 3);
  const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.4 });
  const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
  centerLine.position.set(0, -48, 0);
  laneGroup.add(centerLine);

  scene.add(laneGroup);
  squareGroup = buildSquareArena();
  squareGroup.visible = false;
  scene.add(squareGroup);
  arena = 'lane';

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
  easterEggs = new EasterEggs(audio, () => gameState.zombies);
  hud = new HUD(isSpectator);
  targetUI = isSpectator ? null : new TargetUI((id) => selectTarget(id));

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
  socket.on('join.error.notfound', () => {
    window.location.href = '/';
  });

  seatKey = seatTokenKey(gameId);
  socket.emit('join.player', { gameId: gameId, token: readSeatToken() });
}

/**
 * Tells the game that a player wants to join as spectator.
 */
function joinSpectator(gameId: number): void {
  socket.on('join.error.notfound', () => {
    window.location.href = '/';
  });

  spectatorGameId = gameId;
  socket.emit('join.spectator', { gameId: gameId });
  camController = new CamController(camera, null, 0);
  setSpectatorCamera();

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
        lobby = params.isSpectator ? null : new Lobby({
          onReady: (ready) => socket.emit(ready ? 'ready' : 'unready'),
          onReturn: () => socket.emit('lobby.return'),
        });
        setupEvents();

        // socket.io reconnect after a drop: the server forgot this socket, so re-join
        // (players present their seat token to reclaim the seat).
        let connectedBefore = socket.connected;
        socket.on('connect', () => {
          if (connectedBefore) {
            // The server forgot this socket (and, in the lobby, freed the seat): rebuild from its replay.
            for (const id of Object.keys(gameState.players)) removePlayer(id);
            clearRoundState();
            queued = false;
            lobby?.clearQueued();
            if (spectatorGameId !== null) socket.emit('join.spectator', { gameId: spectatorGameId });
            else if (seatKey) socket.emit('join.player', { gameId: params.gameId, token: readSeatToken() });
          }
          connectedBefore = true;
        });
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
