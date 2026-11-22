import { vi } from 'vitest';
import type { Socket } from 'socket.io';
import { Game, Player } from '../../lib/controller';

export class FakeSocket {
  handlers: Record<string, Array<(...args: any[]) => void>> = {};
  emitted: Array<{ event: string; args: any[] }> = [];
  constructor(public id: string) {}
  on(event: string, fn: (...args: any[]) => void) {
    (this.handlers[event] ||= []).push(fn);
    return this;
  }
  emit(event: string, ...args: any[]) {
    this.emitted.push({ event, args });
    return true;
  }
  /** Simulate the client sending an event to the server. */
  trigger(event: string, ...args: any[]) {
    for (const fn of this.handlers[event] || []) fn(...args);
  }
  events(name: string) {
    return this.emitted.filter(e => e.event === name);
  }
}

export function makePlayer(id: string, name = id, z = -1000, direction = -1) {
  const socket = new FakeSocket(id);
  const player = new Player(socket as unknown as Socket, name, 0, 0, z, direction, 1);
  return { socket, player };
}

/**
 * Two players in a game: A at z=-1000 (dir -1), B at z=1000 (dir 1).
 * RULE: the ELO store in controller.ts is module-level and persists across tests in a file.
 * Any test that finishes a match (and so touches ELO) must pass names unique to that test.
 */
export function makeGameWithTwoPlayers(names: [string, string] = ['Alice', 'Bob']) {
  const game = new Game(1, 'test');
  const a = makePlayer('a', names[0], -1000, -1);
  const b = makePlayer('b', names[1], 1000, 1);
  game.joinPlayer(a.player);
  game.joinPlayer(b.player);
  return { game, a, b };
}

/** Get the game into the 'playing' phase through the public ready/countdown flow. */
export function startPlaying(opts: { names?: [string, string]; hazards?: boolean } = {}) {
  const ctx = makeGameWithTwoPlayers(opts.names);
  ctx.a.socket.trigger('ready');
  ctx.b.socket.trigger('ready');
  vi.advanceTimersByTime(3000);
  if (opts.hazards !== true) {
    // Hazards and power-ups are random; remove them so tests are deterministic.
    ctx.game.hazards = [];
  }
  // Suppress random power-up spawns (spawnPowerUp waits POWERUP_SPAWN_INTERVAL_MS from lastPowerUpSpawn).
  ctx.game.lastPowerUpSpawn = Date.now();
  return ctx;
}

/** A brawl in the 'playing' phase with n humans on seats 0..n-1 (N, S, W, E). */
export function startBrawl(n: 3 | 4 = 4) {
  const game = new Game(1, 'brawl');
  const ps = Array.from({ length: n }, (_, i) => makePlayer(`p${i}`));
  for (const p of ps) game.joinPlayer(p.player);
  for (const p of ps) p.socket.trigger('ready');
  vi.advanceTimersByTime(3000);
  game.hazards = [];
  game.lastPowerUpSpawn = Date.now();
  return { game, ps };
}

