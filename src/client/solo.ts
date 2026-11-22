import { SoloArena } from './soloArena';
import { CHARGE_MS, DEFENCES, STATION_HP, SoloState, WAVES, type DefenceKind, type Lane } from './soloState';

function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

const host = element('arena');
const arena = new SoloArena(host);
const camera = element<HTMLButtonElement>('camera');
const start = element<HTMLButtonElement>('start');
const confirm = element<HTMLButtonElement>('confirm');
const charge = element<HTMLProgressElement>('charge');
const tools = element('build-tools');
const outcome = element('outcome');
const result = element('result');
const help = element('help');
const wave = element('wave');
const health = element('health');
const scrap = element('scrap');
const cleared = element('cleared');
const chain = element('chain');
const placement = element('placement');

let state = new SoloState();
let building = true;
let selected = -1;
let kind: DefenceKind = 'launcher';
let holding: { pointer: number; lane: Lane; started: number } | undefined;
let showingOutcome = false;

const shop = Object.entries(DEFENCES).map(([key, info]) => {
  const button = document.createElement('button');
  button.textContent = `${info.name} · ${info.cost}`;
  button.addEventListener('click', () => {
    kind = key as DefenceKind;
    updateHud();
  });
  element('shop').append(button);
  return { key, button };
});

function cancelCharge() {
  if (holding && arena.canvas.hasPointerCapture(holding.pointer)) {
    arena.canvas.releasePointerCapture(holding.pointer);
  }
  holding = undefined;
}

function setView(build: boolean) {
  cancelCharge();
  building = build;
  updateHud();
}

camera.addEventListener('click', () => setView(!building));
window.addEventListener('keydown', event => {
  if (event.code === 'KeyV' && !event.repeat && !showingOutcome) setView(!building);
});
window.addEventListener('blur', cancelCharge);

start.addEventListener('click', () => {
  if (state.startWave()) setView(false);
});
confirm.addEventListener('click', () => {
  if (building) state.build(selected, kind);
  updateHud();
});
element('retry').addEventListener('click', () => {
  state = new SoloState();
  selected = -1;
  kind = 'launcher';
  arena.resetEffects();
  setView(true);
  start.focus();
});

// Pointer Events keep mouse and touch on the same gesture path. Only the canvas can begin a shot.
arena.canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || showingOutcome) return;
  if (building) {
    selected = arena.padAt(arena.padPoint(event));
    updateHud();
    return;
  }
  if (state.phase !== 'wave' || state.cooldown > 0) return;
  const lane = arena.combatLane(event, state);
  if (lane === undefined) return;
  holding = { pointer: event.pointerId, lane, started: performance.now() };
  arena.canvas.setPointerCapture(event.pointerId);
});

arena.canvas.addEventListener('pointerup', event => {
  if (event.pointerId !== holding?.pointer) return;
  const bounds = arena.canvas.getBoundingClientRect();
  const onArena = event.clientX >= bounds.left && event.clientX <= bounds.right &&
    event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  if (!building && onArena) state.fire(holding.lane, performance.now() - holding.started);
  cancelCharge();
});
for (const type of ['pointercancel', 'lostpointercapture'] as const) {
  arena.canvas.addEventListener(type, event => {
    if (event.pointerId === holding?.pointer) cancelCharge();
  });
}

function write(target: HTMLElement, text: string) {
  if (target.textContent !== text) target.textContent = text;
}

function updateHud() {
  const terminal = state.phase === 'won' || state.phase === 'lost';
  write(health, `${state.health} / ${STATION_HP}`);
  write(scrap, String(state.scrap));
  write(cleared, `${state.cleared} / ${WAVES.length}`);
  const next = WAVES[state.cleared];
  write(wave, terminal ? (state.phase === 'won' ? 'Arena secured' : 'Station overrun')
    : `${state.phase === 'planning' ? 'Next · ' : ''}Wave ${state.cleared + 1} · ${next.name}`);
  write(chain, state.chain ? `Chain reaction ×${state.chain}` : '');
  write(camera, building ? 'Combat view' : 'Build view');
  camera.disabled = terminal;
  start.hidden = state.phase !== 'planning';
  start.disabled = state.phase !== 'planning';
  charge.hidden = building || terminal || state.phase !== 'wave';
  charge.value = holding ? (performance.now() - holding.started) / CHARGE_MS : 0;
  tools.hidden = !building || terminal;
  help.hidden = terminal;
  write(help, building
    ? 'Select a defence and tap a pad to preview. A Sticky Patch upstream of a Barricade keeps the pack close.'
    : 'Click or tap either lane to fire. Hold until the meter fills to chain through clustered creatures.');
  if (building && !terminal) {
    const preview = state.placement(selected, kind);
    const info = DEFENCES[kind];
    for (const item of shop) {
      const pressed = String(item.key === kind);
      if (item.button.getAttribute('aria-pressed') !== pressed) item.button.setAttribute('aria-pressed', pressed);
    }
    write(placement, selected < 0 ? 'Choose a pad to see the range and cost.'
      : preview.reason || (preview.upgrade ? `${info.perk} · ${preview.cost} scrap` : `${info.name} · ${preview.cost} scrap`));
    write(confirm, preview.upgrade ? 'Upgrade' : 'Build');
    confirm.disabled = !!preview.reason;
  }
  outcome.hidden = !terminal;
  if (terminal && !showingOutcome) {
    cancelCharge();
    write(result, state.phase === 'won' ? 'Hug Station saved!' : 'Hug Station fell');
    result.focus();
  }
  showingOutcome = terminal;
}

let previous = performance.now();
let accumulator = 0;
const step = 1 / 60;
function frame(now: number) {
  const elapsed = Math.min(0.15, (now - previous) / 1000);
  previous = now;
  accumulator += elapsed;
  while (accumulator >= step) {
    state.tick(step);
    for (const impact of state.impacts) arena.impact(impact);
    accumulator -= step;
  }
  updateHud();
  arena.render(state, building, selected, kind, elapsed);
  requestAnimationFrame(frame);
}

updateHud();
requestAnimationFrame(frame);
