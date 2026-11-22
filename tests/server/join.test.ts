import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Socket } from 'socket.io';
import controller, { Game, assignSide } from '../../lib/controller';
import { FakeSocket } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

let nextId = 9000;
let game: Game;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  game = new Game(nextId++, 'join-test');
  controller.games[game.id] = game;
});
afterEach(() => {
  delete controller.games[game.id];
  vi.clearAllTimers();
  vi.useRealTimers();
});

function connect(id: string) {
  const socket = new FakeSocket(id);
  controller.setupSocket(socket as unknown as Socket);
  return socket;
}
const joinPlayer = (s: FakeSocket, gameId: unknown = game.id) => s.trigger('join.player', { gameId });
const playerInfo = (s: FakeSocket) => s.events('player')[0]?.args[0];

describe('join validation (A1)', () => {
  it.each([
    ['unknown id', { gameId: 123456 }],
    ['string id', { gameId: '5' }],
    ['non-integer id', { gameId: 1.5 }],
    ['missing id', {}],
    ['undefined payload', undefined],
    ['null payload', null],
    ['prototype key', { gameId: 'constructor' }],
  ])('join.player with %s emits notfound and does not throw', (_n, payload) => {
    const s = connect('s1');
    expect(() => s.trigger('join.player', payload)).not.toThrow();
    expect(s.events('join.error.notfound')).toHaveLength(1);
    expect(s.events('player')).toHaveLength(0);
  });

  it('join.spectator with bad ids emits notfound and does not throw', () => {
    for (const payload of [{ gameId: 123456 }, { gameId: '5' }, {}, undefined]) {
      const s = connect('sp');
      expect(() => s.trigger('join.spectator', payload)).not.toThrow();
      expect(s.events('join.error.notfound')).toHaveLength(1);
    }
  });

  it('a socket that got notfound can still join a real game', () => {
    const s = connect('s1');
    joinPlayer(s, 123456);
    joinPlayer(s);
    expect(Object.keys(game.players)).toEqual(['s1']);
  });
});

describe('double join (A8)', () => {
  it('ignores a second join.player: one fire gives one creature', () => {
    const a = connect('a');
    const b = connect('b');
    joinPlayer(a);
    joinPlayer(b);
    joinPlayer(a);
    expect(a.events('player')).toHaveLength(1);
    expect(Object.keys(game.players)).toHaveLength(2);

    game.phase = 'playing';
    a.trigger('fire', { x: 0, y: 0, z: playerInfo(a).position.z }, 1, undefined);
    expect(Object.keys(game.zombies)).toHaveLength(1);
  });

  it('ignores join.spectator after join.player and vice versa', () => {
    const a = connect('a');
    joinPlayer(a);
    a.trigger('join.spectator', { gameId: game.id });
    expect(Object.keys(game.spectators)).toHaveLength(0);

    const s = connect('s');
    s.trigger('join.spectator', { gameId: game.id });
    joinPlayer(s);
    expect(Object.keys(game.spectators)).toEqual(['s']);
    expect(Object.keys(game.players)).not.toContain('s');
  });
});

describe('capacity (A4)', () => {
  it('third joiner gets join.error.full and never a player event', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(connect);
    joinPlayer(a);
    joinPlayer(b);
    joinPlayer(c);
    expect(c.events('player')).toHaveLength(0);
    expect(c.events('join.error.full')).toHaveLength(1);
    expect(Object.keys(game.players)).toEqual(['a', 'b']);
  });

  it('the rejected joiner can then join as spectator (client flow)', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(connect);
    joinPlayer(a);
    joinPlayer(b);
    joinPlayer(c);
    c.trigger('join.spectator', { gameId: game.id });
    expect(Object.keys(game.spectators)).toEqual(['c']);
  });
});

describe('side assignment (A3)', () => {
  it('first two joiners get opposite sides, first as today (z=-1000, dir -1)', () => {
    const a = connect('a');
    const b = connect('b');
    joinPlayer(a);
    joinPlayer(b);
    expect(playerInfo(a).position.z).toBe(-1000);
    expect(playerInfo(a).direction).toBe(-1);
    expect(playerInfo(b).position.z).toBe(1000);
    expect(playerInfo(b).direction).toBe(1);
  });

  it('a replacement takes the side opposite the remaining player', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(connect);
    joinPlayer(a);
    joinPlayer(b);
    game.exitPlayer(game.players['a']);
    joinPlayer(c);
    expect(game.players['b'].direction).toBe(1);
    expect(game.players['c'].direction).toBe(-1);
    expect(game.players['c'].position.z).toBe(-1000);
  });

  it('works when the second player leaves instead, and after a rejected third joiner', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(connect);
    joinPlayer(a);
    joinPlayer(b);
    joinPlayer(c); // rejected
    game.exitPlayer(game.players['b']);
    joinPlayer(d);
    expect(game.players['a'].direction).toBe(-1);
    expect(game.players['d'].direction).toBe(1);
    expect(game.players['d'].position.z).toBe(1000);
  });

  it('assignSide on an empty game is -1', () => {
    expect(assignSide(new Game(1))).toBe(-1);
  });
});
