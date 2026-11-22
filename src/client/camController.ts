import Constants from './constants';
import Util from './util';
import { EdgeView, edgeView } from './arena';

let camera: any = null;
let socket: any = null;
let spectatorMode = false;
let lastShot = 0;

// 3rd person camera settings
const THIRD_PERSON_HEIGHT = 200;
const THIRD_PERSON_BACK = 400;

// Ignore mouse events this long after a touch (browser-synthesised)
const SYNTH_MOUSE_MS = 500;

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

  // Mirrors the server: rapid_fire halves the fire delay (set from the state broadcast).
  rapidFire: boolean = false;
  // Clears this frame's screen-shake offset so camera.position holds the logical position.
  clearShake: (() => void) | null = null;

  // Camera mode
  private thirdPerson: boolean = false;
  // Coordinate of the player's edge line on the fixed axis (z for N/S, x for W/E).
  private fixedCoord: number = 0;
  private view: EdgeView;
  /** Called for T / Tab (desktop target cycling); set by the game when brawl targeting is active. */
  onCycleTarget: (() => void) | null = null;

  constructor(cam: any, sock: any, direction: number, view?: EdgeView) {
    camera = cam;
    socket = sock;

    spectatorMode = !sock;

    this.direction = direction;
    this.weapon = Constants.FOX;
    this.left = false;
    this.right = false;
    this.forward = false;
    this.backward = false;
    this.view = view || edgeView(direction === -1 ? 'N' : 'S');
    // YXZ keeps yaw and pitch independent for every edge.
    camera.rotation.order = 'YXZ';
    this.fixedCoord = this.view.fixedAxis === 'z' ? camera.position.z : camera.position.x;

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
      if (keyEvent.keyCode === 9 && self.onCycleTarget) {
        keyEvent.preventDefault(); // Tab cycles the target instead of moving focus
        return;
      }
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
        case 84: // T - next target (brawl)
        case 9: // Tab
          if (!spectatorMode && self.onCycleTarget) self.onCycleTarget();
          break;
        case 81: // Q - Shield
          self.activateShield();
          break;
        case 69: // E - Place Wall
          self.placeWall();
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

    // Clicks/taps on HUD elements, buttons and modals must not fire or move.
    const isUiTarget = (target: EventTarget | null): boolean => {
      const el = target as Element | null;
      return !!(el && typeof el.closest === 'function' && el.closest('button, a, input, select, textarea, .modal, [data-ui]'));
    };

    // After a touch the browser synthesises mouse events; ignore them.
    let lastTouchTime = -Infinity;
    const isSynthesizedMouse = () => Date.now() - lastTouchTime < SYNTH_MOUSE_MS;

    const mouseDownEvent = (e: MouseEvent) => {
      if (isSynthesizedMouse() || isUiTarget(e.target)) return;
      if (!spectatorMode) {
        self.startCharge();
      }
    };

    const mouseUpEvent = (e: MouseEvent) => {
      if (isSynthesizedMouse()) return;
      // Only release a charge that began on the game (mousedown ignores UI targets).
      if (self.charging) {
        self.releaseCharge();
      }
    };

    const touchStart = (e: TouchEvent) => {
      lastTouchTime = Date.now();
      if (isUiTarget(e.target)) return;
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
      lastTouchTime = Date.now();
      if (self.charging) {
        self.releaseCharge();
      }
      if (e.touches.length === 0) {
        endMovement(-1);
        endMovement(1);
      }
    };

    this.removeListeners = () => {
      window.removeEventListener('keydown', keyDownEvent);
      window.removeEventListener('keyup', keyUpEvent);
      window.removeEventListener('mousedown', mouseDownEvent);
      window.removeEventListener('mouseup', mouseUpEvent);
      window.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchend', touchEnd);
    };
    window.addEventListener('keydown', keyDownEvent);
    window.addEventListener('keyup', keyUpEvent);
    window.addEventListener('mousedown', mouseDownEvent);
    window.addEventListener('mouseup', mouseUpEvent);
    window.addEventListener('touchstart', touchStart, { passive: false });
    window.addEventListener('touchend', touchEnd, { passive: false });
  }

  private removeListeners: () => void = () => {};

  /** Detach all window input listeners (call before replacing this controller). */
  dispose(): void {
    this.removeListeners();
    this.removeListeners = () => {};
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

  activateShield(): void {
    if (socket) socket.emit('shield');
  }

  placeWall(): void {
    if (socket) {
      this.clearShake?.();
      socket.emit('place.wall', this.lateralPos());
    }
  }

  toggleCameraMode(): void {
    this.clearShake?.();
    this.thirdPerson = !this.thirdPerson;
    if (!this.thirdPerson) {
      // Snap back to first person
      camera.position[this.view.fixedAxis] = this.fixedCoord;
      camera.position.y = 0;
      camera.rotation.set(0, this.view.yaw, 0);
    }
  }

  private lateralPos(): number {
    return camera.position[this.view.lateral];
  }

  /** Move the player to another edge/arena: camera on the edge line at `lateral`, looking at the centre. */
  setView(view: EdgeView, lateral: number): void {
    this.clearShake?.();
    this.view = view;
    this.direction = view.direction;
    this.fixedCoord = view.fixed;
    this.thirdPerson = false;
    camera.position[view.fixedAxis] = view.fixed;
    camera.position[view.lateral] = lateral;
    camera.position.y = 0;
    camera.rotation.set(0, view.yaw, 0);
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
      const delay = Util.getWeaponDelay(this.weapon) * (this.rapidFire ? 0.5 : 1);
      const now = new Date().getTime();
      if (now - lastShot > delay) {
        lastShot = now;
        this.clearShake?.();
        // In 3rd person, fire from the player's actual position (the edge line), not the camera
        const firePos = this.view.fixedAxis === 'z'
          ? { x: camera.position.x, y: 0, z: this.fixedCoord }
          : { x: this.fixedCoord, y: 0, z: camera.position.z };
        socket.emit('fire', firePos, this.weapon, chargeTime);
      }
    }
  }

  /** 0..1 progress of the fire delay for a weapon since the last shot (1 = ready). */
  getCooldownPct(code: number): number {
    const delay = Util.getWeaponDelay(code) * (this.rapidFire ? 0.5 : 1);
    if (delay <= 0) return 1;
    return Math.min(1, Math.max(0, (Date.now() - lastShot) / delay));
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
    }

    // Player lateral movement: left/right are relative to the player's own view
    const v = this.view;
    const axisRight = v.lateral === 'x' ? v.right.x : v.right.z;
    let lateral = camera.position[v.lateral];
    if (this.left) {
      lateral -= tr * elapsed * axisRight;
    } else if (this.right) {
      lateral += tr * elapsed * axisRight;
    }
    lateral = Math.min(v.limit, Math.max(-v.limit, lateral));
    camera.position[v.lateral] = lateral;

    // 3rd person camera positioning
    if (this.thirdPerson) {
      // Camera behind and above the player, looking down at the arena
      camera.position[v.fixedAxis] = this.fixedCoord - (v.fixedAxis === 'z' ? v.inward.z : v.inward.x) * THIRD_PERSON_BACK;
      camera.position.y = THIRD_PERSON_HEIGHT;
      camera.rotation.set(-0.35, v.yaw, 0);
    }
  }
}
