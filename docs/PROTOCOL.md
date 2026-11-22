# Room protocol (issue #137)

Contract between the game server (`lib/controller.ts`) and the client. Parts marked **[brawl rules]** are
owned by the brawl tasks and are not implemented by the room code; everything else is.
Existing events not mentioned here keep their current shape. New payload fields are additive: old
fields stay so the duel client keeps working.

## Seats, modes, colours
- A room has 4 seats (0–3). `mode` at match start is decided by the number of seated players:
  1 → `solo` (a server bot takes seat 1), 2 humans → `duel` (existing rules, ranked/ELO), 3–4 → `brawl` (unranked).
- Seat colours (Okabe-Ito, colour-blind safe), also shown with the seat number 1–4 as a label:
  seat 0 `#0072B2` blue, seat 1 `#D55E00` vermillion, seat 2 `#F0E442` yellow, seat 3 `#009E73` green.
- Duel/solo geometry is unchanged: seat 0 → direction -1 at z=-1000, seat 1 → direction 1 at z=+1000.
- Brawl geometry: square arena; seat 0 edge `N` (z=-1000), seat 1 `S` (z=+1000), seat 2 `W` (x=-1000), seat 3 `E` (x=+1000).
  Full rules in "Brawl geometry" below; `edge` is in the player payload.

