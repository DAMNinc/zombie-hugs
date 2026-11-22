import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Game, Zombie, healthFromCode, speedFromCode, fireDelayFromCode, getElo, updateElo, getLeaderboard,
} from '../../lib/controller';
import { makePlayer, makeGameWithTwoPlayers, startPlaying } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const fire = (s: any, code = 1, pos = { x: 0, y: 0, z: -1000 }, charge?: number) =>
  s.trigger('fire', pos, code, charge);

describe('creature stat helpers', () => {
  it('maps weapon codes to health', () => {
    expect([1, 2, 3, 4, 5, 99].map(healthFromCode)).toEqual([1, 2, 1, 3, 1, 1]);
  });
  it('maps weapon codes to speed', () => {
    expect([1, 2, 3, 4, 5, 99].map(speedFromCode)).toEqual([300, 300, 300, 300, 200, 300]);
  });
  it('maps weapon codes to fire delay', () => {
    expect([1, 2, 3, 4, 5, 99].map(fireDelayFromCode)).toEqual([1000, 1500, 500, 2000, 3000, 1000]);
  });
});

describe('ELO', () => {
  it('defaults to 1000 and updates symmetrically for equal ratings', () => {
    updateElo('elo-w1', 'elo-l1');
    expect(getElo('elo-w1')).toBe(1016);
    expect(getElo('elo-l1')).toBe(984);
  });
  it('favoured winner gains less than an underdog winner', () => {
    updateElo('elo-w2', 'elo-l2'); // w2 1016, l2 984
    const before = getElo('elo-w2');
    updateElo('elo-l2', 'elo-w2'); // underdog wins
    expect(getElo('elo-l2') - 984).toBeGreaterThan(16);
    expect(getElo('elo-w2')).toBeLessThan(before);
  });
  it('leaderboard is sorted descending', () => {
    updateElo('elo-w3', 'elo-l3');
    const lb = getLeaderboard();
    for (let i = 1; i < lb.length; i++) expect(lb[i - 1].elo).toBeGreaterThanOrEqual(lb[i].elo);
    expect(lb.find(e => e.name === 'elo-w3')?.elo).toBe(1016);
  });
});

describe('joining', () => {
  it('lets two players join, exchanging opponent info and ELO', () => {
    const { game, a, b } = makeGameWithTwoPlayers();
    expect(Object.keys(game.players)).toEqual(['a', 'b']);
    expect(a.socket.events('opponent')[0].args[0].id).toBe('b');
    expect(b.socket.events('opponent')[0].args[0].id).toBe('a');
    expect(a.socket.events('elo')[0].args[0]).toBe(1000);
    expect(game.roundWins).toEqual({ a: 0, b: 0 });
    expect(game.phase).toBe('lobby');
  });

  it('rejects a third player as full', () => {
    const { game } = makeGameWithTwoPlayers();
    const c = makePlayer('c');
    game.joinPlayer(c.player);
    expect(c.socket.events('join.error.full')).toHaveLength(1);
    expect(game.players['c']).toBeUndefined();
  });

  it('adds a spectator who receives opponents, hazards and broadcasts', () => {
    const { game, a } = makeGameWithTwoPlayers();
    const s = makePlayer('s', 'Spec', 0, 0);
    game.joinSpectator(s.player);
    expect(game.spectators['s']).toBe(s.player);
    expect(s.socket.events('opponent').map(e => e.args[0].id)).toEqual(['a', 'b']);
    expect(s.socket.events('hazards')).toHaveLength(1);
    expect(a.socket.events('spectator')).toHaveLength(1);
    game.emitAll('x');
    expect(s.socket.events('x')).toHaveLength(1);
  });
});

describe('ready and countdown', () => {
  it('does not start until all players are ready', () => {
    const { game, a } = makeGameWithTwoPlayers();
    a.socket.trigger('ready');
    expect(game.phase).toBe('lobby');
  });

  it('a lone ready player stays in the lobby (no solo match)', () => {
    const game = new Game(1, 'test');
    const a = makePlayer('a', 'solo-a', -1000, -1);
    game.joinPlayer(a.player);
    a.socket.trigger('ready');
    vi.advanceTimersByTime(10000);
    expect(game.phase).toBe('lobby');
    expect(a.socket.events('game.countdown')).toHaveLength(0);
  });

  it('the second player joining and readying starts the countdown', () => {
    const game = new Game(1, 'test');
    const a = makePlayer('a', 'two-a', -1000, -1);
    const b = makePlayer('b', 'two-b', 1000, 1);
    game.joinPlayer(a.player);
    a.socket.trigger('ready');
    game.joinPlayer(b.player);
    expect(game.phase).toBe('lobby');
    b.socket.trigger('ready');
    expect(game.phase).toBe('countdown');
  });

  it('counts down 3,2,1 then starts playing after 3s', () => {
    const { game, a, b } = makeGameWithTwoPlayers();
    a.socket.trigger('ready');
    b.socket.trigger('ready');
    expect(game.phase).toBe('countdown');
    expect(a.socket.events('game.countdown').map(e => e.args[0])).toEqual([3]);
    vi.advanceTimersByTime(2000);
    expect(a.socket.events('game.countdown').map(e => e.args[0])).toEqual([3, 2, 1]);
    expect(game.phase).toBe('countdown');
    vi.advanceTimersByTime(1000);
    expect(game.phase).toBe('playing');
    expect(a.socket.events('game.start')).toHaveLength(1);
    expect(game.hazards).toHaveLength(2);
    expect(game.roundStartTime).toBe(Date.now());
  });
});

