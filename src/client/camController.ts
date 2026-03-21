import Constants from './constants';
import Util from './util';

let camera: any = null;
let socket: any = null;
let spectatorMode = false;
let lastShot = 0;

export default class CamController {
  direction: number;
  weapon: number;
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;

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

    const self = this;

    const startMovement = (code: number) => {
      if (self.toggleMovement(code, true) && socket) {
        console.log('Cam movement started', code);
        socket.emit('move.start', code);
      }
    };

    const endMovement = (code: number) => {
      if (self.toggleMovement(code, false) && socket) {
        console.log('Cam movement ended', code);
        socket.emit('move.end', code);
      }
    };

    const selectWeapon = (keyCode: number) => {
      const code = Util.getWeaponCode(keyCode);
      if (code && socket && self.weapon !== code) {
        console.log('Changed weapon from ' + self.weapon + ' to ' + code);
        socket.emit('weapon.set', code);
        self.weapon = code;
      }
    };

    const keyDownEvent = (keyEvent: KeyboardEvent) => {
      startMovement(keyEvent.keyCode);
    };

    const keyUpEvent = (keyEvent: KeyboardEvent) => {
      const keyCode = keyEvent.keyCode;

      switch (keyCode) {
        case 49:
        case 50:
        case 51:
        case 52: // 4 key - Horde
        case 97: // numeric keypad 1
        case 98: // numeric keypad 2
        case 99: // numeric keypad 3
        case 100: // numeric keypad 4
          selectWeapon(keyCode);
          break;
        case 81: // Q key - Shield
          if (socket) {
            socket.emit('shield');
          }
          break;
        default:
          endMovement(keyCode);
      }

      endMovement(keyEvent.keyCode);
    };

    const mouseClickEvent = () => {
      console.log('Click');
      self.fire();
    };

    const touchStart = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length > 0) {
        if (e.touches[0].clientX < window.innerWidth / 3) {
          startMovement(-1);
        } else if (e.touches[0].clientX > window.innerWidth - window.innerWidth / 3) {
          startMovement(1);
        } else {
          console.log('Touch "click"');
          self.fire();
        }
      }
    };

    const touchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        endMovement(-1);
        endMovement(1);
      }
    };

    window.addEventListener('keydown', keyDownEvent);
    window.addEventListener('keyup', keyUpEvent);
    window.addEventListener('click', mouseClickEvent);
    window.addEventListener('touchstart', touchStart);
    window.addEventListener('touchend', touchEnd);
  }

  isSpectatorMode(): boolean {
    return spectatorMode;
  }

  selectWeaponByCode(code: number): void {
    if (socket && this.weapon !== code) {
      console.log('Changed weapon from ' + this.weapon + ' to ' + code);
      socket.emit('weapon.set', code);
      this.weapon = code;
    }
  }

  toggleMovement(keyCode: number, directionBool: boolean): boolean {
    let hasChanged = false;
    switch (keyCode) {
      case -1: // Custom keycode for touch
      case 37: // Leftarrow
      case 65: // a key
        hasChanged = this.left !== directionBool;
        this.left = directionBool;
        break;
      case 38: // Up arrow
      case 87: // w key
        hasChanged = this.forward !== directionBool;
        this.forward = directionBool;
        break;
      case 1: // Custom keycode for touch
      case 39: // Right arrow
      case 68: // d key
        hasChanged = this.right !== directionBool;
        this.right = directionBool;
        break;
      case 40: // Down arrow
      case 83: // s key
        hasChanged = this.backward !== directionBool;
        this.backward = directionBool;
        break;
    }

    return hasChanged;
  }

  fire(): void {
    if (socket) {
      const delay = Util.getWeaponDelay(this.weapon);
      const now = new Date().getTime();
      if (now - lastShot > delay) {
        lastShot = now;
        socket.emit('fire', camera.position, this.weapon);
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
      // only show reload-bar when playing
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

    if (this.left) {
      curPosX -= tr * elapsed * this.direction;
    } else if (this.right) {
      curPosX += tr * elapsed * this.direction;
    }
    camera.position.x = curPosX;
  }
}
