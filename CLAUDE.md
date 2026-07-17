# CLAUDE.md — Navigation guide for Jet Lag: Vila Real

This file is for AI assistants. Read it before touching anything else.

---

## What this project is

A self-serve referee PWA for a walking-only Capture the Flag game played in Vila Real, Portugal, inspired by the YouTube show *Jet Lag: The Game*. 4–8 players split into two teams, each hiding a flag among decoy landmarks. Teams hunt each other's flag using intel cards, slow each other with curses, and physically tag raiders. The app is the referee: it enforces geofences, manages coins and timers, adjudicates flag photos, and runs the Tag button.

**No human GM. No native app. Just a Next.js PWA + Supabase.**

---

## Read these first (in order)

| File | What it is |
|---|---|
| `RULEBOOK.md` | Complete game rules — the source of truth for all business logic |
| `ARCHITECTURE.md` | Full technical spec: DB schema, API routes, realtime channels, key flows |
| `data/landmarks.json` | Seed landmark catalog (GPS coords, team pool, kind) |
| `data/challenges.json` | 18 challenges with coin rewards and location refs |
| `data/curses.json` | 16 curses with enforcement category [A/B/C/L] and params |
| `data/intel.json` | 9 intel card types with costs and reveal descriptions |

---

## Project structure

```
/
├── CLAUDE.md              ← you are here
├── RULEBOOK.md            ← game rules
├── PLAYER_GUIDE.md        ← printable one-page player reference
├── ARCHITECTURE.md        ← technical architecture and implementation backlog
├── package.json           ← Next.js 15, Supabase SSR, Leaflet, Zustand, Zod
│
├── app/
│   ├── layout.tsx         ← root layout, PWA manifest link, i18n provider
│   ├── globals.css        ← Tailwind base + map-label styles
│   ├── page.tsx           ← landing: create / join game
│   ├── game/
│   │   ├── new/page.tsx           ← create form
│   │   ├── join/page.tsx          ← join-by-code form
│   │   └── [code]/
│   │       ├── page.tsx           ← server-side snapshot fetch + phase router
│   │       ├── Lobby.tsx          ← client lobby view
│   │       ├── Setup.tsx          ← flag setup phase view
│   │       └── Live.tsx           ← live game view (map/actions/status tabs)
│   ├── observer/          ← placeholder for future results view
│   └── api/games/
│       ├── route.ts                       ← POST  /api/games (create)
│       ├── by-code/[code]/route.ts        ← GET   /api/games/by-code/[code]
│       └── [id]/                          ← 26 routes covering all phases (incl. attempt-start, place-curse, trigger-placed-curse):
│           ├── join, switch-team, ready, start, remove-player
│           ├── flag-setup, setup-state, harden-flag
│           ├── live-state, tag, attempt-flag, complete-run, respawn-clear
│           ├── buy-intel, buy-curse, expire-curses, extend-curse (E15 frozen)
│           ├── challenges, submit-challenge, accept-challenge, reject-challenge (D14)
│           └── end-by-timeout
│
├── lib/
│   ├── cn.ts              ← clsx + tailwind-merge helper
│   ├── codes.ts           ← game code generator (4 chars, no I/L/O/0/1)
│   ├── device.ts          ← localStorage device_id management
│   ├── api.ts             ← apiGet / apiPost fetch wrappers
│   ├── types.ts           ← shared DB and API contract types
│   ├── landmarks.ts       ← landmark seed lookup helpers
│   ├── supabase/
│   │   ├── client.ts      ← browser Supabase client
│   │   ├── server.ts      ← SSR server client (cookie stub — needs auth wiring later)
│   │   └── admin.ts       ← service-role client for server-side mutations
│   ├── hooks/             ← 9 client hooks:
│   │   ├── useLobbyRealtime.ts          ← postgres_changes for lobby
│   │   ├── useLiveGameRealtime.ts       ← postgres_changes for live phase
│   │   ├── usePresence.ts               ← Realtime Presence for GPS
│   │   ├── useGPS.ts                    ← Geolocation API wrapper
│   │   ├── useTagButton.ts              ← Tag eligibility + cooldown
│   │   ├── useFlagAttemptButton.ts      ← Flag attempt eligibility
│   │   ├── useDiscoveredEnemyKinds.ts   ← derive enemy-kind reveals from events
│   │   ├── useCamping.ts                ← 50 m / 2 min camping detector
│   │   └── useCurseExpiryPoll.ts        ← 20 s poll → /expire-curses
│   ├── geo/
│   │   ├── haversine.ts   ← great-circle distance in metres
│   │   └── zones.ts       ← defense-zone proximity helper (200 m around own candidates)
│   ├── intel/
│   │   ├── narrowing.ts   ← compute ruled-out enemy refs from intel cards
│   │   └── overlays.ts    ← intel filter map overlays + out-of-bounds polygon
│   ├── i18n/
│   │   ├── context.tsx    ← React context + useT() hook (EN / PT-PT)
│   │   └── messages.ts    ← string catalog
│   └── results/
│       └── scoring.ts     ← end-game score / timeline derivation
│
├── components/
│   ├── ui/                ← Button, Input, LanguageSwitcher
│   ├── map/
│   │   └── GameMap.tsx    ← Leaflet map, dynamic-imported (no SSR)
│   └── game/              ← 14 phase-specific components:
│       ├── TagButton, FlagAttemptButton, HardenFlagButton
│       ├── IntelPurchasePanel, IntelCardDisplay
│       ├── CursePurchasePanel, ActiveCursesBanner, CurseHistoryList
│       ├── ChallengesPanel, ChallengeHistoryList
│       ├── RespawnBanner, FlagCarrierBanner, FlagFoundBanner
│       └── GameOverOverlay
│
├── store/
│   └── gameStore.ts       ← Zustand store for game/teams/players/me
│
├── data/                  ← static seed JSON (see above)
│
└── supabase/migrations/   ← 11 migrations (0001–0011):
    ├── 0001_init.sql              ← initial schema (9 tables, append-only events trigger)
    ├── 0002_adjustments.sql       ← game_code, flag_carrier, captain→host, setup status
    ├── 0003_realtime_publication.sql
    ├── 0004_host_role.sql
    ├── 0005_events_allow_actor_cascade.sql
    ├── 0006_events_allow_cascade_delete.sql
    ├── 0007_player_respawning.sql
    ├── 0008_rls_baseline.sql      ← RLS enabled on all tables
    ├── 0009_flag_attempt_photos.sql ← public `flag-attempts` Storage bucket + policies
    ├── 0010_placed_curses.sql     ← hidden placed_curses table (no anon RLS, not broadcast)
    └── 0011_challenge_photos.sql  ← public `challenge-photos` Storage bucket (D14 peer review)
```