describe('firing', () => {
  it('ignores fire outside playing phase', () => {
    const { game, a } = makeGameWithTwoPlayers();
    fire(a.socket);
    expect(Object.keys(game.zombies)).toHaveLength(0);
  });

  it('creates a zombie with the right stats and direction', () => {
    const { game, a } = startPlaying();
    fire(a.socket, 2);
    const zs = Object.values(game.zombies);
    expect(zs).toHaveLength(1);
    expect(zs[0].health).toBe(2);
    expect(zs[0].speed).toBe(300);
    expect(zs[0].direction).toBe(1); // opposite of player direction -1
    expect(zs[0].firedByPlayer).toBe('a');
    expect(game.stats['a'].zombiesFired).toBe(1);
    expect(a.socket.events('zombie')).toHaveLength(1);
  });

  it('enforces the per-weapon fire delay', () => {
    const { game, a } = startPlaying();
    fire(a.socket, 1);
    vi.advanceTimersByTime(999);
    fire(a.socket, 1);
    expect(Object.keys(game.zombies)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    fire(a.socket, 1);
    expect(Object.keys(game.zombies)).toHaveLength(2);
  });

  it('horde (code 5) spawns five slower creatures spread in x', () => {
    const { game, a } = startPlaying();
    fire(a.socket, 5);
    const zs = Object.values(game.zombies);
    expect(zs).toHaveLength(5);
    expect(zs.map(z => z.position.x).sort((p, q) => p - q)).toEqual([-120, -60, 0, 60, 120]);
    expect(zs.every(z => z.speed === 200 && z.health === 1)).toBe(true);
    expect(game.stats['a'].zombiesFired).toBe(5);
  });

  it('a full-charge shot gets bonus speed and health', () => {
    const { game, a } = startPlaying();
    fire(a.socket, 1, undefined, 99999);
    const z = Object.values(game.zombies)[0];
    expect(z.speed).toBe(400);
    expect(z.health).toBe(3);
    expect(z.chargeRatio).toBe(1);
  });

  it('twin strike synergy fires an extra fox after two recent foxes', () => {
    const { game, a } = startPlaying();
    a.player.activePowerUps.push({ type: 'rapid_fire', expiresAt: Date.now() + 8000 }); // halves delay
    fire(a.socket, 1);
    vi.advanceTimersByTime(500);
    fire(a.socket, 1); // only one recent fox -> no synergy
    expect(Object.keys(game.zombies)).toHaveLength(2);
    vi.advanceTimersByTime(500);
    fire(a.socket, 1); // two recent foxes -> twin strike
    expect(Object.keys(game.zombies)).toHaveLength(4);
    expect(a.socket.events('synergy')[0].args).toEqual(['a', 'twin_strike']);
  });
});

describe('scoring and damage', () => {
  const addZombie = (game: Game, owner: string, z: number, dir: number, hp = 1, code = 2, x = 0) => {
    const zb = new Zombie('z', { x, y: 0, z }, dir, owner, hp, code, 300);
    game.zombies[zb.id] = zb;
    return zb;
  };

  it('a zombie crossing the far side scores a point and damages the opponent', () => {
    const { game, a, b } = startPlaying();
    addZombie(game, 'a', 1499, 1);
    game.update(0.1);
    expect(a.player.score).toBe(1);
    expect(b.player.hp).toBe(9);
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(game.stats['a'].zombiesScored).toBe(1);
    expect(b.socket.events('player.damage')[0].args).toEqual(['b', 9]);
  });

  it('quick consecutive scores build combo bonus; double_points doubles', () => {
    const { game, a } = startPlaying();
    addZombie(game, 'a', 1499, 1);
    game.update(0.1);
    addZombie(game, 'a', 1499, 1);
    game.update(0.1); // within combo window: combo 1 -> bonus 0
    expect(a.player.score).toBe(2);
    expect(a.player.comboCount).toBe(1);
    a.player.activePowerUps.push({ type: 'double_points', expiresAt: Date.now() + 5000 });
    addZombie(game, 'a', 1499, 1);
    game.update(0.1); // combo 2, points 2 + bonus 1
    expect(a.player.score).toBe(5);
    expect(a.player.upgradeLevel).toBe(1);
  });

  it('opposing zombies collide and both lose health', () => {
    const { game } = startPlaying();
    const z1 = addZombie(game, 'a', 0, 1, 2);
    const z2 = addZombie(game, 'b', 50, -1, 1);
    game.update(0);
    expect(game.zombies[z1.id].health).toBe(1);
    expect(game.zombies[z2.id]).toBeUndefined();
    expect(game.zombies[z1.id].speed).toBe(350); // kill buff
    expect(game.stats['a'].zombiesDestroyed).toBe(1);
  });

  it('same-direction zombies do not collide; fox only collides with fox', () => {
    const { game } = startPlaying();
    addZombie(game, 'a', 0, 1, 1, 2);
    addZombie(game, 'a', 10, 1, 1, 2);
    addZombie(game, 'b', 0, -1, 1, 3);
    game.update(0);
    expect(Object.keys(game.zombies)).toHaveLength(3);
  });

  it('shield blocks opponent zombies', () => {
    const { game, b } = startPlaying();
    b.socket.trigger('shield');
    expect(b.player.shield.active).toBe(true);
    addZombie(game, 'a', 900, 1, 1, 2, 0);
    game.update(0);
    expect(Object.keys(game.zombies)).toHaveLength(0);
    expect(b.player.hp).toBe(10);
  });
});

describe('round and match end', () => {
  it('round ends by points', () => {
    const { game, a, b } = startPlaying();
    a.player.score = 9;
    const zb = new Zombie('z', { x: 0, y: 0, z: 1499 }, 1, 'a', 1, 2, 300);
    game.zombies[zb.id] = zb;
    game.update(0.1);
    expect(game.phase).toBe('round_over');
    expect(game.roundWins).toEqual({ a: 1, b: 0 });
    expect(game.round).toBe(2);
    expect(b.socket.events('round.end')[0].args[0].winner).toBe('a');
  });

  it('round ends by HP and resets for the next round after 3s', () => {
    const { game, a, b } = startPlaying();
    b.player.hp = 1;
    a.player.score = 4;
    const zb = new Zombie('z', { x: 0, y: 0, z: 1499 }, 1, 'a', 1, 2, 300);
    game.zombies[zb.id] = zb;
    game.update(0.1);
    expect(game.phase).toBe('round_over');
    expect(game.roundWins['a']).toBe(1);
    vi.advanceTimersByTime(2999);
    expect(game.phase).toBe('round_over');
    vi.advanceTimersByTime(1);
    // reset -> everyone auto-ready -> countdown
    expect(game.phase).toBe('countdown');
    expect(a.player.score).toBe(0);
    expect(b.player.hp).toBe(10);
    expect(game.zombies).toEqual({});
    expect(a.socket.events('round.reset')).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(game.phase).toBe('playing');
  });

  it('best of three: winning two rounds ends the match and updates ELO', () => {
    const { game, a, b } = startPlaying({ names: ['MatchWinner', 'MatchLoser'] });
    game.roundWins['a'] = 1;
    b.player.hp = 1;
    const zb = new Zombie('z', { x: 0, y: 0, z: 1499 }, 1, 'a', 1, 2, 300);
    game.zombies[zb.id] = zb;
    game.update(0.1);
    expect(game.phase).toBe('match_over');
    const over = a.socket.events('match.over')[0].args[0];
    expect(over.winner).toBe('a');
    expect(over.elo).toEqual({ a: 1016, b: 984 });
    expect(over.leaderboard.length).toBeGreaterThan(0);
    expect(getElo('MatchWinner')).toBe(1016);
    expect(getElo('MatchLoser')).toBe(984);
  });

  it('rematch resets match state and starts a new countdown', () => {
    const { game, a, b } = startPlaying();
    game.phase = 'match_over';
    game.roundWins = { a: 2, b: 0 };
    a.socket.trigger('rematch');
    expect(game.phase).toBe('match_over');
    b.socket.trigger('rematch');
    expect(game.roundWins).toEqual({ a: 0, b: 0 });
    expect(game.round).toBe(1);
    expect(game.phase).toBe('countdown');
  });

  it('sudden death after 90s boosts zombies', () => {
    const { game } = startPlaying();
    const zb = new Zombie('z', { x: 0, y: 0, z: 0 }, 1, 'a', 1, 2, 300);
    game.zombies[zb.id] = zb;
    vi.setSystemTime(Date.now() + 90000);
    game.update(0);
    expect(game.phase).toBe('sudden_death');
    expect(zb.speed).toBe(600);
    expect(zb.health).toBe(2);
  });
});

describe('player exit', () => {
  it('removes the player and broadcasts', () => {
    const { game, a, b } = startPlaying();
    a.socket.trigger('exit');
    expect(game.players['a']).toBeUndefined();
    expect(b.socket.events('player.exit')[0].args).toEqual(['a']);
  });


  it('checkPing removes players that stopped pinging', () => {
    const { game, a, b } = startPlaying();
    vi.advanceTimersByTime(5000);
    b.socket.trigger('pingpong');
    game.checkPing();
    expect(game.players['a']).toBeUndefined();
    expect(game.players['b']).toBeDefined();
  });
});
