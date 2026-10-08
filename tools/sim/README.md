# Simulation harness (`tools/sim/`)

Drives real browser clients against the **local** dev server so the agent (or a
human) can verify the client-side features that need a browser + GPS + multiple
clients: enemy radar, live notifications, curses UI, chat, confirm-spend, and
the map-first setup.

It uses the **system Chrome** via Playwright (`channel: 'chrome'`), so no
browser download is required. Game state is set up through the API (fast, and
already verified) and each browser "becomes" a player by seeding its
localStorage `device_id`. GPS is fully controllable per client
(`context.setGeolocation`), so you can move clients between positions.

## Prerequisites

1. Local Supabase running with all migrations applied:
   ```
   supabase start && supabase db reset   # or: supabase migration up
   ```
2. Dev server on port 3001 (or set `SIM_BASE`):
   ```
   WATCHPACK_POLLING=true npm run dev
   ```
3. `npm i` (installs the `playwright` devDependency) and a system Google Chrome.

## Run a scenario

```
node tools/sim/scenario-smoke.mjs           # live map: framing, challenge stars, buttons (C9/C10/C12)
node tools/sim/scenario-map-boundary.mjs    # fixed map fence + far-outside GPS recovery edge
node tools/sim/scenario-radar.mjs           # enemy radar pulse + zone-gating (C11)
node tools/sim/scenario-notifications.mjs  # no history replay + live toast (F18-F20)
node tools/sim/scenario-chat.mjs           # global live + team-channel isolation (G22)
node tools/sim/scenario-confirm-spend.mjs  # confirm-spend modal (G21)
node tools/sim/scenario-curses.mjs         # Frozen gated countdown + extend + check-in ack (E15/E16)
node tools/sim/scenario-curse-proofs.mjs   # private timed [B] proof upload, privacy, reload receipt
node tools/sim/scenario-camping.mjs        # reload-safe server camping lock, cooldown, pause, direct tag
node tools/sim/scenario-setup.mjs          # join select + map-first flag setup (A1-A4)
node tools/sim/scenario-lobby-ui.mjs       # strict UI create/join/switch/kick/2v2/start + private setup photo
node tools/sim/scenario-terminal-variants.mjs # West win + timeout points/tiebreak/tie + PT results
node tools/sim/scenario-i7-intel.mjs        # private setup surroundings photo + signed I7 + live Hot/Cold
node tools/sim/scenario-challenge-review-ui.mjs # actual PNG reject/resubmit/accept + first blood/log proof
node tools/sim/scenario-deep-snapshots.mjs # >50 pending review + >200 paginated authoritative results
node tools/sim/scenario-observer-pwa.mjs   # spectator realtime + install assets/service worker
node tools/sim/scenario-api-rules.mjs      # API concurrency, catalog, proof, pause, respawn, terminal stress
node tools/sim/scenario-realtime-resilience.mjs # reconnect + missed-event + multi-client Frozen recovery
node tools/sim/scenario-curse-protocols.mjs # movement/action-lock curse protocols
node tools/sim/scenario-hidden-reconcile.mjs # harden + placed-curse hidden-state reconciliation
node tools/sim/scenario-tag-raider.mjs     # defense-zone tag, stale GPS, multi-target respawn
node tools/sim/scenario-weather-pause.mjs  # two-team pause/resume + timer/observer freeze
node tools/sim/scenario-push.mjs           # explicit opt-in + subscription/server persistence boundary
node tools/sim/scenario-curse-stacking.mjs # two curses at once: both action locks, Frozen+Pilgrimage, placed-curse block/refire, ledger boundaries, curses at game end
node tools/sim/scenario-endgame-edges.mjs  # empty game, 0-0 coin flip, /results pagination, stripped-carrier scoring, observer-state redaction
```

Run the complete release matrix (all strict scenarios plus 1v1, 2v2, 3v3, and 4v4 walkthroughs):

```
npm run test:e2e
```

To resume a release run after fixing one scenario, name the first scenario to
run (the named scenario and everything after it will execute):

```
SIM_START_AT=scenario-camping.mjs npm run test:e2e
```

### Full-game walkthrough (any team size)

```
node tools/sim/walkthrough.mjs 1   # 1v1
node tools/sim/walkthrough.mjs 2   # 2v2
node tools/sim/walkthrough.mjs 3   # 3v3
node tools/sim/walkthrough.mjs 4   # 4v4
```

Plays a complete game with N players per team (valid values: 1–4) and asserts the rule set
(15 checks): lobby+setup, time bonus, intel + cap, curse cast, placed curse,
challenge peer review, live chat, enemy radar (N blips), multi-raider tag in a
single tap + respawn, Buddy-Up team-spread readout (N≥2), flag attempts
(decoy → 50-coin team fine, possibly into debt, with intel retained + lockout;
empty → lockout; real → carrier), and the win
(carrier returns to home base → game over + scoreboard). Uses the DB to
backdate `started_at` (opens the 30-min attempt window) and fund spends.

Screenshots land in `tools/sim/shots/` (gitignored).

## Building new scenarios

`harness.mjs` exports the reusable pieces:

- `setupLiveGame(tag)` → `{ gid, code, wPlayer, ePlayer, wTeam, eTeam, wDevice, eDevice }`
  (create → join → ready → start → flag-setup → **live**).
- `launchBrowser()` → a headless system-Chrome instance.
- `makeClient(browser, { deviceId, lat, lng, locale })` → a client with:
  `goto(path)`, `setPos(lat, lng)`, `enableGps()`, `tab(name)`, `shot(file)`,
  plus `.page` / `.context` for arbitrary Playwright calls.
- `coord(ref)`, `apiGet`, `apiPost`, `sleep`, `WEST_ASSIGN`, `EAST_ASSIGN`, `BASE`, `SHOTS`.
