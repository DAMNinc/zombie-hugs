import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Socket } from 'socket.io';
import controller, { Game, Zombie, getElo, fireDelayFromCode } from '../../lib/controller';
import { ARENA_HALF_WIDTH } from '../../lib/validate';
import { BotBrain } from '../../lib/bot';
import { FakeSocket } from './helpers';

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

/** A solo room with the human ready and the match running (update loop ticking on fake timers). */
function soloMatch(name: string) {
  const game = new Game(7000 + Math.floor(Math.random() * 1e6), 'bot-test');
  controller.games[game.id] = game;
  const human = new FakeSocket(name);
  controller.setupSocket(human as unknown as Socket);
  human.trigger('join.player', { gameId: game.id });
  game.start();
  human.trigger('ready');
  vi.advanceTimersByTime(3000);
  game.hazards = [];
  game.lastPowerUpSpawn = Date.now() + 1e9; // no power-ups
  game.spawnPowerUp = () => {}; // later rounds reset lastPowerUpSpawn; keep power-ups off for the whole test
  const bot = Object.values(game.players).find(p => p.isBot)!;
  return { game, human, bot };
}

/** Advances fake time in 1 s steps while the human answers pings, so the room does not drop them. */
function advance(human: FakeSocket, ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    human.trigger('pingpong');
    vi.advanceTimersByTime(Math.min(1000, ms - t));
  }
}

const botZombies = (game: Game, botId: string) => Object.values(game.zombies).filter(z => z.firedByPlayer === botId);

