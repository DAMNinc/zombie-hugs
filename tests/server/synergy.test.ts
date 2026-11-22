import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startPlaying } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Weapon codes: 1 fox, 2 horse, 3 flamingo, 4 zombie, 5 horde.
// Fire through the real handler, waiting `gap` ms before each shot (the real fire delays apply).
function setup() {
  const ctx = startPlaying();
  const fire = (code: number) => ctx.a.socket.trigger('fire', { x: 0 }, code, undefined);
  const synergies = () => ctx.a.socket.events('synergy').map(e => e.args[1]);
  return { ...ctx, fire, synergies };
}

describe('synergies are reachable at the real fire delays (A12)', () => {
  it('Air Strike: fox then flamingo after 500 ms', () => {
    const { fire, synergies } = setup();
    fire(1);
    vi.advanceTimersByTime(500);
    fire(3);
    expect(synergies()).toEqual(['air_strike']);
  });

  it('Juggernaut: zombie then horse after 1500 ms', () => {
    const { fire, synergies } = setup();
    fire(4);
    vi.advanceTimersByTime(1500);
    fire(2);
    expect(synergies()).toEqual(['juggernaut']);
  });

  it('Stampede: horse then horde after 3000 ms', () => {
    const { fire, synergies } = setup();
    fire(2);
    vi.advanceTimersByTime(3000);
    fire(5);
    expect(synergies()).toEqual(['stampede']);
  });

  it('Twin Strike: fox, fox, fox at 1000 ms spacing', () => {
    const { fire, synergies } = setup();
    fire(1);
    vi.advanceTimersByTime(1000);
    fire(1);
    expect(synergies()).toEqual([]);
    vi.advanceTimersByTime(1000);
    fire(1);
    expect(synergies()).toEqual(['twin_strike']);
  });

  it('does not trigger when the combo is spaced beyond the window', () => {
    const { fire, synergies } = setup();
    fire(2);
    vi.advanceTimersByTime(3600);
    fire(5);
    expect(synergies()).toEqual([]);
    fire(4);
    vi.advanceTimersByTime(3600);
    fire(2);
    expect(synergies()).toEqual([]);
  });
});
