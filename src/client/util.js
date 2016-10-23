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

}

module.exports = Util;