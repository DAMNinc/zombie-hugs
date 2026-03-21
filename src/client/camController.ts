import Constants from './constants';
import Util from './util';

let camera: any = null;
let socket: any = null;
let spectatorMode = false;
let lastShot = 0;

// 3rd person camera settings
const THIRD_PERSON_HEIGHT = 200;
const THIRD_PERSON_BACK = 400;

export default class CamController {
  direction: number;
  weapon: number;
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;

  // Charged shot state
  private chargeStart: number = 0;
  private charging: boolean = false;
  onChargeUpdate: ((pct: number) => void) | null = null;

  // Camera mode
  private thirdPerson: boolean = false;
  private firstPersonZ: number = 0;

  constructor(cam: any, sock: any, direction: number) {
    camera = cam;
    socket = sock;

    spectatorMode = !sock;

    this.direction = direction;
    this.weapon = Constants.FOX;
    this.left = false;
    this.right = false;
    this.forward = false;
    this.backward = false;
    this.firstPersonZ = camera.position.z;

    const self = this;

    const startMovement = (code: number) => {
      if (self.toggleMovement(code, true) && socket) {
        socket.emit('move.start', code);
      }
    };

    const endMovement = (code: number) => {
      if (self.toggleMovement(code, false) && socket) {
        socket.emit('move.end', code);
      }
    };

    const selectWeapon = (keyCode: number) => {
      const code = Util.getWeaponCode(keyCode);
      if (code && socket && self.weapon !== code) {
        socket.emit('weapon.set', code);
        self.weapon = code;
      }
    };

    const keyDownEvent = (keyEvent: KeyboardEvent) => {
      startMovement(keyEvent.keyCode);

      if (keyEvent.keyCode === 32 && !self.charging && socket) {
        self.startCharge();
      }
    };

    const keyUpEvent = (keyEvent: KeyboardEvent) => {
      const keyCode = keyEvent.keyCode;

      if (keyCode === 32 && self.charging) {
        self.releaseCharge();
        endMovement(keyCode);
        return;
      }

      switch (keyCode) {
        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 97:
        case 98:
        case 99:
        case 100:
        case 101:
          selectWeapon(keyCode);
          break;
        case 81: // Q - Shield
          if (socket) socket.emit('shield');
          break;
        case 69: // E - Place Wall
          if (socket) socket.emit('place.wall', camera.position.x);
          break;
        case 86: // V - Toggle camera view
          if (!spectatorMode) {
            self.toggleCameraMode();
          }
          break;
        default:
          endMovement(keyCode);
      }

      endMovement(keyEvent.keyCode);
    };

    const mouseDownEvent = () => {
      if (!spectatorMode) {
        self.startCharge();
      }
    };

    const mouseUpEvent = () => {
      if (self.charging) {
        self.releaseCharge();
      } else {
        self.fire(0);
      }
    };

    const touchStart = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length > 0) {
        if (e.touches[0].clientX < window.innerWidth / 3) {
          startMovement(-1);
        } else if (e.touches[0].clientX > window.innerWidth - window.innerWidth / 3) {
          startMovement(1);
        } else {
          self.startCharge();
        }
      }
    };

    const touchEnd = (e: TouchEvent) => {
      if (self.charging) {
        self.releaseCharge();
      }
      if (e.touches.length === 0) {
        endMovement(-1);
        endMovement(1);
      }
    };

    window.addEventListener('keydown', keyDownEvent);
    window.addEventListener('keyup', keyUpEvent);
    window.addEventListener('mousedown', mouseDownEvent);
    window.addEventListener('mouseup', mouseUpEvent);
    window.addEventListener('touchstart', touchStart);
    window.addEventListener('touchend', touchEnd);
  }

  isSpectatorMode(): boolean {
    return spectatorMode;
  }

  isThirdPerson(): boolean {
    return this.thirdPerson;
  }

  selectWeaponByCode(code: number): void {
    if (socket && this.weapon !== code) {
      socket.emit('weapon.set', code);
      this.weapon = code;
    }
  }

  toggleCameraMode(): void {
    this.thirdPerson = !this.thirdPerson;
    if (!this.thirdPerson) {
      // Snap back to first person
      camera.position.z = this.firstPersonZ;
      camera.position.y = 0;
      camera.rotation.x = 0;
      if (this.direction === -1) {
        camera.rotation.y = Math.PI;
      } else {
        camera.rotation.y = 0;
      }
    }
  }

  private startCharge(): void {
    this.charging = true;
    this.chargeStart = Date.now();
  }

  private releaseCharge(): void {
    if (!this.charging) return;
    const chargeTime = Date.now() - this.chargeStart;
    this.charging = false;
    this.fire(chargeTime);
  }

  getChargePct(): number {
    if (!this.charging) return 0;
    const elapsed = Date.now() - this.chargeStart;
    return Math.min(elapsed / Constants.MAX_CHARGE_MS, 1);
  }

  toggleMovement(keyCode: number, directionBool: boolean): boolean {
    let hasChanged = false;
    switch (keyCode) {
      case -1:
      case 37:
      case 65:
        hasChanged = this.left !== directionBool;
        this.left = directionBool;
        break;
      case 38:
      case 87:
        hasChanged = this.forward !== directionBool;
        this.forward = directionBool;
        break;
      case 1:
      case 39:
      case 68:
        hasChanged = this.right !== directionBool;
        this.right = directionBool;
        break;
      case 40:
      case 83:
        hasChanged = this.backward !== directionBool;
        this.backward = directionBool;
        break;
    }

    return hasChanged;
  }

  fire(chargeTime: number): void {
    if (socket) {
      const delay = Util.getWeaponDelay(this.weapon);
      const now = new Date().getTime();
      if (now - lastShot > delay) {
        lastShot = now;
        // In 3rd person, fire from the player's actual position (firstPersonZ), not camera
        const firePos = {
          x: camera.position.x,
          y: 0,
          z: this.firstPersonZ,
        };
        socket.emit('fire', firePos, this.weapon, chargeTime);
      }
    }
  }

  update(elapsed: number): void {
    const tr = 100.0;
    let curPosX = camera.position.x;

    // Spectators have full movement
    if (spectatorMode) {
      const ftr = 5.0;
      const rot = 0.025;
      let curPosZ = camera.position.z;
      let curRot = camera.rotation.y;

      if (this.forward) {
        curPosX -= Math.sin(-curRot) * -ftr;
        curPosZ -= Math.cos(-curRot) * ftr;
      } else if (this.backward) {
        curPosX -= Math.sin(curRot) * -ftr;
        curPosZ += Math.cos(curRot) * ftr;
      }

      if (this.left) {
        curRot += rot;
      } else if (this.right) {
        curRot -= rot;
      }

      camera.position.x = curPosX;
      camera.position.z = curPosZ;
      camera.rotation.y = curRot;
      return;
    } else {
      // Reload bar
      const delay = Util.getWeaponDelay(this.weapon);
      const now = new Date().getTime();

      const reloader = document.getElementById('reload-bar');
      if (reloader) {
        if (now - lastShot <= delay) {
          reloader.style.width = ((now - lastShot) / delay) * 100 + '%';
        } else {
          reloader.style.width = '100%';
        }
      }
    }

    // Player lateral movement
    if (this.left) {
      curPosX -= tr * elapsed * this.direction;
    } else if (this.right) {
      curPosX += tr * elapsed * this.direction;
    }
    camera.position.x = curPosX;

    // 3rd person camera positioning
    if (this.thirdPerson) {
      // Camera behind and above the player, looking down at the arena
      camera.position.z = this.firstPersonZ + THIRD_PERSON_BACK * this.direction;
      camera.position.y = THIRD_PERSON_HEIGHT;
      if (this.direction === -1) {
        // Rotated 180 on Y, so X tilt must be positive to look down
        camera.rotation.set(0.35, Math.PI, 0);
      } else {
        camera.rotation.set(-0.35, 0, 0);
      }
    }
  }
}