describe('solo practice bot', () => {
  it('fires creatures and moves within bounds over time', () => {
    const { game, human, bot } = soloMatch('bot-a');
    expect(game.phase).toBe('playing');
    const fires: string[] = [];
    const orig = game.emitAll.bind(game);
    game.emitAll = (event: string, ...args: any[]) => {
      if (event === 'zombie' && args[1] === bot.id) fires.push(args[0].id);
      return orig(event, ...args);
    };
    const xs: number[] = [];
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) human.trigger('pingpong');
      vi.advanceTimersByTime(100);
      xs.push(bot.position.x);
    }
    expect(fires.length).toBeGreaterThan(0);
    expect(new Set(xs).size).toBeGreaterThan(1);
    expect(xs.every(x => Math.abs(x) <= ARENA_HALF_WIDTH)).toBe(true);
    game.stop();
  });

  it('respects fire delays: every shot is at least its weapon\'s delay after the previous one', () => {
    const { game, human, bot } = soloMatch('bot-b');
    const volleys: Array<{ time: number; weapon: number; rapid: boolean }> = [];
    const orig = game.emitAll.bind(game);
    game.emitAll = (event: string, ...args: any[]) => {
      if (event === 'zombie' && args[1] === bot.id && volleys.at(-1)?.time !== Date.now()) {
        volleys.push({ time: Date.now(), weapon: args[0].weaponCode, rapid: bot.hasPowerUp('rapid_fire') });
      }
      return orig(event, ...args);
    };
    advance(human, 30000);
    expect(volleys.length).toBeGreaterThan(5);
    for (let i = 1; i < volleys.length; i++) {
      expect(volleys[i].time - volleys[i - 1].time).toBeGreaterThanOrEqual(fireDelayFromCode(volleys[i].weapon) * (volleys[i].rapid ? 0.5 : 1));
    }
    // Variety: more than one weapon over half a minute.
    expect(new Set(volleys.map(v => v.weapon)).size).toBeGreaterThan(1);
    game.stop();
  });

  it('never sends a shot the server would drop (weapon chosen only when its delay has elapsed)', () => {
    const { game, bot } = soloMatch('bot-b2');
    game.botBrain!.dispose();
    const brain = new BotBrain(game, bot, { rng: () => 0.99 });
    brain.tick(); // arms
    vi.setSystemTime(Date.now() + 2600);
    // The last shot was 1.3 s ago: the rng would pick the last weapon (horde, 3000 ms), which is not ready yet.
    bot.lastFireTime = Date.now() - 1300;
    const before = botZombies(game, bot.id).length;
    brain.tick();
    expect(botZombies(game, bot.id).length).toBeGreaterThan(before);
    expect([1, 3]).toContain(bot.weaponCode);
    game.stop();
  });

  describe('BotBrain decisions', () => {
    function brainFor(name: string, rngValue: number) {
      const { game, bot } = soloMatch(name);
      game.botBrain!.dispose();
      const brain = new BotBrain(game, bot, { rng: () => rngValue });
      brain.tick(); // arms the round
      vi.setSystemTime(Date.now() + 3000); // past the first fire time, no game timers run
      return { game, bot, brain };
    }
    const enemy = (game: Game, x: number, z: number, weapon = 1) => {
      const z0 = new Zombie('enemy', { x, y: 0, z }, 1, 'human', 1, weapon, 0);
      game.zombies[z0.id] = z0;
    };

    it('answers an incoming flamingo with a flamingo', () => {
      const { game, bot, brain } = brainFor('bot-c1', 0.1);
      enemy(game, 0, 0, 3);
      brain.tick();
      const shots = botZombies(game, bot.id);
      expect(shots.length).toBeGreaterThan(0);
      expect(shots.every(z => z.weaponCode === 3)).toBe(true);
      game.stop();
    });

    it('steers towards the x of the nearest incoming creature (arrow keys the client understands)', () => {
      const right = brainFor('bot-c2', 0.1);
      enemy(right.game, 300, 0);
      right.brain.tick();
      expect(right.bot.right).toBe(true);
      expect(right.bot.left).toBe(false);
      right.game.stop();

      const left = brainFor('bot-c3', 0.1);
      enemy(left.game, -300, 0);
      left.brain.tick();
      expect(left.bot.left).toBe(true);
      expect(left.bot.right).toBe(false);
      left.game.stop();
    });

    it('raises the shield when a creature is close and the roll succeeds, not when it fails', () => {
      const yes = brainFor('bot-c4', 0.1);
      enemy(yes.game, 0, 700);
      yes.brain.tick();
      expect(yes.bot.shield.active).toBe(true);
      yes.game.stop();

      const no = brainFor('bot-c5', 0.9);
      enemy(no.game, 0, 700);
      no.brain.tick();
      expect(no.bot.shield.active).toBe(false);
      no.game.stop();

      const far = brainFor('bot-c6', 0.1);
      enemy(far.game, 0, 0);
      far.brain.tick();
      expect(far.bot.shield.active).toBe(false);
      far.game.stop();
    });
  });

  it('stops acting after lobby.return and after stop(); a bot-only room is still cleaned up', () => {
    const { game, human, bot } = soloMatch('bot-d');
    advance(human, 5000);
    human.trigger('lobby.return');
    expect(game.phase).toBe('lobby');
    expect(game.botBrain).toBeNull();
    const before = Object.keys(game.zombies).length;
    vi.advanceTimersByTime(10000);
    expect(Object.keys(game.zombies).length).toBe(before);
    expect(Object.values(game.players).some(p => p.isBot)).toBe(false);

    const s = soloMatch('bot-e');
    s.game.stop();
    expect(s.game.botBrain).toBeNull();
    const n = Object.keys(s.game.zombies).length;
    vi.advanceTimersByTime(10000);
    expect(Object.keys(s.game.zombies).length).toBe(n);

    // Room cleanup: nobody but a bot is left.
    const c = soloMatch('bot-f');
    c.human.trigger('exit');
    c.game.lastActivity = Date.now() - 120000;
    c.game.removeIfAbandoned();
    expect(controller.games[c.game.id]).toBeUndefined();
    void bot;
  });

  it('a full solo match ends with mode solo, ranked false and no ELO change', () => {
    const { game, human, bot } = soloMatch('bot-g');
    const humanId = 'bot-g';
    const eloBefore = [getElo(game.players[humanId].name), getElo(bot.name)];
    const overs: any[] = [];
    const orig = game.emitAll.bind(game);
    game.emitAll = (event: string, ...args: any[]) => {
      if (event === 'match.over') overs.push(args[0]);
      return orig(event, ...args);
    };
    // The bot's creatures run unopposed into the human until somebody wins the match.
    for (let i = 0; i < 3000 && overs.length === 0; i++) {
      if (i % 10 === 0) human.trigger('pingpong');
      vi.advanceTimersByTime(100);
      game.players[humanId].shield.active = false;
    }
    void human;
    expect(overs).toHaveLength(1);
    expect(overs[0]).toMatchObject({ mode: 'solo', ranked: false });
    expect([getElo(game.players[humanId].name), getElo(bot.name)]).toEqual(eloBefore);
    game.stop();
  });
});
