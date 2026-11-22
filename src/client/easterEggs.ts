import Audio from './audio';

// Hidden, cosmetic, client-local easter eggs. See docs/EASTER_EGGS.md.
// This module only OBSERVES keyboard input: it never calls preventDefault or
// stopPropagation, so camController keeps receiving every key.

const BUFFER_SIZE = 16;
const SEQUENCE_GAP_MS = 2000;
const MAX_EGG_MS = 9000;

export interface EggContext {
  audio: Audio | null;
  // Live creatures (gameState.zombies); read on demand, never cached.
  getCreatures: () => Record<string, any>;
}

export interface Egg {
  id: string;
  cooldownMs: number; // must be >= 10000
  durationMs: number; // when cleanup runs; must be < 10000
  // `keys` holds normalized key names, oldest first (letters lower-cased,
  // arrows as 'ArrowUp' etc.).
  match(keys: string[]): boolean;
  // Starts the effect; returns a cleanup that must remove every DOM node and
  // timer. The cleanup always runs, after durationMs (capped at MAX_EGG_MS).
  run(ctx: EggContext): () => void;
}

function endsWith(keys: string[], sequence: string[]): boolean {
  if (keys.length < sequence.length) return false;
  const offset = keys.length - sequence.length;
  for (let i = 0; i < sequence.length; i++) {
    if (keys[offset + i] !== sequence[i]) return false;
  }
  return true;
}

// --- Egg: "brains" -------------------------------------------------------

function runBrains(ctx: EggContext): () => void {
  if (ctx.audio) ctx.audio.play('groan');

  const tint = document.createElement('div');
  tint.setAttribute('aria-hidden', 'true');
  tint.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: radial-gradient(ellipse at center, rgba(80, 200, 60, 0.25) 0%, rgba(40, 140, 30, 0.55) 100%);
    pointer-events: none; z-index: 9980; opacity: 0;
    transition: opacity 0.5s ease-in-out;
  `;
  document.body.appendChild(tint);

  const timers: number[] = [];
  // Force a layout so the transition runs from opacity 0.
  void tint.offsetWidth;
  tint.style.opacity = '1';
  timers.push(window.setTimeout(() => { tint.style.opacity = '0'; }, 2000));

  return () => {
    for (const t of timers) clearTimeout(t);
    tint.remove();
  };
}

const brainsEgg: Egg = {
  id: 'brains',
  cooldownMs: 10000,
  durationMs: 2600,
  match: (keys) => endsWith(keys, ['b', 'r', 'a', 'i', 'n', 's']),
  run: runBrains,
};

// --- Egg: Konami "disco" -------------------------------------------------

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

interface SavedMaterial {
  material: any;
  vertexColors: boolean;
  colorHex: number;
}

function runDisco(ctx: EggContext): () => void {
  if (ctx.audio) ctx.audio.play('fanfare');

  // Per-creature materials we changed, keyed by material so a creature that is
  // removed (or re-seen) never causes errors or double-saving.
  const saved = new Map<any, SavedMaterial>();
  let rafId = 0;
  let stopped = false;
  const startedAt = performance.now();

  const tick = (): void => {
    if (stopped) return;
    const t = (performance.now() - startedAt) / 1000;
    let creatures: Record<string, any> = {};
    try { creatures = ctx.getCreatures() || {}; } catch { /* ignore */ }
    let i = 0;
    for (const key in creatures) {
      const mat = creatures[key]?.foxObj?.mesh?.material;
      if (!mat || !mat.color || Array.isArray(mat)) continue;
      if (!saved.has(mat)) {
        saved.set(mat, { material: mat, vertexColors: mat.vertexColors, colorHex: mat.color.getHex() });
        mat.vertexColors = false; // plain material colour so the hue is visible
        mat.needsUpdate = true;
      }
      mat.color.setHSL((t * 0.8 + i * 0.13) % 1, 1, 0.55);
      i++;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    saved.forEach((s) => {
      s.material.vertexColors = s.vertexColors;
      s.material.color.setHex(s.colorHex);
      s.material.needsUpdate = true;
    });
    saved.clear();
  };
}

const konamiEgg: Egg = {
  id: 'konami',
  cooldownMs: 10000,
  durationMs: 7000,
  match: (keys) => endsWith(keys, KONAMI),
  run: runDisco,
};

// --- Registry: add an egg by adding one entry here -----------------------
const EGGS: Egg[] = [
  brainsEgg,
  konamiEgg,
];

export default class EasterEggs {
  private audio: Audio | null;
  private getCreatures: () => Record<string, any>;
  private active = false;
  private buffer: string[] = [];
  private lastKeyAt = 0;
  private lastRunAt: Record<string, number> = {};
  private running = false;
  private cleanup: (() => void) | null = null;
  private cleanupTimer: number | null = null;

  constructor(audio: Audio | null, getCreatures: () => Record<string, any> = () => ({})) {
    this.audio = audio;
    this.getCreatures = getCreatures;
    window.addEventListener('keydown', this.onKeyDown, { passive: true });
  }

  // Eggs only fire while the game is in its active phase.
  setPhase(active: boolean): void {
    if (active === this.active) return; // called often (every server state tick)
    this.active = active;
    if (!active) {
      this.buffer = [];
      this.finish();
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.finish();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.isBlocked()) return;

    const now = Date.now();
    if (now - this.lastKeyAt > SEQUENCE_GAP_MS) this.buffer = [];
    this.lastKeyAt = now;

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    this.buffer.push(key);
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();

    if (this.running) return;
    for (const egg of EGGS) {
      if (!egg.match(this.buffer)) continue;
      const last = this.lastRunAt[egg.id];
      if (last !== undefined && now - last < egg.cooldownMs) continue;
      this.trigger(egg, now);
      break;
    }
  };

  private isBlocked(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (el) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    }
    return !!document.querySelector('.modal.in, .modal.show');
  }

  private trigger(egg: Egg, now: number): void {
    this.lastRunAt[egg.id] = now;
    this.buffer = [];
    this.running = true;
    try {
      this.cleanup = egg.run({ audio: this.audio, getCreatures: this.getCreatures });
    } catch {
      this.cleanup = null;
      this.running = false;
      return;
    }
    this.cleanupTimer = window.setTimeout(() => this.finish(), Math.min(egg.durationMs, MAX_EGG_MS));
  }

  private finish(): void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.cleanup) {
      try { this.cleanup(); } finally { this.cleanup = null; }
    }
    this.running = false;
  }
}
