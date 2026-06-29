# Test Inventory

This inventory maps the project’s testable units to rule coverage, mocks, visual assertions, i18n expectations, and priority. Rule references point to `RULEBOOK.md`; architecture references point to `ARCHITECTURE.md`.

## Coverage Strategy

| Domain | Target | Current suite focus |
|---|---:|---|
| Game logic | 90% | Pure geo, intel, overlays, scoring, validation contracts |
| Hooks | 80% | GPS, Presence, Realtime, eligibility, camping, curse enforcement, placed curse triggers |
| Components | 60% | Critical action buttons/banners and status/result surfaces |

Priority scale: P1 critical rules or mutation paths, P2 important user feedback/state display, P3 nice-to-have display/history polish.

## Domain A: Game Logic

### `lib/geo/haversine.ts` — P1

What it does: calculates great-circle distance in metres for all proximity rules.

Test cases:
- Same coordinate -> `0` m.
- ~0.00009 latitude delta in Vila Real -> about 10 m.
- `distance(a,b) === distance(b,a)`.

Edge cases: identical inputs, very short distances, negative longitude.

Mocking strategy: none.

Rule references: §5.2 flag attempts, §6 tag/defense zones, §12 app referee.

### `lib/geo/zones.ts` — P1

What it does: determines whether a player is inside the 200 m defense-zone union around their own candidates.

Test cases:
- Position inside one own candidate radius -> `true`.
- Position on the 200 m boundary -> `true`.
- Position outside every candidate -> `false`.
- Empty candidate list -> `false`.

Edge cases: custom radius override, no landmarks, boundary rounding.

Mocking strategy: real `haversineMeters`.

Rule references: §6 tag rules.

### `lib/intel/narrowing.ts` — P1

What it does: derives enemy landmark refs known not to be the real flag from in-hand intel cards.

Test cases:
- Ignore non-intel and non-`in_hand` cards.
- `intel.north-south`: wrong city-centre half is ruled out.
- `intel.east-west`: wrong home-base side is ruled out; missing home longitude yields no narrowing.
- `intel.eliminate-one`, `intel.eliminate-two`, `intel.decoy-reveal`: named refs are ruled out.
- `intel.hot-cold`: landmarks outside distance bucket are ruled out.
- `intel.surroundings`: no mechanical narrowing.
- `intel.direction`: landmarks outside bearing bucket are ruled out.

Edge cases: malformed payloads from DB, duplicate cards, unknown future intel ref.

Mocking strategy: use `makeCard()` and small in-memory enemy landmark set; seed lookup may be stubbed.

Rule references: §8.3, §11.

### `lib/intel/overlays.ts` — P2

What it does: builds map overlay polygons for out-of-bounds area and geographic intel filters.

Test cases:
- Out-of-bounds overlay returns world ring plus play-area disk hole.
- `north-south` overlay covers wrong half-plane.
- `east-west` overlay skipped without home longitude.
- `hot-cold` bounded buckets create outer complement and inner disk overlays.
- Non-geographic intel creates no overlay.

Edge cases: `over_1km` bucket creates only inner disk; expired cards ignored; ring closure.

Mocking strategy: `makeCard()` factories only.

Rule references: §3.1 boundaries, §8.3, §11.

### `lib/results/scoring.ts` — P1

What it does: computes timeout points and resolves winner/tiebreakers.

Test cases:
- Real flag = 10 pts.
- Each challenge/tag = 1 pt.
- Each curse = 0.5 pt.
- `floor(coins / 50)` coin points.
- Timeout winner by total points.
- Tiebreak by challenges, then coins, then tied.

Edge cases: missing actor/team ids, single-team input, events for unknown players.

Mocking strategy: factories for teams, players, events.

Rule references: §13.2.

### API Route Zod Schemas — P1

What they do: validate all mutation/query contracts before server-side Supabase mutations.

Test cases:
- Create/join/switch/ready/start/remove-player accept required ids and reject missing device/player ids.
- Flag setup accepts exactly assignment array shape; route-level tests should also cover 1 real / 2 decoy / 2 empty business rule.
- Live-state/setup-state/challenges query schemas require `device_id`.
- Tag validates tagger position and target positions.
- Attempt-start/attempt-flag validate player, landmark, GPS, photo URL, and optional answer.
- Buy-intel/buy-curse validate known refs, dice counts, GPS where required.
- Harden, complete-run, respawn-clear validate player/device/GPS payloads.
- Place/trigger placed curse validate placement ref, landmark ref, player, GPS.
- Expire-curses validates device id.

Edge cases: invalid GPS accuracy, empty strings, unknown refs, wrong game status.

