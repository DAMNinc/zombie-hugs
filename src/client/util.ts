import Constants from './constants';

export default class Util {
  static getWeaponCode(keyCode: number): number | undefined {
    let code: number | undefined;
    switch (keyCode) {
      case 49:
      case 97: // numeric keypad 1
        code = Constants.FOX;
        break;
      case 50:
      case 98: // numeric keypad 2
        code = Constants.HORSE;
        break;
      case 51:
      case 99: // numeric keypad 3
        code = Constants.FLAMINGO;
        break;
      case 52:
      case 100: // numeric keypad 4
        code = Constants.HORDE;
        break;
    }
    return code;
  }

  static getWeaponDelay(weapon: number): number {
    let delay = 0;
    switch (weapon) {
      case Constants.FOX:
        delay = 1000;
        break;
      case Constants.HORSE:
        delay = 1500;
        break;
      case Constants.FLAMINGO:
        delay = 500;
        break;
      case Constants.HORDE:
        delay = 3000;
        break;
    }
    return delay;
  }
}
