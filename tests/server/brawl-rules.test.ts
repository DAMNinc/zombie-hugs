import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game, Zombie } from '../../lib/controller';
import { startBrawl } from './helpers';

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

type Ctx = ReturnType<typeof startBrawl>;

/** Fire a creature owned by `from` out through the edge of seat `to` (seat 0 N, 1 S, 2 W, 3 E). */
const hit = (ctx: Ctx, from: number, to: number) => {
  const { game, ps } = ctx;
  const owner = ps[from].player;
  const vec: Record<string, [number, number, number, number]> = {
    N: [0, -1140, 0, -1],
    S: [0, 1140, 0, 1],
    W: [-1140, 0, -1, 0],
    E: [1140, 0, 1, 0],
  };
  const [x, z, vx, vz] = vec[ps[to].player.edge as string];
  const zb = new Zombie('z', { x, y: 0, z }, 1, owner.id, 1, 4, 300);
  zb.setHeading(vx, vz, null);
  game.zombies[zb.id] = zb;
  game.update(0.1);
};

const advance = (ctx: Ctx, ms: number) => {
  // Step in 1 s slices so the per-tick upkeep (respawns, central power-up, round clock) sees each moment.
  let left = ms;
  while (left > 0) {
    const step = Math.min(1000, left);
    vi.advanceTimersByTime(step);
    ctx.game.update(step / 1000);
    left -= step;
  }
};

const names = (ctx: Ctx, event: string) => ctx.ps[0].socket.events(event);
const row = (ctx: Ctx, seat: number) => ctx.game.standings().find(s => s.seat === seat)!;

describe('brawl scoring and standings', () => {
  it('game.start carries the round duration and state the remaining time', () => {
    const ctx = startBrawl(3);
    expect(names(ctx, 'game.start')[0].args[0]).toMatchObject({ mode: 'brawl', ranked: false, roundDurationMs: 120000 });
    expect(ctx.game.toJSON().roundRemainingMs).toBe(120000);
    advance(ctx, 5000);
    expect(ctx.game.toJSON().roundRemainingMs).toBe(115000);
  });

  it('scores 1 per hit, +2 on a knockout and orders standings by score, hits, seat', () => {
    const ctx = startBrawl(3);
    hit(ctx, 0, 1);
    expect(row(ctx, 0)).toMatchObject({ score: 1, hits: 1, kos: 0 });
    ctx.ps[1].player.hp = 1;
    advance(ctx, 2500); // keep the combo window out of the way
    hit(ctx, 0, 1);
    expect(row(ctx, 0)).toMatchObject({ score: 4, hits: 2, kos: 1 });
    expect(ctx.game.players[ctx.ps[1].player.id].alive).toBe(false);
    hit(ctx, 2, 0);
    const order = ctx.game.standings().map(s => s.seat);
    expect(order).toEqual([0, 2, 1]);
    const last = names(ctx, 'standings').at(-1)!.args[0];
    expect(last.map((s: any) => s.seat)).toEqual([0, 2, 1]);
    expect(ctx.game.toJSON().standings).toEqual(last);
  });

  it('breaks score and hits ties by seat', () => {
    const ctx = startBrawl(3);
    hit(ctx, 2, 0);
    hit(ctx, 1, 0);
    expect(ctx.game.standings().map(s => s.seat)).toEqual([1, 2, 0]);
  });

  it('double points doubles hit points only', () => {
    const ctx = startBrawl(3);
    const p0 = ctx.ps[0].player;
    p0.activePowerUps.push({ type: 'double_points', expiresAt: Date.now() + 10000 });
    ctx.ps[1].player.hp = 1;
    hit(ctx, 0, 1);
    expect(p0.score).toBe(2 + 2); // doubled hit + flat knockout bonus
  });

  it('walls cost points and standings follow', () => {
    const ctx = startBrawl(3);
    hit(ctx, 0, 1);
    hit(ctx, 0, 2);
    hit(ctx, 0, 1);
    const before = ctx.ps[0].player.score;
    ctx.ps[0].socket.trigger('place.wall', 0);
    expect(ctx.ps[0].player.score).toBe(before - 3);
    expect(names(ctx, 'standings').at(-1)!.args[0].find((s: any) => s.seat === 0).score).toBe(before - 3);
  });

  it('a miss through an empty or own edge scores nothing', () => {
    const ctx = startBrawl(3);
    const zb = new Zombie('z', { x: 1140, y: 0, z: 0 }, 1, ctx.ps[0].player.id, 1, 4, 300);
    zb.setHeading(1, 0, null); // seat 3 (E) does not exist with three players
    ctx.game.zombies[zb.id] = zb;
    ctx.game.update(0.1);
    expect(row(ctx, 0).score).toBe(0);
  });
});