Mocking strategy: route handler tests should mock `createAdminClient()` and server Supabase chains, not `@supabase/supabase-js`.

Rule references: §4 phases, §5 flags, §6 tags, §7 coins, §8 decks, §12 app referee.

## Domain B: Hooks

### `lib/hooks/useLiveGameRealtime.ts` — P1

What it does: subscribes to Supabase `postgres_changes` for games, teams, players, events, active curses, and cards.

Test cases:
- Creates `live:{gameId}` channel and registers expected tables.
- Game update calls `setGame`.
- Team update calls `upsertTeam`.
- Player update is accepted only when player team belongs to this game.
- Event insert appends once.
- Active curse insert is accepted only when targeting my team.
- Active curse/card delete removes rows.
- No channel created without `gameId`.

Edge cases: `myTeamId` null skips cards binding; duplicate events; delete payload without old id.

Mocking strategy: mock `lib/supabase/client.ts` channel, emit stored callbacks, assert Zustand state.

Architecture references: §3.2, §5.1.

### `lib/hooks/useGPS.ts` — P1

What it does: wraps browser Geolocation and wake lock; throttles surface updates.

Test cases:
- Enabled hook calls `watchPosition` with high accuracy.
- Position success maps to `{ lat, lng, accuracy, updated_at }`.
- Permission/unavailable/timeout errors map to stable error strings.
- Unmount clears watch and releases wake lock.
- Disabled hook does not subscribe.

Edge cases: no `navigator.geolocation`, repeated tiny moves under throttle, elapsed-time publish after 5 s.

Mocking strategy: setup-level `mockGPS()`, fake timers/date for throttling, optional wake lock stub.

Rule references: §12.1 GPS-verified enforcement, §8 practical constraints.

### `lib/hooks/useTagButton.ts` — P1

What it does: derives tag eligibility and nearby enemy targets.

Test cases:
- No GPS -> `no_gps`.
- Respawning -> `respawning`.
- Outside defense zone -> `out_of_zone`.
- Inside defense zone but no enemy within 5 m -> `no_enemies_nearby`.
- Enemy within 5 m and not teammate/self -> enabled.
- Camping lock only wins after otherwise eligible.

Edge cases: missing `myTeamId`, stale presence entries, multiple enemies.

Mocking strategy: render hook with literal GPS/presence and landmark factories.

Rule references: §6.

### `lib/hooks/useFlagAttemptButton.ts` — P1

What it does: derives flag-attempt eligibility and nearest enemy candidate.

Test cases:
- No GPS, respawning, non-live states disabled with correct reason.
- Nearest enemy candidate within 20 m enables.
- Out of range disabled.
- Already discovered target disabled but target retained for messaging.

Edge cases: two landmarks equidistant, empty enemy list, flag_found phase.

Mocking strategy: render hook with in-memory enemy landmarks.

Rule references: §5.2.

### `lib/hooks/usePresence.ts` — P1

What it does: tracks player GPS in Supabase Realtime Presence and rebuilds current presence map.

Test cases:
- Subscribes to `game:{gameId}:positions` keyed by player id.
- Tracks latest GPS payload after subscribe.
- Rebuilds presence by choosing newest meta per player.
- Cleanup untracks and removes channel.

Edge cases: missing ids clears presence, same player multiple tabs, track failure swallowed.

Mocking strategy: mock Supabase channel with `presenceState()`, `track()`, `untrack()`.

Architecture references: §3.1.

### `lib/hooks/useCamping.ts` — P1

What it does: implements 50 m warning/lock/cooldown state machine.

Test cases:
- Inside candidate radius reaches warning at 90 s.
- Inside candidate radius locks at 120 s.
- Outside for 60 s unlocks after lock.
- No GPS/landmarks does not start cooldown.

Edge cases: GPS loss while locked, leaving before warning, re-entering resets timer.

Mocking strategy: fake timers and `Date.setSystemTime()`.

Rule references: §6.

### `lib/hooks/useCurseEnforcement.ts` — P1

What it does: derives action locks, honor prompts, and movement readouts from active curses.

Test cases:
- Full Stop active -> `actionsLocked`.
- Expired curses ignored.
- Check-in/photo prompt appears during submission window.
- Buddy-up / solo-quarantine spread readouts.
- Slow-walk speed readout from successive GPS samples.
- Frozen drift readout from captured start position.

Edge cases: no team presence, no GPS, missing params fallback, open-ended curse without timer.

Mocking strategy: render hook with fake `t()`, presence fixtures, GPS rerenders.

Rule references: §8.2, §10.

### `lib/hooks/useDiscoveredEnemyKinds.ts` — P2

What it does: derives known enemy landmark kinds from my team’s flag-attempt events.

