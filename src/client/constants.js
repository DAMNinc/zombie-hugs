'use strict';

export default class Constants {

  static get FOX() { return 1; }
  static get HORSE() { return 2; }
  static get FLAMINGO() { return 3; }
}

export function healthFromCode(code) {
  switch(code) {
    case Constants.FOX:
      return 1;
    case Constants.HORSE:
      return 2;
    case Constants.FLAMINGO:
      return 1;
    default:
      return 1;
  }
}