## Joining
- client → `join.player` `{ gameId, token? }`
  - seated (lobby phase and a free seat, or a valid reconnect token): server → `player` (existing payload plus
    `seat`, `color`, `edge`, `isBot:false`, `connected`, `token`). The client stores `token` in sessionStorage
    under `zombieHugsSeat:<gameId>` and sends it back on reload/reconnect. `token` is private: it is only in the
    owner's `player` payload, never in `opponent`, `state` or `lobby`.
  - `token` matches a seat (even if that seat's old socket has not been seen closing yet): the seat is rebound to
    this socket, see Reconnect. A token that matches nothing is ignored and the join is a normal one.
  - A player's `id` is the id of the socket it first joined with and never changes, also after a reconnect on a
    new socket (so do not compare it with `socket.id`).
  - Seats are the lowest free number. When the match starts as `solo` or `duel` the humans are moved to seats
    0/1 (north/south) if they sat elsewhere; then the server re-sends `player` (own, new seat/colour/edge/position)
    and `opponent` for everyone before `game.countdown`. Handle repeated `player`/`opponent` events as updates.
  - match in progress, or 4 seats taken: the socket becomes a queued spectator: server → `join.queued` `{ position }`
    (1-based), then the normal spectator stream (state, hazards, power-ups, `opponent` per seated player, `lobby`).
    `join.queued` is sent again with the new position whenever the queue changes. `join.error.full` is no longer
    sent (the client may keep its handler).
- client → `join.spectator` `{ gameId }`: plain spectator, never queued (unchanged).
- Queued spectators take free seats in join order whenever the room enters `lobby` (return to lobby, rematch,
  or the room goes back to the lobby after a player left). The promoted socket gets `player` (with `seat`,
  `token`) and the usual `opponent`s, the others get `opponent` for it. Promoted players start unready (after a
  rematch everyone is ready). Queued spectators leave the queue when they disconnect. A queued socket cannot
  act as a player and cannot send `join.player`/`join.spectator` again.

## Lobby
- server → `lobby` (broadcast to everyone in the room on any seat, ready, queue, connection or phase change):
  ```
  { phase, mode,             // mode the room would start in now: 'solo' | 'duel' | 'brawl'
    seats: [ { seat, id, name, color, ready, connected, isBot } | null, ×4 ],
    queue: [ { id, name } ],
    invitePath: '/game/<id>' }
  ```
- client → `ready` (no args): ready = true (existing). client → `unready`: ready = false (lobby phase only).
- The countdown starts when every seated human is ready and at least one human is seated. With one human
  the bot is added to seat 1 and the match is `solo`. `mode` is decided when the countdown starts and stays for
  the whole match (all rounds). A human who joins a seat after others are ready delays the start until they are
  ready too.
- Whenever the room goes back to the lobby (a player left a duel/solo match, `lobby.return`) the remaining
  humans are unready and must press Ready again. A human whose connection dropped (held seat) is removed at
  once (`player.exit`) when the room enters the lobby. When the last unready human leaves the lobby and everyone
  left is ready, the countdown starts. The bot is removed with `player.exit` `(botId)`.
- client → `lobby.return`: allowed in `match_over`; also allowed any time during a `solo` match (to let a
  waiting friend in). Everybody goes to `lobby`, ready = false, bot removed, queue fills free seats.
  server → `game.reset` then `lobby`. Ignored in other phases (a duel or brawl in progress).
- client → `rematch`: vote in `match_over` only; when every seated human voted (a human whose connection dropped
  still counts until their reconnect window ends), the queue fills free seats, `game.rematch` is sent and the
  next match starts at countdown with the new roster (mode re-decided, bot re-added for solo). Duel rematch
  stays as today.

## Match
- server → `game.countdown` (seconds) unchanged; server → `game.start` now has a payload
  `{ mode, ranked, arena: { kind: 'lane' | 'square' }, roundDurationMs? }` (roundDurationMs for brawl).
- state (`state`, every 200 ms) adds: `mode`, per player `seat`, `color`, `edge`, `isBot`, `connected`;
  **[brawl rules]** per player `targetId`, `alive` (false while knocked out), and `roundRemainingMs` and
  `standings` (see below). Zombies add `ownerId` (= firer), `targetId` (brawl), `vx`, `vz` (unit heading; duel:
  vx 0, vz = direction).
- client → `target.set` `(playerId)`: brawl only; must be another alive seated player, else ignored.
  server → `target` `(playerId, targetId)` broadcast (also when the server retargets). Default target: next
  seated, alive opponent clockwise (seat order 0→3→1→2→0, i.e. N→E→S→W); when the target exits or is knocked
  out (`alive:false`) it moves on to the next one clockwise. `target.set` is ignored in lobby/duel/solo, for a
  non-string id, an unknown id, yourself, or a player who is not alive.
- `fire` keeps its signature; in brawl the creature heads at the firer's current target (see Brawl geometry).
- server → `player.damage` `(playerId, hp, attackerId)` (attackerId added).
- server → `zombie.out-of-bounds` `(zombieId, firedByPlayerId, hitPlayerId | null)` (third arg added). Duel/solo:
  the other player. Brawl: the owner of the edge the creature left through (see Brawl geometry).
- `wall.place` payload gains `axis: 'x' | 'z'` (axis the wall extends along; duel/spectator walls `'x'`).
- Brawl geometry (implemented in `lib/arena.ts`; applies only when `mode === 'brawl'`, duel/solo are unchanged):
  - Square arena, `SQUARE_HALF` 1000: N z=-1000, S z=+1000, W x=-1000, E x=+1000; players face the centre
    (inward normal N +z, S -z, W +x, E -x). `position` stays a world {x,y,z}, start at lateral 0.
  - Lateral axis: N/S move along x, W/E along z, clamped to ±`EDGE_TRAVEL` 800. `move.start/end` keys are
    relative to the player's own view: left (-1/37/65) = to their left on screen, right (1/39/68) = to their
    right. World directions: N left=+x, S left=-x, W left=-z, E left=+z.
  - `fire (position, weaponCode, chargeTime?)`: the server reads the lateral coordinate from `position`
    (x for N/S, z for W/E), clamps it to the server's lateral ±150 and ±800, and spawns on the player's edge
    line. Heading = unit vector spawn → current target's position at fire time (inward normal without a target).
    Horde/synergy extras are spread along the lateral axis, sharing the heading.
  - Zombie payload: `vx`, `vz` (unit heading), `ownerId`, `targetId`. Creatures move `speed * heading`; foxes
    zig-zag perpendicular to the heading. Creatures of different owners collide, same owner never.
  - Out when |x| > 1150 or |z| > 1150; the axis with the larger excess names the edge. The owner of that edge
    is hit (1 damage, `player.damage (id, hp, attackerId)`, firer scores, `zombie.out-of-bounds (id, firer, ownerId)`)
    if they are seated, alive, connected and not the firer. Otherwise (empty edge, own edge, knocked out, held
    seat) the creature just disappears: no damage, no score, `hitPlayerId` null.
    A corner exit with equal excess on both axes counts as the N/S edge. Bots only exist in solo; brawl targeting and
    hits ignore bots. Brawl seats are compacted to 0..n-1 at match start (3 players → N, S, W).
  - `place.wall (lateral)`: lateral coordinate (x for N/S, z for W/E, ±800); wall 200 in front of the edge,
    extending along the lateral axis (`axis: 'x'` on N/S, `'z'` on W/E), blocks other owners' creatures within 50
    across its width/2. Shield: blocks other owners' creatures within 150 of the edge line and 300 laterally.
  - Hazards and normal power-ups spawn within ±800 on both axes.
  - Server hook for knockouts: a player with `alive === false` is skipped as target and as hit victim;
    `Game.refreshTargets()` re-targets everyone and broadcasts `target` (call it after changing `alive`).
- Brawl only **[brawl rules]** (owned by later tasks):
  - server → `standings` `[ { id, name, seat, color, score, hits, kos, captures } ]` sorted by score desc,
    on every score change (also in `state.standings`).
  - server → `player.ko` `{ id, by, respawnAt }`; server → `player.respawn` `(id)`.
  - central power-up: server → `powerup.telegraph` `{ id, position, spawnAt }` ~3 s before it appears, then
    the normal `powerup.spawn` with `central: true`; capturing it emits `powerup.collect` as today and scores.
  - server → `sudden.death` `{ mode: 'brawl', playerIds }` when time runs out with a tie at the top.
- Reconnect (every phase except `lobby`): when a seated human's socket closes, or they stop pinging for 5 s, the
  server keeps the seat for `RECONNECT_WINDOW_MS` = 15 s: `connected:false` in `lobby`/`state`, server →
  `player.disconnected` `{ id, until }` (`until` = epoch ms). The held seat does nothing: no firing, no
  movement. `join.player` `{ gameId, token }` on a new socket rebinds the seat (score, hp, round wins kept) and
  the server sends that socket `player`, `opponent` for everyone else, `hazards`, `powerup.spawn` for live
  power-ups and `elo`, and everybody `player.reconnected` `(id)` plus `lobby`. A `pingpong` from the original
  socket also revives a seat that was held for a ping timeout. The replaced socket is ignored for good.
  In `lobby` a disconnect or ping timeout frees the seat at once (`player.exit`).
  After the window the player leaves: `player.exit` `(id)`. Duel/solo then go back to the lobby (`game.reset`);
  a brawl continues while at least two humans remain; with one human left it ends: `match.over` brawl payload
  (`winner` = the remaining human, unranked) and `lobby` with `phase:'match_over'`, so rematch/`lobby.return`
  are offered. While a seated human is disconnected they cannot be damaged: a creature that would hit them is
  removed without damage or score (`zombie.out-of-bounds` with `hitPlayerId` null). A duel that ends while one
  of its players is disconnected changes no ELO. An explicit
  `exit` event leaves at once, with no window. No ELO change for leaving.
- A room with no seated humans and no spectators (queued ones included) is removed after 60 s; bots do not count as occupants.

## Results
- server → `match.over` adds `mode` and `ranked`. Duel payload otherwise unchanged (elo, leaderboard).
  Solo: `{ mode:'solo', ranked:false, winner, loser, roundWins, stats }` (no ELO change; the winner may be the
  bot, `winner`/`loser` are player ids).
  Brawl: `{ mode:'brawl', ranked:false, winner, roundWins, standings, stats }`. **[brawl rules]** `standings`
  currently has `score` and `hits` (creatures that scored); `kos`/`captures` are 0 until brawl scoring lands.
- `round.end` `scores` has an entry per seated player (two in duel/solo, as before).
- `lobby` is also sent when `phase` changes (countdown, start, match over, reset).
