import { describe, it, expect } from 'vitest';
import {
  formatClock, isUrgent, leaderIds, ranks, timerView, secondsUntil, koText, telegraphText, attackerAngle, hitLine, evictIndex, mergeIndex, num, resultsTableHtml,
} from '../../src/client/brawlModel';
import { edgeView } from '../../src/client/arena';

describe('round clock', () => {
  it('formats mm:ss rounding up', () => {
    expect(formatClock(120000)).toBe('2:00');
    expect(formatClock(65001)).toBe('1:06');
    expect(formatClock(9000)).toBe('0:09');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });
  it('emphasises the last 10 seconds only', () => {
    expect(isUrgent(10000)).toBe(true);
    expect(isUrgent(10001)).toBe(false);
    expect(isUrgent(0)).toBe(false);
  });
  it('shows the tied names in sudden death', () => {
    const v = timerView(0, true, ['Bob', 'Cleo']);
    expect(v.sudden).toBe(true);
    expect(v.detail).toBe('SUDDEN DEATH — Bob, Cleo');
    expect(timerView(30000, false, []).text).toBe('0:30');
  });
});

describe('standings', () => {
  const rows = [{ id: 'a', score: 5 }, { id: 'b', score: 5 }, { id: 'c', score: 2 }, { id: 'd', score: 0 }];
  it('marks every holder of the top score, nobody at 0', () => {
    expect(leaderIds(rows)).toEqual(['a', 'b']);
    expect(leaderIds([{ id: 'a', score: 0 }])).toEqual([]);
  });
  it('shares ranks on ties', () => {
    expect(ranks(rows)).toEqual([1, 1, 3, 4]);
  });
});

describe('countdowns', () => {
  it('seconds until, clamped, full span when clocks disagree', () => {
    expect(secondsUntil(10_000, 7_500, 3)).toBe(3);
    expect(secondsUntil(10_000, 9_100, 3)).toBe(1);
    expect(secondsUntil(10_000, 12_000, 3)).toBe(0);
    expect(secondsUntil(500_000, 0, 3)).toBe(3);
  });
  it('texts', () => {
    expect(koText('Bob', 3)).toBe('Knocked out by Bob — back in 3…2…1');
    expect(koText(null, 1)).toBe('Knocked out — back in 1');
    expect(telegraphText(3)).toBe('Power-up in 3');
    expect(telegraphText(0)).toBe('Power-up!');
  });
});

describe('attacker direction', () => {
  it('opposite edge is straight ahead, adjacent edges are 45 degrees to a side', () => {
    expect(attackerAngle(edgeView('S', 'square'), 'N')).toBe(0);
    expect(attackerAngle(edgeView('N', 'square'), 'S')).toBe(0);
    expect(attackerAngle(edgeView('W', 'square'), 'E')).toBe(0);
    // S looks at -z with right = +x: N is ahead, E (x=+1000) is to the right.
    expect(attackerAngle(edgeView('S', 'square'), 'E')).toBe(45);
  });
  it('left and right are mirrored and ignore junk', () => {
    const s = edgeView('S', 'square');
    const e = attackerAngle(s, 'E');
    const w = attackerAngle(s, 'W');
    expect(e).toBe(-w);
    expect(Math.abs(e)).toBeGreaterThan(0);
    expect(attackerAngle(s, 'bogus')).toBe(0);
    expect(attackerAngle(s, 'S')).toBe(0);
  });
});

describe('feed lines', () => {
  it('formats hits', () => {
    expect(hitLine('Bob', 'Cleo')).toBe('Bob \u27F6 Cleo');
    expect(hitLine('Bob', 'Cleo', 3)).toBe('Bob \u27F6 Cleo \u00D73');
  });
  it('evicts the oldest ordinary line, else the oldest line (never the newest)', () => {
    expect(evictIndex([{ strong: true }, { strong: false }, { strong: true }, { strong: false }])).toBe(3);
    expect(evictIndex([{ strong: true }, { strong: false }, { strong: true }, { strong: true }])).toBe(1);
    expect(evictIndex([{ strong: true }, { strong: true }, { strong: true }])).toBe(2);
  });
  it('merges into any ordinary same-key line inside the window', () => {
    const e = [
      { key: 'b>c', strong: false, timestamp: 9000 },
      { key: 'a>b', strong: false, timestamp: 8000 },
      { key: 'a>b', strong: true, timestamp: 7000 },
    ];
    expect(mergeIndex(e, 'a>b', 10000, 4000)).toBe(1);
    expect(mergeIndex(e, 'a>b', 20000, 4000)).toBe(-1);
    expect(mergeIndex(e, 'x', 10000, 4000)).toBe(-1);
  });
  it('sanitises server numbers', () => {
    expect(num('<img>')).toBe(0);
    expect(num(5)).toBe(5);
  });
});

describe('results table', () => {
  const rows = [
    { id: 'a', name: 'Al<b>', seat: 0, color: '#0072B2', score: 9, hits: 7, kos: 1, captures: 0 },
    { id: 'b', name: 'Bo', seat: 2, color: 'javascript:x', score: 4, hits: 4, kos: 0, captures: 1 },
  ];
  it('lists rank, seat, name, score, hits, KOs, captures and escapes names and colours', () => {
    const html = resultsTableHtml(rows, 'b', 'a');
    expect(html).toContain('Al&lt;b&gt;');
    expect(html).not.toContain('Al<b>');
    expect(html).not.toContain('javascript');
    expect(html).toContain('(you)');
    expect(html).toContain('win');
    expect(html.match(/<tr class="brawl-res-row/g)).toHaveLength(2);
    expect(html).toContain('KOs');
  });
});