describe('brawl knockout and respawn', () => {
  const knockOut = (ctx: Ctx) => {
    ctx.ps[1].player.hp = 1;
    hit(ctx, 0, 1);
  };

  it('emits player.ko with respawn time and blocks fire, move, shield and walls', () => {
    const ctx = startBrawl(3);
    knockOut(ctx);
    const victim = ctx.ps[1];
    const ko = names(ctx, 'player.ko')[0].args[0];
    expect(ko).toEqual({ id: victim.player.id, by: ctx.ps[0].player.id, respawnAt: Date.now() + 3000 });
    expect(victim.player.alive).toBe(false);

    const before = Object.keys(ctx.game.zombies).length;
    victim.socket.trigger('fire', { x: 0, y: 0, z: 1000 }, 1, 0);
    victim.player.score = 5;
    victim.socket.trigger('place.wall', 0);
    victim.socket.trigger('shield');
    victim.socket.trigger('move.start', 39);
    expect(Object.keys(ctx.game.zombies).length).toBe(before);
    expect(Object.keys(ctx.game.walls)).toHaveLength(0);
    expect(victim.player.shield.active).toBe(false);
    ctx.game.update(1);
    expect(victim.player.position.x).toBe(0);
    // Attackers aimed at the KO'd player retarget.
    expect(ctx.ps[0].player.targetId).not.toBe(victim.player.id);
  });

  it('an empty (knocked-out) edge is a miss: no damage, no score', () => {
    const ctx = startBrawl(3);
    knockOut(ctx);
    const score = ctx.ps[0].player.score;
    hit(ctx, 2, 1);
    expect(ctx.ps[1].player.hp).toBe(0);
    expect(ctx.ps[2].player.score).toBe(0);
    expect(ctx.ps[0].player.score).toBe(score);
    expect(names(ctx, 'zombie.out-of-bounds').at(-1)!.args[2]).toBeNull();
  });

  it('respawns after 3 s with full HP at lateral 0', () => {
    const ctx = startBrawl(3);
    knockOut(ctx);
    const victim = ctx.ps[1].player;
    victim.position.x = 400;
    advance(ctx, 2000);
    expect(victim.alive).toBe(false);
    advance(ctx, 1000);
    expect(victim.alive).toBe(true);
    expect(victim.hp).toBe(10);
    expect(victim.position.x).toBe(0);
    expect(names(ctx, 'player.respawn')[0].args[0]).toBe(victim.id);
    // Playable again.
    victim.score = 0;
    const before = Object.keys(ctx.game.zombies).length;
    vi.advanceTimersByTime(1000);
    ctx.ps[1].socket.trigger('fire', { x: 0, y: 0, z: 1000 }, 1, 0);
    expect(Object.keys(ctx.game.zombies).length).toBeGreaterThan(before);
  });
});

describe('brawl knockout side effects', () => {
  it('tells clients to drop the shield and movement of the knocked-out player', () => {
    const ctx = startBrawl(3);
    const victim = ctx.ps[1];
    victim.socket.trigger('shield');
    victim.socket.trigger('move.start', 39);
    victim.player.hp = 1;
    hit(ctx, 0, 1);
    expect(names(ctx, 'shield.expire').map(e => e.args[0])).toEqual([victim.player.id]);
    expect(names(ctx, 'move.end').map(e => e.args)).toEqual([[1, victim.player.id]]);
    expect(victim.player.shield.active).toBe(false);
    expect(victim.player.right).toBe(false);
  });

  it('heals do not reach a knocked-out player', () => {
    const ctx = startBrawl(3);
    ctx.ps[1].player.hp = 1;
    hit(ctx, 0, 1);
    const victim = ctx.ps[1].player;
    ctx.game.applyPowerUp(victim, { id: 'h', type: 'heal', position: { x: 0, y: 0, z: 0 }, expiresAt: 0 });
    expect(victim.hp).toBe(0);
    expect(names(ctx, 'player.heal')).toHaveLength(0);
  });
});

