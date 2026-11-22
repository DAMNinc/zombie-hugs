// Pure helpers for the brawl HUD (no DOM, no three.js; unit-tested in tests/client/brawlModel.test.ts).
import { EdgeView, edgePoint, isEdge, Edge, readableText } from './arena';
import { escapeHtml, safeColor } from './lobbyModel';

export interface StandingRow {
  id: string;
  name: string;
  seat: number;
  color: string;
  score: number;
  hits: number;
  kos: number;
  captures: number;
}

/** "m:ss" for a millisecond count (rounded up, never negative). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The last 10 seconds of a round are emphasised. */
export function isUrgent(ms: number): boolean {
  return ms > 0 && ms <= 10000;
}

/** Ids holding the top score (the crown); empty while nobody has scored. */
export function leaderIds(rows: Array<{ id: string; score: number }>): string[] {
  const top = rows.reduce((m, r) => Math.max(m, r.score), 0);
  return top > 0 ? rows.filter((r) => r.score === top).map((r) => r.id) : [];
}

/** Competition ranking: equal scores share a rank (1, 1, 3, 4). Rows are already sorted by the server. */
export function ranks(rows: Array<{ score: number }>): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => out.push(i > 0 && rows[i - 1].score === r.score ? out[i - 1] : i + 1));
  return out;
}

export interface TimerView { text: string; sudden: boolean; urgent: boolean; detail: string }

/** Round clock, or the sudden-death banner with the names of the tied players. */
export function timerView(remainingMs: number, sudden: boolean, tiedNames: string[]): TimerView {
  if (sudden) {
    return { text: 'SUDDEN DEATH', sudden: true, urgent: true, detail: tiedNames.length ? `SUDDEN DEATH — ${tiedNames.join(', ')}` : 'SUDDEN DEATH' };
  }
  return { text: formatClock(remainingMs), sudden: false, urgent: isUrgent(remainingMs), detail: '' };
}

/** Whole seconds until `target` (epoch ms), 0..maxSec; the full span when the clocks disagree wildly. */
export function secondsUntil(target: number, now: number, maxSec: number): number {
  const s = Math.ceil((target - now) / 1000);
  if (!Number.isFinite(s) || s > maxSec + 2) return maxSec;
  return Math.max(0, Math.min(s, maxSec));
}

export function koText(byName: string | null, seconds: number): string {
  const count = Array.from({ length: Math.max(0, seconds) }, (_v, i) => String(seconds - i)).join('…');
  return `Knocked out${byName ? ` by ${byName}` : ''} — back in ${count || '0'}`;
}

export function telegraphText(seconds: number): string {
  return seconds > 0 ? `Power-up in ${seconds}` : 'Power-up!';
}

/**
 * Where an attacker's edge lies on my screen: degrees clockwise from straight ahead
 * (0 = across the arena, 90 = my right, -90 = my left, 180 = behind).
 */
export function attackerAngle(my: EdgeView, attackerEdge: unknown): number {
  if (!isEdge(attackerEdge)) return 0;
  const a = edgePoint(attackerEdge as Edge, 0);
  const me = edgePoint(my.edge, 0);
  const dx = a.x - me.x;
  const dz = a.z - me.z;
  const fwd = dx * my.inward.x + dz * my.inward.z;
  const right = dx * my.right.x + dz * my.right.z;
  if (fwd === 0 && right === 0) return 0;
  return Math.round((Math.atan2(right, fwd) * 180) / Math.PI);
}

/** Feed line for a hit. */
export function hitLine(attacker: string, victim: string, count = 1): string {
  return `${attacker} ⟶ ${victim}${count > 1 ? ` ×${count}` : ''}`;
}

/** Index of the entry (newest first) to evict: the oldest ordinary line, else the oldest line of all. */
export function evictIndex(entries: Array<{ strong: boolean }>): number {
  for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].strong) return i;
  return entries.length - 1;
}

/** Index of a non-strong entry with the same key still inside the merge window (newest first), or -1. */
export function mergeIndex(entries: Array<{ key?: string; strong: boolean; timestamp: number }>, key: string, now: number, windowMs: number): number {
  return entries.findIndex((e) => !e.strong && e.key === key && now - e.timestamp <= windowMs);
}

/** A server number, safe for innerHTML. */
export function num(v: unknown): number {
  return Number(v) || 0;
}

/** Seat swatch markup: seat colour with the 1-based seat number. */
export function swatchHtml(seat: unknown, color: unknown): string {
  const c = safeColor(color);
  return `<span class="brawl-swatch" style="background:${c};color:${readableText(c)}">${num(seat) + 1}</span>`;
}

/** Rank medal/number cell for the results table. */
function rankCell(rank: number, winner: boolean): string {
  return winner ? '👑' : String(rank);
}

/** Final standings table for the brawl results overlay (HTML string; names are escaped). */
export function resultsTableHtml(rows: StandingRow[], myId: string, winnerId: string | undefined): string {
  const rk = ranks(rows);
  const body = rows.map((r, i) => {
    const me = r.id === myId;
    const win = r.id === winnerId;
    return `<tr class="brawl-res-row${me ? ' me' : ''}${win ? ' win' : ''}">`
      + `<td class="rk">${rankCell(rk[i], win)}</td>`
      + `<td>${swatchHtml(r.seat, r.color)}</td>`
      + `<td class="nm">${escapeHtml(r.name)}${me ? ' (you)' : ''}</td>`
      + `<td class="n sc">${num(r.score)}</td><td class="n">${num(r.hits)}</td><td class="n">${num(r.kos)}</td><td class="n">${num(r.captures)}</td></tr>`;
  }).join('');
  return '<table class="brawl-res"><thead><tr><th>#</th><th></th><th class="nm">Player</th>'
    + '<th class="n">Score</th><th class="n" title="Hits">Hits</th><th class="n" title="Knockouts">KOs</th><th class="n" title="Power-up captures">Caps</th></tr></thead>'
    + `<tbody>${body}</tbody></table>`;
}
