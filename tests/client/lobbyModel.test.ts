import { describe, it, expect } from 'vitest';
import {
  modeLabel, queuePosition, queueBannerText, seatStatus, endPracticeLabel,
  isLobbyPhase, reconnectSeconds, droppedText, seatTokenKey, seatedHumans, invitePrompt, isRanked, escapeHtml, safeColor,
} from '../../src/client/lobbyModel';

const seat = (over: any = {}) => ({ seat: 0, id: 'a', name: 'Ann', color: '#0072B2', ready: false, connected: true, isBot: false, ...over });

describe('lobbyModel', () => {
  it('labels the mode the room would start in', () => {
    expect(modeLabel('solo', 1)).toBe('Practice vs bot');
    expect(modeLabel('duel', 2)).toBe('Duel');
    expect(modeLabel('brawl', 3)).toBe('Brawl — 3 players');
  });

  it('finds the queue position', () => {
    const q = [{ id: 'x' }, { id: 'y' }];
    expect(queuePosition(q, 'y')).toBe(2);
    expect(queuePosition(q, 'z')).toBe(0);
    expect(queuePosition(q, undefined)).toBe(0);
    expect(queueBannerText(2)).toBe("Spectating — you're #2 in line for the next match");
  });

  it('describes seats', () => {
    expect(seatStatus(null)).toBe('Open — invite a friend');
    expect(seatStatus(seat())).toBe('Not ready');
    expect(seatStatus(seat({ ready: true }))).toBe('Ready');
    expect(seatStatus(seat({ connected: false }))).toBe('Reconnecting…');
    expect(seatStatus(seat({ isBot: true }))).toBe('Practice bot');
    expect(seatedHumans([seat(), seat({ isBot: true }), null])).toHaveLength(1);
    expect(invitePrompt('duel', 2)).toContain('everyone is ready');
  });

  it('names the waiting spectator on End practice', () => {
    expect(endPracticeLabel([])).toBe('End practice');
    expect(endPracticeLabel([{ name: 'Bob' }])).toBe('Bob is waiting to join — End practice');
  });

  it('knows lobby phases and token keys', () => {
    expect(isLobbyPhase('countdown')).toBe(true);
    expect(isLobbyPhase('playing')).toBe(false);
    expect(seatTokenKey(7)).toBe('zombieHugsSeat:7');
  });

  it('computes the reconnect countdown', () => {
    expect(reconnectSeconds(10_000 + 15_000, 10_000)).toBe(15);
    expect(reconnectSeconds(10_000 + 6_200, 10_000)).toBe(7);
    expect(reconnectSeconds(1, 10_000_000)).toBe(0); // expired
    expect(reconnectSeconds(10_000_000 + 60_000, 10_000_000)).toBe(15); // far ahead -> full window
    expect(droppedText('Bob', 15)).toBe('Bob dropped — 15 s to reconnect');
  });

  it('knows ranked modes, escapes and validates colours', () => {
    expect(isRanked('duel')).toBe(true);
    expect(isRanked('solo')).toBe(false);
    expect(isRanked('brawl')).toBe(false);
    expect(escapeHtml(`<b onclick="x">'&`)).toBe('&lt;b onclick=&quot;x&quot;&gt;&#39;&amp;');
    expect(safeColor('#D55E00')).toBe('#D55E00');
    expect(safeColor('red;background:url(x)')).toBe('#ffffff');
    expect(safeColor(undefined)).toBe('#ffffff');
  });
});
