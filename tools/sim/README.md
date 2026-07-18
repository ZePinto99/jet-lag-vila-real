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
node tools/sim/scenario-smoke.mjs          # live map: framing, challenge stars, buttons (C9/C10/C12)
node tools/sim/scenario-radar.mjs          # enemy radar pulse + zone-gating (C11)
node tools/sim/scenario-notifications.mjs  # no history replay + live toast (F18-F20)
node tools/sim/scenario-chat.mjs           # global live + team-channel isolation (G22)
node tools/sim/scenario-confirm-spend.mjs  # confirm-spend modal (G21)
node tools/sim/scenario-curses.mjs         # Frozen gated countdown + extend + check-in ack (E15/E16)
node tools/sim/scenario-setup.mjs          # join select + map-first flag setup (A1-A4)
```

### Full-game walkthrough (any team size)

```
node tools/sim/walkthrough.mjs 1   # 1v1
node tools/sim/walkthrough.mjs 2   # 2v2
node tools/sim/walkthrough.mjs 3   # 3v3
node tools/sim/walkthrough.mjs 4   # 4v4
```

Plays a complete game with N players per team and asserts the rule set
(15 checks): lobby+setup, time bonus, intel + cap, curse cast, placed curse,
challenge peer review, live chat, enemy radar (N blips), multi-raider tag in a
single tap + respawn, Buddy-Up team-spread readout (N≥2), flag attempts
(decoy → intel wiped + lockout, empty → lockout, real → carrier), and the win
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