> ⚠️ **Migrations `0009` + `0010` + `0011` may not be applied yet** — flag-attempt photo upload, placed curses, and challenge peer-review photo upload fail without them. Run `supabase db push` locally and on hosted Supabase.

---

## Domain concepts (from RULEBOOK.md)

| Term | Meaning |
|---|---|
| **Home base** | Each team's anchor landmark: Team West = UTAD, Team East = Casa de Mateus |
| **Candidate landmark** | One of 5 landmarks a team selects; holds their real flag, decoys, or nothing |
| **Flag carrier** | Player who photographed the real flag; must reach home base geofence to win |
| **Raider** | Player physically outside their own defense zone |
| **Defender** | Player physically inside their own defense zone (within 200 m of any own candidate) |
| **Defense zone** | 200 m radius around each own candidate landmark; union defines where you can tag |
| **Tag** | Defender within 5 m of raider AND inside own defense zone → Tag button activates → tagged raiders lose 1 intel card and must respawn at neutral landmark |
| **Intel card** | Purchased clue about enemy flag location; max 4 per team per game |
| **Curse** | Purchased handicap applied to enemy team; 3 tiers (minor/medium/major) rolled with dice |
| **Enforcement tier** | [A] GPS-verified, [B] photo-verified, [C] honor system, [L] ledger-only |
| **Challenge** | Location-based task that earns coins; 3 active at a time, refreshed on completion |
| **Decoy** | Fake marker at a candidate landmark; photographing it loses all intel |
| **Harden** | Team spends 150 coins to make their own flag challenge harder; once per game |
| **Camping rule** | Defenders cannot stay within 50 m of own candidate landmarks for > 2 min |

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router, TypeScript) | Server Components default; client components only where needed |
| Styling | Tailwind v3 + clsx/tailwind-merge | Dark theme (`neutral-950` background) |
| State | Zustand v5 | `store/gameStore.ts` — single store, client-side only |
| DB / Auth | Supabase (Postgres + anon auth) | Anonymous sign-in, no passwords |
| Realtime | Supabase Realtime | Presence for GPS, postgres_changes for events |
| Storage | Supabase Storage | Photo uploads (flag attempts, challenge proofs, curse proofs) |
| Maps | Leaflet + react-leaflet | Dynamic import (no SSR). Tiles: **Carto Voyager** (gamified look). Remember: `import 'leaflet/dist/leaflet.css'` |
| Validation | Zod | All API route inputs |
| Geo math | Custom (`lib/geo/`) | haversine, midline half detection, geofence radius |
| i18n | Custom React context (`lib/i18n/`) | EN + PT-PT (Portugal). `useT()` hook. Toggle in lobby and live header. |
| Deploy | Vercel | Free tier sufficient |
| DB jobs | pg_cron (Supabase) | Curse expiry every 30 s — currently replaced by client poll, see backlog item 12 |

