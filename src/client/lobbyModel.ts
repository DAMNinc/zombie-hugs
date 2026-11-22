// Pure helpers for the lobby UI (no DOM, unit-tested in tests/client/lobbyModel.test.ts).

export type RoomMode = 'solo' | 'duel' | 'brawl';

export interface LobbySeat {
  seat: number;
  id: string;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
}

export interface LobbyPayload {
  phase: string;
  mode: RoomMode;
  seats: Array<LobbySeat | null>;
  queue: Array<{ id: string; name: string }>;
  invitePath: string;
}

/** Phases in which the lobby panel is shown. */
export function isLobbyPhase(phase: string): boolean {
  return phase === 'lobby' || phase === 'countdown';
}

/** The mode the room would start in, as the player reads it. */
export function modeLabel(mode: RoomMode, humans: number): string {
  if (mode === 'solo') return 'Practice vs bot';
  if (mode === 'duel') return 'Duel';
  return `Brawl — ${humans} players`;
}

export function seatedHumans(seats: Array<LobbySeat | null>): LobbySeat[] {
  return seats.filter((s): s is LobbySeat => !!s && !s.isBot);
}

/** 1-based queue position of `myId`, or 0 when not queued. */
export function queuePosition(queue: Array<{ id: string }>, myId: string | undefined): number {
  if (!myId) return 0;
  const i = queue.findIndex((q) => q.id === myId);
  return i < 0 ? 0 : i + 1;
}

export function queueBannerText(position: number): string {
  return position > 0
    ? `Spectating — you're #${position} in line for the next match`
    : 'Spectating — waiting for a free seat in the next match';
}

/** Lobby line listing the queued spectators with their position, or '' when nobody waits. */
export function waitingText(queue: Array<{ name: string }>): string {
  if (queue.length === 0) return '';
  return 'Waiting for next match: ' + queue.map((q, i) => `${i + 1}. ${q.name}`).join(', ');
}

/** Status line for a seat row. */
export function seatStatus(seat: LobbySeat | null): string {
  if (!seat) return 'Open — invite a friend';
  if (seat.isBot) return 'Practice bot';
  if (!seat.connected) return 'Reconnecting…';
  return seat.ready ? 'Ready' : 'Not ready';
}

export function invitePrompt(mode: RoomMode, humans: number): string {
  if (humans === 0) return '';
  if (mode === 'solo') return 'Press Ready to practice against a bot — or invite a friend first.';
  return 'The match starts when everyone is ready.';
}

/** The "End practice" button label: names the first queued spectator when there is one. */
export function endPracticeLabel(queue: Array<{ name: string }>): string {
  return queue.length > 0 ? `${queue[0].name} is waiting to join — End practice` : 'End practice';
}

export function seatTokenKey(gameId: number | string): string {
  return `zombieHugsSeat:${gameId}`;
}

/** Seconds left of a reconnect window (0 once it has ended); the full window when the clocks disagree. */
export function reconnectSeconds(until: number, now: number, windowSec = 15): number {
  const s = Math.ceil((until - now) / 1000);
  if (s > windowSec + 5) return windowSec; // implausibly far ahead: the clocks disagree
  return Math.max(0, Math.min(s, windowSec));
}

export function droppedText(name: string, seconds: number): string {
  return `${name} dropped — ${seconds} s to reconnect`;
}

/** Duels are ranked (ELO); solo practice and brawls are not. */
export function isRanked(mode: RoomMode): boolean {
  return mode === 'duel';
}

export function escapeHtml(t: string): string {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** A hex colour from the server, or white: never lets arbitrary text into a style attribute. */
export function safeColor(c: unknown): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#ffffff';
}
