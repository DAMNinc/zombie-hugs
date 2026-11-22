# Easter eggs (maintainers only)

Hidden by design: not mentioned in the in-game UI, landing page or README. All eggs are cosmetic and client-local: they never change gameplay, score, ELO, hp or any server state, send no socket events, and `lib/controller.ts` is not involved.

In-game eggs (a, d) are desktop-keyboard only, for players and spectators. They only fire while the game is in the active phase (between `game.start` and `round.end` / `round.reset` / `match.over` / `game.countdown`), never while an input/textarea/select/contenteditable is focused or a bootstrap modal is open. Each egg lasts < 10 s, has a cooldown >= 10 s, and cleans up all DOM nodes and timers.

## (a) Konami code
- Trigger: during a game, ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a.
- Effect: for 7 s every creature on screen (including ones spawning meanwhile) cycles through hues, plus a short rising `'fanfare'` (~1.2 s).
- Safety: the egg turns off `vertexColors` on each creature's per-instance material and sets `material.color` from HSL each animation frame; cleanup restores `vertexColors = true` and the original colour (white) on every touched material, also if the creature was removed or the phase ended early. Arrow keys / b / a still reach `camController`. Cooldown 10 s.
- Code: `src/client/easterEggs.ts` (`konamiEgg`, `runDisco`; creatures come from `EggContext.getCreatures`, passed as `new EasterEggs(audio, () => gameState.zombies)` in `src/client/zombie.ts`), `'fanfare'` in `src/client/audio.ts`.

## (b) Title x5
- Trigger: click/tap the "Zombie Hugs" `h1` on the landing page 5 times within 3 s.
- Effect: 36 falling 🤗 / 🧟 emojis for about 5 s.
- Safety: overlay is `pointer-events: none`, removed after the animation; 12 s cooldown (also starts under `prefers-reduced-motion`, where nothing is shown by design). Works on touch.
- Code: `views/index.handlebars` inline script at the bottom of the file (not part of the vite bundle).

## (c) Rare special score (~1%)
- Trigger: a scored point (`zombie.out-of-bounds`), `Math.random() < 0.01`.
- Effect: a random silly hug line replaces the normal "X scored!" killfeed entry (pink), plus a short two-note 'hug' chirp (~0.4 s) alongside the normal score sound.
- Safety: client-local and cosmetic; only while the egg system is in the active phase (`EasterEggs.isActive()`); at least 10 s between specials; no effect on score, state, sockets or replay.
- Code: `rareScore()` in `src/client/easterEggs.ts` (random and clock injectable), called from the score handler in `src/client/zombie.ts`; sound `'hug'` in `src/client/audio.ts`.
- Dev: to force it, temporarily edit `RARE_SCORE_CHANCE` or override `Math.random` in devtools; never commit that.

## (d) "brains"
- Trigger: type b-r-a-i-n-s in sequence during a game (letters only; the sequence resets after a gap of more than 2 s).
- Effect: zombie groan (procedural `'groan'` sound, ~1.2 s) and a ~2.5 s greenish full-screen tint (fixed div, `pointer-events: none`, z-index 9980: above the canvas, below the HUD at 9990+).
- Safety: the listener only observes, so `a`/`s` still reach `camController` and move the player; cooldown 10 s.
- Code: `src/client/easterEggs.ts` (`brainsEgg`), `'groan'` in `src/client/audio.ts`, hooks in `src/client/zombie.ts` (`easterEggs.setPhase`).

## How to add an egg
1. In `src/client/easterEggs.ts`, write an effect `function run(ctx: EggContext): () => void` that starts the effect and returns a cleanup removing every DOM node/timer/material change.
2. Add one `Egg` entry to the `EGGS` array: `{ id, cooldownMs (>= 10000), durationMs (< 10000), match(keys), run }`. `keys` is the rolling buffer of normalized key names (letters lower-cased, arrows as `ArrowUp` etc.); use `endsWith(keys, [...])`.
3. Gating, the buffer, cooldowns, the "one egg at a time" guard and guaranteed cleanup are handled by the `EasterEggs` class. Add new sounds to `SoundName` and the switch in `src/client/audio.ts`.