---

## Key architectural decisions

1. **Events table is append-only** — guarded by a Postgres trigger. Do not try to UPDATE or DELETE events. All state is derived from events.
2. **`teams.coins` is a materialized counter** — updated in the same transaction as the event insert. Don't recount from events every request.
3. **GPS positions are ephemeral** — stored only in Supabase Realtime Presence, never in the DB. Presence state is the input to Tag button logic.
4. **Tag has a GPS tolerance** — clients use 5 m for display; server validates at 10 m to account for GPS drift in narrow streets.
5. **Flag kind is hidden by RLS** — the enemy team cannot read `landmarks.kind`. Server reads with service role key when adjudicating a flag attempt.
6. **Captain role is removed** — every player buys intel and casts curses. The `players.role` column in migration 0001 still contains `captain` — fix in 0002.
7. **No separate backend** — everything is Next.js API routes + Supabase. No separate Node server, no WebSocket server.

---

## Current state (as of this writing)

### Done
- Game rules fully documented (`RULEBOOK.md`, `PLAYER_GUIDE.md`)
- Architecture fully documented (`ARCHITECTURE.md`)
- Database migrations `0001`–`0010` (9 base tables + placed_curses, append-only events trigger, host role, respawning flag, RLS baseline, flag-attempt Storage bucket)
- Static seed data (`data/`)
- Next.js scaffold (config, Tailwind, Supabase clients, PWA manifest)
- **Full game flow** — lobby → setup → live → results (see backlog steps 1–11 below)
- **i18n** — EN + PT-PT via `lib/i18n/`, language toggle in lobby and live header (commit `4fe06f2`)
- **Map polish** — Carto Voyager basemap, tooltips on click only, legend at `top-24 left-3` to clear the GPS toggle and bottom action stack (commits `8da6921`, `8fe574b`, `aa71835`)
- Live game view tabs: map / actions / status
- **Post-playtest fixes & mechanics (2026-05-31)** — see git history; PLAYTEST_TRIAGE.md was the working doc (deleted on completion):
  - Bug fixes: `useLiveGameRealtime` now subscribes to `teams`+`players` (respawn/coins/flag-carrier propagate); flag-attempt geofence drift buffer (28 m; 12 m hardened); replaced PWA-unreliable `window.confirm`/`prompt` with inline UI across Tag/Attempt/Challenge/Curse/Harden/Intel.
  - Curse enforcement: `lib/hooks/useCurseEnforcement.ts` — Full Stop action-lock, check-in/photo prompts, [A] movement readouts.
  - Flag attempt → structured mini-challenge (`data/flag-attempt-challenges.json`, real photo upload to the `flag-attempts` bucket) + 30-min protection window + 15-min per-landmark lockout. Hardening = tighter GPS radius (no info leak).
  - Discovery notifications: `useGameToasts` + `ToastLayer` (two-stage attempt toasts + enemy-proximity ping); new `flag_attempt_started` event + `/attempt-start` route.
  - Placed curses (3rd category): `placed_curses` hidden table, `/place-curse` + `/trigger-placed-curse` routes, `data/placed-curses.json`, `PlacedCursePanel` (setup + live), `usePlacedCurseTrigger`.
  - Map redesign: Mateus removed, East home → Biblioteca Municipal, out-of-bounds disk recentred on the avenue (1.5 km), `SetupMap` planning view, intel I9 removed + decoy-reveal repriced to 100, "Rejoin last game" button.
- **Post-playtest round 2 (2026-07-17)** — branch `post-playtest-round2`, 9 themed commits. All items verified via `tsc` + `next build` + 59 unit tests; live GPS/multi-client field test still pending (Rancher was down at implementation time):
  - **Coordinates**: audited all 22 landmarks vs OSM/Nominatim; corrected 9 (Biblioteca Municipal East home, Escola São Pedro, Geosciences Museum, Mercado, Igreja da Conceição, Ponte Metálica, Estação Rodoviária, Jardim Botânico, Largo do Pioledo); Câmara regrouped East.
  - **Map**: `fitBounds` on the play disk (was offset ~1.5 km E); challenge **star markers** (`useActiveChallenges`); **enemy radar** — enemies shown only inside your defense zones, pulsed via `lib/geo/radar.ts` (RADAR_CONFIG 5s on/15s off) with CSS sweep; `usePresence` now retries on failed subscribe (the real "only creator sees enemies" cause); map action stack raised above Leaflet panes (C12).
  - **Notifications (F18-20)**: one bug — `useGameToasts`/`useGameMoments` seeded against empty pre-snapshot events (history replay) + `setLiveSnapshot` replaced events (dropped live ones). Fixed with a `ready` gate + event **merge** in the store.
  - **Curses**: E15 Frozen countdown gates on being in place + `/extend-curse` route so wandering prolongs it; E16 check-in `submission_window_seconds` + tap-to-ack in `ActiveCursesBanner`; E17 Hot/Cold is now a **live** thermometer (server stamps real-flag coords in `intel.hot-cold` payload — a deliberate balance change).
  - **Confirm-spend (G21)**: `ConfirmSpendModal` on all 4 spends (intel/curse/harden/placed).
  - **Challenge peer review (D14)**: photo challenges → `pending` card state → other team accept/reject (`/accept-challenge`, `/reject-challenge`, `lib/server/challengeAward.ts`), reject→resubmit, event-driven `ChallengeReviewPanel` + review toast; new `challenge-photos` bucket (migration 0011).
  - **Chat (G22)**: `useChat` + `ChatPanel` — ephemeral Supabase-broadcast chat, global + private per-team channels, unread badge; NOT persisted / not in results.
  - **Setup (A1-A4)**: visible team-tinted select on join; map-first flag selection in `SetupMap` (tap to cycle role, color-coded, permanent labels, Map/List toggle) with the list kept as fallback.

