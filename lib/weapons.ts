/** Weapon tables keyed by weapon code (shared by the game rules and the bot). */
export function healthFromCode(code: number): number {
  switch (code) {
    case 1: return 1;
    case 2: return 2;
    case 3: return 1;
    case 4: return 3;
    case 5: return 1;
    default: return 1;
  }
}

export function speedFromCode(code: number): number {
  switch (code) {
    case 5: return 200;
    default: return 300;
  }
}

export function fireDelayFromCode(code: number): number {
  switch (code) {
    case 1: return 1000;
    case 2: return 1500;
    case 3: return 500;
    case 4: return 2000;
    case 5: return 3000;
    default: return 1000;
  }
}