Test cases:
- Real/decoy/empty results map to `flag_real`, `flag_decoy`, `flag_empty`.
- Other team attempts ignored.
- Malformed/unknown results ignored.
- Null team id returns `{}`.

Mocking strategy: event factories only.

Rule references: §5.2.

### `lib/hooks/usePlacedCurseTrigger.ts` — P1

What it does: posts trigger check once per enemy defense-zone entry.

Test cases:
- Entering an enemy zone calls `/trigger-placed-curse`.
- Staying inside does not repeat.
- Leaving and re-entering repeats.
- Inactive/missing ids/GPS clears state and posts nothing.

Mocking strategy: mock `fetch` via `apiPost`, localStorage device id, enemy landmarks.

Rule references: placed-curse extension in project notes; §8.2 curse mechanics.

### `lib/hooks/useCurseExpiryPoll.ts` — P2

What it does: best-effort 20 s client poll for `/expire-curses`.

Test cases:
- Active curse count > 0 starts interval and posts every 20 s.
- Zero count/missing game id does not poll.
- Fetch errors are swallowed.
- Cleanup clears interval.

Mocking strategy: fake timers, mock `fetch`, localStorage device id.

Architecture references: backlog item 12.

## Domain C: Components

### `components/game/TagButton.tsx` — P1

What it does: renders tag action, disabled reason, success/error output; posts `/tag`.

Test cases:
- Disabled state shows reason and disabled aria label.
- Enabled state shows target count and posts device/player/GPS/targets.
- Success text reports tagged/rejected counts.
- Locked label overrides eligibility.

Visual assertions: button disabled/enabled, red enabled class vs neutral disabled class, reason/result text visible.

i18n coverage: currently hard-coded English; inventory flags this as a localization gap. If localized later, run both `en`/`pt`.

Rule references: §6.

### `components/game/FlagAttemptButton.tsx` — P1

What it does: opens mini-challenge panel, requires photo, uploads to Storage, posts `/attempt-flag`.

Test cases:
- Disabled reasons shown for no GPS/out of range/discovered/lock.
- Enabled click opens challenge panel and sends `/attempt-start`.
- Submit without photo shows photo-required error.
- Successful upload sends photo URL, answer, landmark ref, and GPS.
- Result cards show real/decoy/empty messages.

Visual assertions: panel appears/disappears, file input present, submit disabled while busy, result tone classes.

i18n coverage: challenge text and known errors use provider `en`/`pt`; legacy button chrome is English.

Rule references: §5.2, §5.3.

### `components/game/HardenFlagButton.tsx` — P1

What it does: spends 150 coins to harden real flag once.

Test cases:
- Disabled when not live, no real flag, already hardened, insufficient coins, or actions locked.
- Confirm/cancel two-step flow.
- Confirm posts `/harden-flag` with real flag ref.
- Success/error messages visible.

Visual assertions: disabled reason visible, confirm controls visible, success panel visible.

i18n coverage: confirm/cancel/action-lock are translated; heading/body/button remain English.

Rule references: §5.3, §7.3.

### `components/game/IntelPurchasePanel.tsx` — P1

What it does: displays intel catalog, affordability/cap/gps checks, and posts `/buy-intel`.

Test cases:
- Not-live, cap reached, already purchased, insufficient coins, no GPS disabled reasons.
- Affordable card opens inline confirmation.
- Confirm posts intel ref, device/player/GPS and shows acquired message.
- Failed API surfaces error.

Visual assertions: cap text, cost labels, disabled button, confirm controls, success/error state.

i18n coverage: provider-backed labels should be tested in `en` and `pt`.

Rule references: §7.3, §8.3, §11.

### `components/game/IntelCardDisplay.tsx` — P2

What it does: renders acquired intel cards and human-readable answers.

Test cases:
- Empty state.
- Each answer shape renders correct detail.
- Expired cards show badge and opacity class.
- Non-intel cards omitted.
- Unknown ref falls back safely.

Visual assertions: card title, answer text, expired badge, muted class.

i18n coverage: currently hard-coded English; localization gap.

Rule references: §8.3, §11.

### `components/game/CursePurchasePanel.tsx` — P1

What it does: buys curses by dice count, spends coins, shows roll/tier/enforcement.

Test cases:
- Disabled when not live, insufficient coins, or actions locked.
- Dice count changes cost.
- Confirm posts `/buy-curse`.
- Result card shows rolls, total, tier, curse name, enforcement.

Visual assertions: dice selector, cast button disabled/enabled, result card, error text.

i18n coverage: provider-backed panel labels in `en`/`pt`.

Rule references: §7.3, §8.2, §10.

### `components/game/PlacedCursePanel.tsx` — P1

