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

  constructor(id: string, name: string, position: any, direction: number, playerMesh: any) {
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

  getDirection(): number {
    return this.direction;
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

  update(elapsed: number): void {
    let changeX = 0;
    const tr = 100.0;

    if (this.left) {
      changeX = -tr * elapsed * this.direction;
    } else if (this.right) {
      changeX = tr * elapsed * this.direction;
    }

    this.mesh.position.x += changeX;

    this.weapon.getMesh().position.x += changeX;
    this.weapon.update(elapsed);
  }

  setPosition(position: any): void {
    this.mesh.position.set(position.x, position.y - 40, position.z);
  }

  setScore(score: number): void {
    this.score = score;
  }
}
