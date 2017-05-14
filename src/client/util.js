'use strict';

class Util {

  static getWeaponCode(keyCode) {
    var code;
    switch (keyCode) {
      case 49:
      case 97: // numeric keypad 1
        code = 1;
        break;
      case 50:
      case 98: // numeric keypad 2
        code = 2;
        break;
      case 51:
      case 99: // numeric keypad 3
        code = 3;
        break;
    }
    return code;
  }

  static getWeaponDelay(weapon) {
    var delay = 0;
    switch(weapon) {
      case 1:
        delay = 1000;
        break;
      case 2:
        delay = 1500;
        break;
      case 3:
        delay = 500;
        break;
    }
    return delay;
  }

}

module.exports = Util;