### Implementation backlog (ordered)
See `ARCHITECTURE.md §9` for the full ordered backlog. Headline:
1. ~~Migration 0002~~ ✅
2. ~~Create / join game flow~~ ✅
3. ~~Flag setup UI~~ ✅
4. ~~Live game view shell + realtime wiring~~ ✅
5. ~~Tag button + respawn~~ ✅
6. ~~Flag attempt route + win + harden~~ ✅
7. ~~Intel purchase (9 types) + map narrowing + overlays~~ ✅
8. ~~Curse buy + expiry + active-curse banner~~ ✅
9. ~~Challenges + first-blood bonus~~ ✅
10. ~~Results / timeline / end-by-timeout~~ ✅
11. ~~RLS policies (baseline — see security posture above)~~ ✅
12. pg_cron curse expiry — **not blocking**, we replaced it with a 20-s client-poll on `/expire-curses` (lib/hooks/useCurseExpiryPoll.ts). Migrate to pg_cron in production for resilience when clients are offline.

### Known caveats
- Writes to `/hooks/` at repo root get silently nuked by something in the environment. Use `lib/hooks/` instead — confirmed to persist.
- `app/observer/` left in place as a placeholder for the future results view.
- React StrictMode is enabled and works with `react-leaflet@5`. If you ever downgrade leaflet, you'll re-hit the "Map container is already initialized" StrictMode double-mount bug.

### Security posture (after migration 0008)

**Locked down (v1):**
- RLS is **enabled** on all 9 tables.
- Anon-key clients cannot INSERT/UPDATE/DELETE any row. INSERT returns a 401 with an `42501` RLS violation; UPDATE/DELETE silently no-op (PostgREST returns 204).
- All server mutations go through API routes using `lib/supabase/admin.ts` (service-role key), which bypasses RLS.

**Still open (v1.1 hardening checklist):**
- Anon-key clients can still **SELECT** any row — needed so Realtime postgres_changes broadcasts keep flowing. This means a malicious client could read:
  - `landmarks.kind` / `hardened` of the enemy team (the live-state API hides them server-side, but a direct REST GET on `/rest/v1/landmarks` bypasses that)
  - `cards.payload` containing intel answers
  - `events.payload` containing flag-attempt results, curse params, intel refs, etc.
- For a friend-game this is acceptable. To close the gap:
  1. Enable Supabase anonymous auth and call `supabase.auth.signInAnonymously()` on join, then store the resulting `auth.users.id` on `players`.
  2. Rewrite the SELECT policies to scope by team-membership: e.g. `cards.team_id IN (select team_id from players where auth_user_id = auth.uid())`.
  3. For `events.payload` redaction, switch the client realtime subscription from `postgres_changes` to a **Supabase Broadcast** channel (server emits curated payloads per-team).

---

## Conventions

- Server Components by default; add `'use client'` only where GPS, Zustand, or event listeners are needed.
- No `any` types.
- API routes: validate with Zod, return `{ error: string }` with appropriate HTTP status on failure.
- All coin mutations: write event first, then update `teams.coins` in same transaction.
- Landmark refs: string IDs from `data/landmarks.json` (e.g. `"landmark.se-catedral"`).
- Challenge/curse/intel refs: string IDs from respective JSON files.
- Distances always in metres.
- Timestamps always `timestamptz` / JS `Date.now()` (ms since epoch) in presence payloads.

---

## Files NOT to touch without reading first

- `supabase/migrations/0001_init.sql` — only append new migrations, never edit this one.
- `data/*.json` — seed data, consumed by both API routes and client. Changing IDs is a breaking change.
- `RULEBOOK.md` §15 — all open questions are resolved; changes need discussion with the user.
