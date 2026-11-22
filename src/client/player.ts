import { Edge, EdgeView, edgeView, playerYaw } from './arena';

export default class Player {
  id: string;
  name: string;
  direction: number;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  mesh: any;
  weaponCode: number;
  weapon: any;
  score: number;

  // Room/brawl metadata (seat colour, edge, targeting), filled from player/opponent/state payloads.
  seat: number | undefined;
  color: string | undefined;
  /** Raw edge from the server ('N'|'S'|'W'|'E'); `view` may be a lane view built before the arena was known. */
  edge: Edge | undefined;
  alive: boolean = true;
  targetId: string | null = null;
  /** Last position the server reported (world). */
  lastServer: { x: number; z: number } | null = null;
  view: EdgeView;

  constructor(id: string, name: string, position: any, direction: number, playerMesh: any, view?: EdgeView) {
    this.view = view || edgeView(direction === -1 ? 'N' : 'S');
    this.id = id;
    this.name = name;
    this.direction = direction;

    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;

    this.mesh = playerMesh;

    this.weaponCode = 1;
    this.weapon = null;

    this.mesh.position.x = position.x;
    this.mesh.position.y = position.y - 40;
    this.mesh.position.z = position.z;

    this.score = 0;

    console.log('Player created');
  }

  getMesh(): any {
    return this.mesh;
  }

  toggleMovement(keyCode: number, directionBool: boolean): void {
    switch (keyCode) {
      case 37: // Leftarrow
      case 65: // a key
        this.left = directionBool;
        break;
      case 38: // Up arrow
      case 87: // w key
        this.forward = directionBool;
        break;
      case 39: // Right arrow
      case 68: // d key
        this.right = directionBool;
        break;
      case 40: // Down arrow
      case 83: // s key
        this.backward = directionBool;
        break;
    }
  }

  setWeapon(code: number, weapon: any): void {
    this.weaponCode = code;
    this.weapon = weapon;
  }

  getCurrentWeapon(): any {
    return this.weapon;
  }

  getWeaponCode(): number {
    return this.weaponCode;
  }

  // Interpolation target
  private targetX: number | null = null;
  private targetZ: number | null = null;

  update(elapsed: number): void {
    const tr = 100.0;
    const startX = this.mesh.position.x;
    const startZ = this.mesh.position.z;

    // Keys are relative to the player's own view: "right" is this.view.right in the world.
    let d = 0;
    if (this.left) d = -1;
    else if (this.right) d = 1;
    this.mesh.position.x += d * tr * elapsed * this.view.right.x;
    this.mesh.position.z += d * tr * elapsed * this.view.right.z;

    // Smooth interpolation toward server position
    const lerpFactor = Math.min(1, elapsed * 8);
    if (this.targetX !== null) {
      const diff = this.targetX - this.mesh.position.x;
      if (Math.abs(diff) < 2) {
        this.targetX = null;
      } else {
        this.mesh.position.x += diff * lerpFactor;
      }
    }
    if (this.targetZ !== null) {
      const diff = this.targetZ - this.mesh.position.z;
      if (Math.abs(diff) < 2) {
        this.targetZ = null;
      } else {
        this.mesh.position.z += diff * lerpFactor;
      }
    }

    // The held weapon model follows the player.
    const wp = this.weapon.getMesh().position;
    wp.x += this.mesh.position.x - startX;
    wp.z += this.mesh.position.z - startZ;
    this.weapon.update(elapsed);
  }

  setPosition(position: any): void {
    // Lerp X instead of snapping to reduce jitter
    this.targetX = position.x;
    this.targetZ = position.z;
    this.lastServer = { x: position.x, z: position.z };
    // Y is constant
    this.mesh.position.y = position.y - 40;
  }

  /** Re-orient for another edge/arena: model faces the centre; positions are set by the caller. */
  setView(view: EdgeView, x: number, z: number): void {
    this.view = view;
    this.direction = view.direction;
    this.mesh.rotation.y = playerYaw(view.inward);
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.targetX = null;
    this.targetZ = null;
  }

  setScore(score: number): void {
    this.score = score;
  }
}
