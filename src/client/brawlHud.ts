import { escapeHtml, safeColor } from './lobbyModel';
import { StandingRow, leaderIds, ranks, timerView, koText, telegraphText, secondsUntil, num, swatchHtml } from './brawlModel';

const CSS = `
.brawl-ui { position: fixed; inset: 0; z-index: 9991; pointer-events: none; font-family: monospace; display: none; }
body.brawl-hud .brawl-ui { display: block; }
body.brawl-hud #opponent-hud, body.brawl-hud .hud-hp-mini, body.brawl-over #opponent-hud, body.brawl-over .hud-hp-mini, body.brawl-over #kill-feed, body.brawl-ko-on #kill-feed { display: none !important; }

.brawl-timer { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); padding: 4px 16px; border-radius: 6px;
  background: rgba(0,0,0,0.65); color: #fff; font-size: 26px; font-weight: bold; letter-spacing: 1px; border: 2px solid #555; white-space: nowrap; }
.brawl-timer.urgent { color: #fff; background: rgba(190,20,20,0.85); border-color: #ff6666; animation: brawl-pulse 0.7s infinite; }
.brawl-timer.sudden { background: rgba(190,20,20,0.9); border-color: #fff; font-size: 18px; }
@keyframes brawl-pulse { 0%,100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.05); } }

.brawl-notes { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 4px;
  max-width: min(420px, calc(100% - 340px)); }
.brawl-note { padding: 4px 12px; border-radius: 5px; font-size: 14px; font-weight: bold; text-align: center; background: rgba(0,0,0,0.7); border: 2px solid #ffd700; color: #ffd700; }
.brawl-note.sudden { border-color: #ff4444; color: #fff; background: rgba(160,10,10,0.85); }
.brawl-note.tele { animation: brawl-fade 0.6s infinite alternate; }
@keyframes brawl-fade { from { opacity: 1; } to { opacity: 0.55; } }

.brawl-standings { position: fixed; top: 10px; right: 64px; width: 230px; background: rgba(0,0,0,0.65); border-radius: 6px; padding: 4px; box-sizing: border-box; }
.brawl-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px; min-height: 24px; border-radius: 4px; color: #fff; font-size: 14px; border: 2px solid transparent; }
.brawl-row.me { background: rgba(255,204,0,0.2); border-color: #ffcc00; }
.brawl-row .rk { flex: none; width: 14px; color: #aaa; text-align: right; font-size: 12px; }
.brawl-swatch { flex: none; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 2px solid rgba(255,255,255,0.8); box-sizing: border-box; }
.brawl-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brawl-row .crown { flex: none; color: #ffd700; width: 16px; text-align: center; }
.brawl-row .sc { flex: none; font-weight: bold; font-size: 16px; min-width: 22px; text-align: right; }
.brawl-row.ko { opacity: 0.55; }

.brawl-hit-edge { position: fixed; inset: 0; opacity: 0; box-shadow: inset 0 0 70px 24px var(--hit, #f44); }
.brawl-hit-edge.active { animation: brawl-edge 1.1s ease-out; }
@keyframes brawl-edge { 0% { opacity: 1; } 100% { opacity: 0; } }
.brawl-hit-arrow { z-index: 9999; position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; opacity: 0; font-size: 40px; line-height: 44px; text-align: center; color: var(--hit, #f44);
  text-shadow: 0 0 3px #000, 0 0 3px #000, 0 0 8px #000; }
.brawl-hit-arrow.active { animation: brawl-edge 1.6s ease-out; }
.brawl-hit-text { position: fixed; top: 26%; left: 50%; transform: translateX(-50%); opacity: 0; font-size: 26px; font-weight: bold; color: var(--hit, #fff);
  text-shadow: 0 0 3px #000, 0 0 3px #000, 0 0 6px #000, 0 0 6px #000; white-space: nowrap; }
.brawl-hit-text.active { animation: brawl-edge 1.8s ease-out; }

.brawl-ko { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; background: rgba(60,0,0,0.5); }
.brawl-ko span { max-width: 60vw; font-size: 34px; font-weight: bold; color: #fff; text-shadow: 0 0 6px #000, 0 0 12px #f00; padding: 0 16px; }

.brawl-res { border-collapse: collapse; font-size: 15px; color: #ddd; margin: 0 0 8px; max-width: 96vw; }
.brawl-res th { color: #999; font-size: 12px; padding: 4px 6px; border-bottom: 1px solid #444; text-align: center; }
.brawl-res td { padding: 5px 6px; text-align: center; }
.brawl-res .nm { text-align: left; max-width: 28vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brawl-res .n { text-align: right; }
.brawl-res .sc { font-weight: bold; color: #fff; }
.brawl-res tr.me td { background: rgba(255,204,0,0.15); }
.brawl-res tr.win td { color: #ffd700; font-weight: bold; }
.brawl-res .brawl-swatch { vertical-align: middle; }

body.touch-hud .brawl-timer { top: 6px; font-size: 20px; padding: 2px 10px; }
body.touch-hud .brawl-timer.sudden { font-size: 14px; }
body.touch-hud .brawl-notes { left: 6px; transform: none; top: 44px; align-items: flex-start; max-width: calc(100% - 190px); }
body.touch-hud .brawl-note { font-size: 12px; padding: 3px 8px; text-align: left; }
body.touch-hud .brawl-standings { top: 38px; right: 6px; width: 168px; padding: 3px; }
body.touch-hud .brawl-row { font-size: 12px; min-height: 20px; padding: 1px 4px; gap: 4px; }
body.touch-hud .brawl-row .sc { font-size: 14px; }
body.touch-hud .brawl-row .rk { display: none; }
body.touch-hud .brawl-swatch { width: 18px; height: 18px; font-size: 11px; }
body.touch-hud .brawl-hit-text { font-size: 20px; left: 8px; transform: none; max-width: calc(100% - 194px); white-space: normal; top: 24%; }
body.touch-hud .brawl-ko span { font-size: 24px; }
body.touch-hud #kill-feed { top: 154px !important; right: 6px !important; width: 168px !important; font-size: 11px !important; }
body.touch-hud #kill-feed .kill-line { padding: 2px 5px !important; margin-bottom: 1px !important; }
body.brawl-hud:not(.touch-hud) #kill-feed { top: 152px !important; right: 64px !important; width: 230px !important; font-size: 12px !important; }
`;