What it does: arms hidden curses on own landmarks and shows existing placements.

Test cases:
- Lists own landmarks not already armed.
- Insufficient coins disables placement.
- Place posts `/place-curse` with landmark and placed ref.
- Armed placements list visible.
- All landmarks armed shows none-available state.

Visual assertions: select/options, cost button, armed labels.

i18n coverage: provider-backed labels in `en`/`pt`.

Rule references: §8.2.

### `components/game/ChallengesPanel.tsx` — P1

What it does: lists active challenges, validates range/GPS/respawn/live state, submits challenge proof.

Test cases:
- Renders three active challenges.
- Anywhere challenge can submit with GPS.
- Location challenge disabled out of range and enabled in range.
- Respawning/not-live/no GPS reasons.
- Submit posts `/submit-challenge` and shows reward/first-blood toast.

Visual assertions: challenge reward, distance/out-of-range labels, submit buttons, proof fields if present.

i18n coverage: provider-backed labels in `en`/`pt`.

Rule references: §7.2, §8.1, §9.

### `components/game/ActiveCursesBanner.tsx` — P2

What it does: displays active incoming curses, timers, action lock, prompts, readouts.

Test cases:
- Empty curses returns null.
- Header and Full Stop lock translated in `en`/`pt`.
- Timer formats `m ss`.
- Expired curses dim and show expired hint.
- Prompt/readout entries render and use ok/error color classes.

Visual assertions: banner title, enforcement tag, name, description, countdown, prompt, readout color.

i18n coverage: `en`/`pt` for provider-backed strings; seed names/descriptions are English data.

Rule references: §8.2, §10.

### `components/game/RespawnBanner.tsx` — P1

What it does: guides tagged player to neutral landmark and posts `/respawn-clear`.

Test cases:
- Hidden when not respawning.
- No GPS disables button and shows reason.
- Success posts device/player/GPS and calls `onCleared`.
- 409 `not_at_neutral_landmark` shows nearest distance.

Visual assertions: amber banner, disabled button, neutral landmark names, error text.

i18n coverage: currently hard-coded English; localization gap.

Rule references: §6.

### `components/game/FlagCarrierBanner.tsx` — P1

What it does: guides flag carrier home and auto-posts `/complete-run` inside 30 m.

Test cases:
- No GPS prompts enabling GPS.
- Shows distance to home.
- Crossing 30 m posts complete-run exactly once.
- Failed post surfaces error and allows retry.

Visual assertions: flag-carrier headline, distance text, submitting pill, error text.

i18n coverage: currently hard-coded English; localization gap.

Rule references: §5.2, §13 primary win.

### `components/game/FlagFoundBanner.tsx` — P2

What it does: informs teammates or defenders that a flag carrier is running.

Test cases:
- Carrier on my team shows encouragement.
- Enemy carrier shows intercept warning and home base.
- Missing team/home falls back safely.

Visual assertions: green teammate style vs red enemy style, carrier name, home label.

i18n coverage: currently hard-coded English; localization gap.

Rule references: §5.2, §13.

### `components/game/GameOverOverlay.tsx` — P1

What it does: renders winner, score breakdown, and recent event timeline.

Test cases:
- Winner and reason shown for `game_won`.
- Tie shown without winner.
- Score rows reflect `computeScores`.
- Recent events newest first, max 20.
- View timeline calls callback; Back to home link present.

Visual assertions: winner badge, mine badge, row labels/totals, timeline list.

i18n coverage: currently hard-coded English despite available message keys; localization gap.

Rule references: §13.

### History/Toast Components — P3

Units: `ChallengeHistoryList.tsx`, `CurseHistoryList.tsx`, `ToastLayer.tsx`, `RememberGameCode.tsx`.

Test cases:
- Challenge/curse histories derive event rows and empty states.
- Toast layer renders visible toasts and dismisses.
- RememberGameCode writes latest code to localStorage.

Mocking strategy: event factories, localStorage, callback spies.

i18n coverage: mostly hard-coded English except where provider is used; mark localization gaps.

## Summary Gaps

- Several component tests in this pass exercise representative critical surfaces, not every catalog row or every styling branch.
- API route Zod schemas are documented but not yet directly exported; full route tests should either export schemas from route modules or test route handlers with mocked Supabase chains.
- `FlagAttemptButton`, purchase panels, challenge flows, and history lists remain the largest component coverage expansion areas.
- Current i18n implementation uses locales `en` and `pt`, not `pt-pt`; the inventory uses project terminology while tests use the actual locale key.
- Multiple legacy components still hard-code English strings. Tests document current behavior; future localization should add parameterized `en`/`pt` assertions for those components.
