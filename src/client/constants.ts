export default class Constants {
  static get FOX(): number { return 1; }
  static get HORSE(): number { return 2; }
  static get FLAMINGO(): number { return 3; }
  static get ZOMBIE(): number { return 4; }
  static get HORDE(): number { return 5; }
  static get MAX_HP(): number { return 10; }
  static get MAX_CHARGE_MS(): number { return 3000; }
  static get WALL_COST(): number { return 3; }
}

export function healthFromCode(code: number): number {
  switch (code) {
    case Constants.FOX:
      return 1;
    case Constants.HORSE:
      return 2;
    case Constants.FLAMINGO:
      return 1;
    case Constants.ZOMBIE:
      return 3;
    case Constants.HORDE:
      return 1;
    default:
      return 1;
  }
}