describe('brawl central power-up', () => {
  it('telegraphs 3 s before the first spawn at 15 s, then every 20 s', () => {
    const ctx = startBrawl(3);
    advance(ctx, 11000);
    expect(names(ctx, 'powerup.telegraph')).toHaveLength(0);
    advance(ctx, 1000);
    const tele = names(ctx, 'powerup.telegraph');
    expect(tele).toHaveLength(1);
    const payload = tele[0].args[0];
    expect(payload.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(payload.spawnAt).toBe(ctx.game.roundStartTime + 15000);
    expect(names(ctx, 'powerup.spawn').filter(e => e.args[0].central)).toHaveLength(0);
    advance(ctx, 3000);
    const spawn = names(ctx, 'powerup.spawn').filter(e => e.args[0].central);
    expect(spawn).toHaveLength(1);
    expect(spawn[0].args[0]).toMatchObject({ id: payload.id, position: { x: 0, y: 0, z: 0 }, central: true });
    // Next one: telegraph at 32 s, spawn at 35 s.
    ctx.game.lastPowerUpSpawn = Date.now() + 1e9; // no regular spawns
    advance(ctx, 17000);
    expect(names(ctx, 'powerup.telegraph')).toHaveLength(2);
    advance(ctx, 3000);
    expect(names(ctx, 'powerup.spawn').filter(e => e.args[0].central)).toHaveLength(2);
  });

  it('credits the capture to the creature owner (+2, captures) with the effect', () => {
    const ctx = startBrawl(3);
    // A random regular power-up (e.g. heal) near the zombie would be collected too and change hp.
    ctx.game.spawnPowerUp = () => {};
    advance(ctx, 15000);
    const central = Object.values(ctx.game.powerUps).find(p => p.central)!;
    expect(central).toBeTruthy();
    central.type = 'heal';
    const owner = ctx.ps[2].player;
    owner.hp = 5;
    const zb = new Zombie('z', { x: 50, y: 0, z: 40 }, 1, owner.id, 1, 4, 300);
    zb.setHeading(0, 0, null);
    ctx.game.zombies[zb.id] = zb;
    ctx.game.update(0.1);
    expect(names(ctx, 'powerup.collect').at(-1)!.args).toEqual([central.id, owner.id, 'heal']);
    expect(owner.hp).toBe(8);
    expect(row(ctx, 2)).toMatchObject({ score: 2, captures: 1, hits: 0 });
    expect(ctx.game.powerUps[central.id]).toBeUndefined();
  });

  it('expires like other power-ups', () => {
    const ctx = startBrawl(3);
    advance(ctx, 15000);
    const id = Object.values(ctx.game.powerUps).find(p => p.central)!.id;
    advance(ctx, 12000);
    expect(ctx.game.powerUps[id]).toBeUndefined();
  });
});

describe('brawl round end, ties and sudden death', () => {
  it('a unique leader wins when the clock runs out; match.over is unranked with standings', () => {
    const ctx = startBrawl(4);
    hit(ctx, 3, 0);
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('match_over');
    const over = names(ctx, 'match.over')[0].args[0];
    expect(over).toMatchObject({ mode: 'brawl', ranked: false, winner: ctx.ps[3].player.id });
    expect(over.standings[0]).toMatchObject({ id: ctx.ps[3].player.id, score: 1, hits: 1 });
    expect(over.stats).toBeDefined();
    expect(over.elo).toBeUndefined();
  });

  it('a tie at the top starts sudden death among the tied only; the first of them to score wins', () => {
    const ctx = startBrawl(4);
    hit(ctx, 0, 1);
    advance(ctx, 2500);
    hit(ctx, 1, 0);
    hit(ctx, 2, 3); // seat 2 also scores 1: p0, p1 and p2 tie at the top
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('sudden_death');
    const sd = names(ctx, 'sudden.death')[0].args[0];
    expect(sd.mode).toBe('brawl');
    expect(sd.playerIds.sort()).toEqual(['p0', 'p1', 'p2']);
    expect(ctx.game.toJSON().suddenPlayerIds.sort()).toEqual(['p0', 'p1', 'p2']);
    // The non-tied player scores: no win.
    hit(ctx, 3, 0);
    expect(ctx.game.phase).toBe('sudden_death');
    expect(names(ctx, 'match.over')).toHaveLength(0);
    hit(ctx, 1, 2);
    expect(ctx.game.phase).toBe('match_over');
    expect(names(ctx, 'match.over')[0].args[0].winner).toBe('p1');
  });

  it('a scoreless sudden death ends after 60 s: hits, then kos, then lowest seat', () => {
    const ctx = startBrawl(3);
    ctx.game.update(0.1);
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('sudden_death');
    expect(names(ctx, 'sudden.death')[0].args[0].playerIds).toHaveLength(3);
    advance(ctx, 59000);
    expect(ctx.game.phase).toBe('sudden_death');
    advance(ctx, 1000);
    expect(ctx.game.phase).toBe('match_over');
    expect(names(ctx, 'match.over')[0].args[0].winner).toBe('p0'); // all equal -> lowest seat
  });

  it('cap tiebreak: equal hits, more knockouts wins over lower seat', () => {
    const ctx = startBrawl(3);
    ctx.game.update(0.1);
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('sudden_death');
    ctx.ps[2].player.kos = 1;
    advance(ctx, 60000);
    expect(names(ctx, 'match.over')[0].args[0].winner).toBe('p2');
  });

  it('cap tiebreak prefers more hits over lower seat', () => {
    const ctx = startBrawl(3);
    // Everyone ends on equal score but p2 has more hits (p2 spent points on walls).
    hit(ctx, 2, 0);
    advance(ctx, 2500);
    hit(ctx, 2, 0);
    advance(ctx, 2500);
    hit(ctx, 2, 0);
    advance(ctx, 2500);
    ctx.ps[2].socket.trigger('place.wall', 0); // 3 hits, combos make score >= 3
    ctx.ps[2].player.score = 0;
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('sudden_death');
    advance(ctx, 60000);
    expect(names(ctx, 'match.over')[0].args[0].winner).toBe('p2');
  });

  it('the duel sudden-death speed-up never applies to brawl', () => {
    const ctx = startBrawl(3);
    advance(ctx, 95000);
    expect(ctx.game.suddenDeath).toBe(false);
    expect(ctx.game.phase).toBe('playing');
  });
});

describe('brawl lifecycle and cleanup', () => {
  it('rematch and lobby.return work after a brawl and reset kos, captures and alive', () => {
    const ctx = startBrawl(3);
    ctx.ps[1].player.hp = 1;
    hit(ctx, 0, 1);
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('match_over');
    for (const p of ctx.ps) p.socket.trigger('rematch');
    expect(ctx.game.phase).toBe('countdown');
    for (const p of ctx.ps) {
      expect(p.player).toMatchObject({ score: 0, kos: 0, captures: 0, alive: true, hp: 10 });
    }
    vi.advanceTimersByTime(3000);
    expect(ctx.game.phase).toBe('playing');
    expect(ctx.game.toJSON().roundRemainingMs).toBe(120000);
    expect(ctx.game.standings().every(s => s.score === 0)).toBe(true);
    advance(ctx, 120000);
    ctx.game.update(0.1);
    // all tied -> sudden death -> force the end, then back to the lobby
    advance(ctx, 60000);
    expect(ctx.game.phase).toBe('match_over');
    ctx.ps[0].socket.trigger('lobby.return');
    expect(ctx.game.phase).toBe('lobby');
    expect(ctx.game.centralPending).toBeNull();
  });

  it('a brawl dropping to one human ends with match.over while the timer runs', () => {
    const ctx = startBrawl(3);
    advance(ctx, 10000);
    ctx.ps[1].socket.trigger('exit');
    expect(ctx.game.phase).toBe('playing');
    ctx.ps[2].socket.trigger('exit');
    expect(ctx.game.phase).toBe('match_over');
    const over = names(ctx, 'match.over')[0].args[0];
    expect(over).toMatchObject({ mode: 'brawl', ranked: false, winner: 'p0' });
  });

  it('a tied player leaving sudden death leaves the rest to decide it', () => {
    const ctx = startBrawl(4);
    // p0 and p1 tie at the top; p2 and p3 trail.
    ctx.ps[0].player.score = 4;
    ctx.ps[1].player.score = 4;
    advance(ctx, 120000);
    expect(ctx.game.phase).toBe('sudden_death');
    expect(ctx.game.suddenIds.sort()).toEqual(['p0', 'p1']);
    ctx.ps[0].socket.trigger('exit');
    // Three humans remain, only p1 is left of the tied: p1 wins.
    expect(ctx.game.phase).toBe('match_over');
    expect(ctx.ps[1].socket.events('match.over')[0].args[0].winner).toBe('p1');
  });

  it('stop() clears every timer and nothing fires afterwards', () => {
    const ctx = startBrawl(4);
    ctx.ps[1].player.hp = 1;
    hit(ctx, 0, 1);
    advance(ctx, 13000);
    expect(ctx.game.centralPending).not.toBeNull();
    ctx.game.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.game.centralPending).toBeNull();
    const emitted = ctx.ps[0].socket.emitted.length;
    vi.advanceTimersByTime(60000);
    expect(ctx.ps[0].socket.emitted.length).toBe(emitted);
  });

  it('resetToLobby and match over leave no brawl timers or pending state behind', () => {
    const ctx = startBrawl(3);
    advance(ctx, 13000);
    ctx.game.resetToLobby();
    expect(ctx.game.centralPending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.game.phase).toBe('lobby');
  });
});