/** Brawl-only HUD: standings, round clock, hit indicator, knockout overlay, power-up telegraph note. */
export default class BrawlHud {
  private root = document.createElement('div');
  private timer = document.createElement('div');
  private notes = document.createElement('div');
  private suddenNote = document.createElement('div');
  private teleNote = document.createElement('div');
  private standings = document.createElement('div');
  private hitEdge = document.createElement('div');
  private hitArrow = document.createElement('div');
  private hitText = document.createElement('div');
  private ko = document.createElement('div');
  private koSpan = document.createElement('span');

  private remaining = 0;
  private remainingAt = 0;
  private sudden = false;
  private tied: string[] = [];
  private rows: StandingRow[] = [];
  private myId = '';
  private koBy: string | null = null;
  private koUntil = 0;
  private teleAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private rowsKey = '';
  private active = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'brawl-ui';
    this.timer.className = 'brawl-timer';
    this.timer.setAttribute('role', 'timer');
    this.notes.className = 'brawl-notes';
    this.suddenNote.className = 'brawl-note sudden';
    this.teleNote.className = 'brawl-note tele';
    this.suddenNote.style.display = 'none';
    this.teleNote.style.display = 'none';
    this.notes.append(this.suddenNote, this.teleNote);
    this.standings.className = 'brawl-standings';
    this.standings.setAttribute('aria-label', 'Standings');
    this.hitEdge.className = 'brawl-hit-edge';
    this.hitArrow.className = 'brawl-hit-arrow';
    this.hitArrow.textContent = '▲';
    this.hitText.className = 'brawl-hit-text';
    this.ko.className = 'brawl-ko';
    this.ko.appendChild(this.koSpan);
    this.root.append(this.hitEdge, this.timer, this.notes, this.standings, this.hitArrow, this.hitText, this.ko);
    document.body.appendChild(this.root);
  }

  /** Shows the brawl HUD (and hides the duel score panel through the body class). */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    document.body.classList.toggle('brawl-hud', on);
    if (on && !this.ticker) this.ticker = setInterval(() => this.tick(), 200);
    if (!on) {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = null;
      this.reset();
    }
  }

  isActive(): boolean { return this.active; }

  /** Brawl results are up: the live panels and the feed go away and the duel score panel must not come back. */
  showResults(): void {
    this.setActive(false);
    document.body.classList.add('brawl-over');
  }

  /** Clears transient state (round restart, rematch, back to lobby). */
  reset(): void {
    document.body.classList.remove('brawl-over');
    this.sudden = false;
    this.tied = [];
    this.koUntil = 0;
    this.teleAt = 0;
    this.rows = [];
    this.rowsKey = '';
    this.ko.style.display = 'none';
    document.body.classList.remove('brawl-ko-on');
    this.suddenNote.style.display = 'none';
    this.teleNote.style.display = 'none';
    this.standings.innerHTML = '';
  }

  setMyId(id: string): void { this.myId = id; }

  setStandings(rows: StandingRow[], knockedOut: Set<string> = new Set()): void {
    const key = JSON.stringify([rows, this.myId, [...knockedOut]]);
    if (key === this.rowsKey) return;
    this.rowsKey = key;
    this.rows = rows;
    const lead = new Set(leaderIds(rows));
    const rk = ranks(rows);
    this.standings.innerHTML = rows.map((r, i) => {
      return `<div class="brawl-row${r.id === this.myId ? ' me' : ''}${knockedOut.has(r.id) ? ' ko' : ''}" data-id="${escapeHtml(r.id)}">`
        + `<span class="rk">${rk[i]}</span>`
        + swatchHtml(r.seat, r.color)
        + `<span class="nm">${escapeHtml(r.name)}</span>`
        + `<span class="crown">${lead.has(r.id) ? '★' : ''}</span>`
        + `<span class="sc">${num(r.score)}</span></div>`;
    }).join('');
  }

  /** From `state`: remaining round time and the sudden-death roster. */
  setRound(remainingMs: number, sudden: boolean, tiedNames: string[]): void {
    this.remaining = remainingMs;
    this.remainingAt = Date.now();
    this.sudden = sudden;
    this.tied = tiedNames;
    this.render();
  }

  /** The player was hit: coloured edge flash, arrow towards the attacker's edge and "Hit by <name>". */
  hit(attackerName: string, color: string, angleDeg: number): void {
    const c = safeColor(color);
    for (const el of [this.hitEdge, this.hitArrow, this.hitText]) el.style.setProperty('--hit', c);
    this.hitText.textContent = `Hit by ${attackerName}`;
    const a = (angleDeg * Math.PI) / 180;
    this.hitArrow.style.left = `${50 + Math.sin(a) * 28}%`;
    this.hitArrow.style.top = `${50 - Math.cos(a) * 14}%`;
    this.hitArrow.style.transform = `rotate(${angleDeg}deg)`;
    for (const el of [this.hitEdge, this.hitArrow, this.hitText]) {
      el.classList.remove('active');
      void el.offsetWidth;
      el.classList.add('active');
    }
  }

  knockedOut(byName: string | null, respawnAt: number): void {
    this.koBy = byName;
    // Server and client clocks may differ: never show more than the 3 s respawn time.
    this.koUntil = Date.now() + secondsUntil(respawnAt, Date.now(), 3) * 1000;
    this.render();
  }

  respawned(): void {
    this.koUntil = 0;
    this.render();
  }

  /** `spawnAt` (server epoch ms) of the pending central power-up, or 0 when none is pending. */
  telegraph(spawnAt: number): void {
    this.teleAt = spawnAt ? Date.now() + secondsUntil(spawnAt, Date.now(), 3) * 1000 : 0;
    this.render();
  }

  private tick(): void { this.render(); }

  private render(): void {
    const now = Date.now();
    const left = Math.max(0, this.remaining - (now - this.remainingAt));
    const v = timerView(left, this.sudden, this.tied);
    this.timer.textContent = v.text;
    this.timer.className = `brawl-timer${v.urgent && !v.sudden ? ' urgent' : ''}${v.sudden ? ' sudden' : ''}`;
    this.suddenNote.style.display = v.sudden ? '' : 'none';
    this.suddenNote.textContent = v.detail;

    if (this.teleAt && !this.sudden) {
      const s = Math.max(0, Math.ceil((this.teleAt - now) / 1000));
      this.teleNote.style.display = '';
      this.teleNote.textContent = telegraphText(s);
      if (now > this.teleAt + 600) this.teleAt = 0;
    } else {
      this.teleNote.style.display = 'none';
    }

    if (this.koUntil) {
      const s = Math.max(1, Math.ceil((this.koUntil - now) / 1000));
      this.ko.style.display = 'flex';
      document.body.classList.add('brawl-ko-on');
      this.koSpan.textContent = koText(this.koBy, s);
      if (now > this.koUntil + 2000) this.koUntil = 0; // respawn event lost: do not stick
    } else {
      this.ko.style.display = 'none';
      document.body.classList.remove('brawl-ko-on');
    }
  }
}
