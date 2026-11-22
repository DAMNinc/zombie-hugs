import { escapeHtml, safeColor } from './lobbyModel';
import { readableText, targetChipText } from './arena';

export interface TargetOpponent { id: string; name: string; seat: number; color: string; alive: boolean }

const CSS = `
.target-ui { position: fixed; top: 96px; left: 0; right: 0; z-index: 20; display: none;
  flex-direction: column; align-items: center; gap: 6px; padding: 0 6px; box-sizing: border-box; pointer-events: none; font-family: sans-serif; }
.target-chip { background: rgba(0,0,0,0.65); color: #fff; padding: 4px 12px; border-radius: 14px; font-size: 14px; border: 2px solid #fff; }
.target-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; pointer-events: auto; }
.target-btn { min-height: 44px; min-width: 44px; padding: 4px 10px; border-radius: 22px; border: 3px solid transparent; background: rgba(0,0,0,0.65);
  color: #fff; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; max-width: 150px; }
.target-btn .seat { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.target-btn .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.target-btn.on { box-shadow: 0 0 0 2px #fff; background: rgba(40,40,40,0.9); }
.target-btn[disabled] { opacity: 0.4; cursor: default; }
body.touch-hud .target-ui, .target-ui.narrow { top: auto; bottom: 132px; flex-direction: column-reverse; }
@media (max-width: 600px) { .target-ui { top: auto; bottom: 132px; flex-direction: column-reverse; } .target-btn { max-width: 31vw; font-size: 13px; } }
`;

/** "Target: <name>" chip plus one tappable chip per opponent (≥44 px). */
export default class TargetUI {
  private root = document.createElement('div');
  private chip = document.createElement('div');
  private row = document.createElement('div');
  private lastKey = '';

  constructor(private onSelect: (id: string) => void) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'target-ui';
    this.root.setAttribute('data-ui', '');
    this.chip.className = 'target-chip';
    this.chip.setAttribute('role', 'status');
    this.row.className = 'target-row';
    this.row.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-id]') as HTMLButtonElement | null;
      if (b && !b.disabled) this.onSelect(b.dataset.id!);
    });
    this.root.append(this.chip, this.row);
    document.body.appendChild(this.root);
  }

  setVisible(v: boolean): void { this.root.style.display = v ? 'flex' : 'none'; }

  update(opps: TargetOpponent[], targetId: string | null, showKeyHint: boolean): void {
    const key = JSON.stringify([opps, targetId, showKeyHint]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const t = opps.find((o) => o.id === targetId);
    this.chip.textContent = targetChipText(t?.name) + (t && showKeyHint ? '  (T)' : '');
    this.chip.style.borderColor = t ? safeColor(t.color) : '#ffffff';
    this.row.innerHTML = opps.map((o) => {
      const c = safeColor(o.color);
      return `<button type="button" class="target-btn${o.id === targetId ? ' on' : ''}" data-id="${escapeHtml(o.id)}"`
        + ` style="border-color:${c}" ${o.alive ? '' : 'disabled'} aria-pressed="${o.id === targetId}" aria-label="Target ${escapeHtml(o.name)}">`
        + `<span class="seat" style="background:${c};color:${readableText(c)}">${o.seat + 1}</span><span class="nm">${escapeHtml(o.name)}</span></button>`;
    }).join('');
  }
}
