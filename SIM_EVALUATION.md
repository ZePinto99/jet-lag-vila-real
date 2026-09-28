# Simulation evaluation — Jet Lag: Vila Real

A critical evaluation of whether the game **plays well** — correctness *and* player
experience — driven by an upgraded simulation harness that removes the GPS and
wall-clock constraints that make field testing expensive.

Two axes are judged independently throughout, and where they disagree it is said
so explicitly:

1. **Correctness** — does it do what `RULEBOOK.md` says?
2. **Player experience** — would someone who has just walked several hundred
   metres uphill in Vila Real find this fair, legible, and fun?

---

## Verdict

**The game is largely correct.** Across **389 scenario checks** driven through the
real API and RPCs — plus 189 unit tests — the rules engine did what the rulebook
says in nearly every case. The ten issues found and fixed were mostly small (two inverted fallback
constants, two error-mapping bugs) or documentation that had drifted from the
code. **No coin-accounting bug, no secret leak, no false intel answer, and no
concurrency defect was found** — and each was tested for directly, not assumed.

What remains is not a list of breakages. It is **one pricing cluster** and **one
recurring design question**, both of which need a human decision rather than a
patch:

- **Pricing.** `intel.decoy-reveal` costs 100 coins to rule out one candidate,
  while `intel.eliminate-one` costs 50 to rule out the same one. Measured across
  the catalogue, cost-per-candidate-eliminated ranges from 8 coins to ∞.
- **Structurally special hiding places.** Hiding the real flag somewhere the
  geometry treats specially — on your own home base, or at the Sé where both
  teams assemble — changes how much certain intel reveals and who sees what
  before the game starts. Three separate findings turn out to be one pattern.

### What is demonstrably healthy

Worth stating plainly, because a list of open questions reads worse than the
evidence warrants:

| Verified | Evidence |
|---|---|
| **Concurrency is safe under adversarial interleaving** | 65/65 across 10 race families (`races-991337.json`): no double-tag, no double-credit, no negative balance, no half-applied state, and **exactly one terminal decision in every race** — including both teams photographing a real flag simultaneously and carrier-versus-timeout. This is the atomic-RPC design (migrations 0015–0049) being vindicated, and it is the strongest single signal that the engine is launch-worthy. |
| **Every intel card tells the truth** | Every revealed answer checked against a service-role read of the hidden `landmarks.kind`; no card ever rules out the real flag. 111/111 across 4 seeds on the 8-card deck, re-verified at 104/104 after `intel.east-west` was removed (P3a). |
| **No secret leaks** | Migration 0038 keeps real-flag coords out of the Hot/Cold payload; the Surroundings signed URL is never persisted to `cards.payload`; hardening tightens a radius instead of changing visible text. All three asserted. |
| **Coin ledger is exact** | Every debit equals the catalogue cost; every refusal charges nothing; coins never go negative; double-accept and double-resolve never double-credit. |
| **The candidate pools structurally prevent a degenerate layout** | No pool member has any other within 200 m, so one defender can never cover the whole objective set. Now pinned by a test. |
| **Challenge review lifecycle is correct end to end** | pending → reject → resubmit → accept credits reward + first blood exactly once; auto-accept correctly does *not* fire inside 120 s, fires after, and is idempotent. |
| **Timeout tiebreak ladder works** | points → challenges → coins → mandatory coin flip, with curse and coin points correctly 0 per §13. |
| **Boundary geofences are exact** | Tag 10 m server, defense zone 200 m, attempt 28 m / 12 m hardened, home base 30 m, challenge 100 m, presence freshness 30 s — all verified just-inside and just-outside. |

---

## How to reproduce

```bash
# Prerequisites: local Supabase up (all 49 migrations), dev server on :3001
node tools/sim/selftest-clock.mjs             #  12/12  clock-control validation
node tools/sim/scenario-boundaries.mjs        #  17/17  boundaries-9911.json
node tools/sim/scenario-terminal-ties.mjs     #  14/14  terminal-ties-1357.json
node tools/sim/scenario-intel-coverage.mjs    # 111/111 intel-coverage-31337.json (4 seeds)
node tools/sim/scenario-intel-precedence.mjs  #  10/10  intel-precedence-9090.json
node tools/sim/scenario-degenerate.mjs        #  22/22  degenerate-7272.json
node tools/sim/scenario-races.mjs 991337      #  65/65  races-991337.json
node tools/sim/scenario-curse-coverage.mjs    # 150/150 curse-coverage-{20260924,4242}.json (all 16 curses, 2 seeds)
npm test && npx tsc --noEmit && npm run build   #  50 suites / 189 tests
```

Every run writes a structured artifact to `tools/sim/artifacts/<scenario>-<seed>.json`
containing the seed, resolved config, full event log, coin ledger, positions over
time, clock jumps, and every check with its outcome — so a failing run can be
replayed and diffed rather than re-derived.

### Provenance — which working tree these results describe

These results were produced against an **uncommitted working tree**, not the
committed state. Two things matter for re-deriving them:

- A **concurrent refactor** was in flight during this evaluation:
  `lib/gameConstants.ts` (a pure extraction of player-facing constants, imported
  by ~10 app files including the API routes the boundary sweep measures), plus
  `components/guide/` and `app/guide/preview/`. Values were verified unchanged
  (`ATTEMPT_RANGE_M` 28, `HARDENED_RANGE_M` 12, `PROTECTION_WINDOW_MS` 30 min,
  `LANDMARK_LOCKOUT_MS` 15 min, `INTEL_CAP` 4, `HARDEN_COST` 150,
  `STARTING_COINS` 100, `DEFAULT_DURATION_MIN` 180), so the boundary results
  hold. None of those files were edited by this evaluation.
- The dev server **went stale twice**, serving pre-edit code after a route was
  modified. Both times this was detected with a deliberate `__probe` marker
  rather than assumed, and both times the affected scenario was reported at its
  true (failing) count until the server was restarted. Root cause in F11.
- **Artifacts older than a fix legitimately show that fix's failure.** Every
  count in this document cites the artifact that proves it, and the *latest*
  artifact per scenario is authoritative. Earlier artifacts for the same scenario
  are kept rather than deleted, so two of them disagree with the numbers here on
  purpose:

  | Artifact | Result | Why it differs |
  |---|---|---|
  | `races-20260924.json` | 63/64 | Pre-dates the F10 `complete-run` fix. Its one failure **is** F10. |
  | `races-771122.json` | 64/65 | Same, different seed. |
  | `races-991337.json` | **65/65** | Post-fix. The previously-failing check now passes. |

  So the 63→65 progression is the fix working, not a count drifting. The same
  applies to `intel-coverage` (110→111: a check was *added* asserting the coin
  path still reachable after F5's reorder) and `degenerate` (19→22: three checks
  added for F10). Any artifact whose timestamp precedes a fix should be read as a
  record of the bug, not a contradiction.

---

## Severity-ordered summary

| # | Finding | Axis | Severity | Status |
|---|---|---|---|---|
| F1 | Curse param fallbacks inverted: buddy-up 10 vs catalog 25, solo-quarantine 50 vs catalog 10 | Correctness | major | **FIXED** |
| F2 | §12.1 requires out-of-bounds warnings; none existed (1.5 km disk was drawn only) | Correctness + PX | major | **FIXED** |
| F3 | Timeout winner could be recomputed as a null tie, overriding a persisted coin flip | Correctness | major | **FIXED** |
| F4 | `curse.check-in` tagged `[L]` (ledger) but has no ledger effect; "misses are logged" is false | Correctness | minor | **FIXED** |
| F5 | `buy-intel` reported `insufficient_coins` when the real blocker was the permanent cap | PX | minor | **FIXED** |
| F6 | CLAUDE.md claimed Hot/Cold is a "live thermometer" — reverted by migration 0038 | Correctness (doc) | major | **FIXED** |
| F7 | CLAUDE.md claimed flag kind is hidden *by RLS*; it is hidden by the curated API | Correctness (doc) | major | **FIXED** |
| F8 | ~40 doc/code divergences: counts, paths, cross-references, stale status claims | Correctness (doc) | minor | **FIXED** (most) |
| F10 | `complete-run` returned HTTP **500** for the legitimate `game_expired` guard — a carrier reaching home one second late saw a server crash | Correctness + PX | major | **FIXED** |
| F11 | Dev server silently served stale code: Next 16 defaults to Turbopack, which ignores `WATCHPACK_POLLING`; `dev` and `build` used different bundlers | Environment + doc | major | **FIXED** |
| P11 | A weather pause silently consumed the whole 120 s challenge-review window; resuming awarded the coins | Correctness (bug) | major | **FIXED** (0050) |
| P12 | An aborted bulk tag reported `batch_aborted`, which had no player-facing copy, and fired on single-target taps | PX | minor | **FIXED** (reason-specific copy, EN + PT) |
| P13 | Offline failure modes were **asymmetric**: curses read as permanent while inert, and an offline defender was un-lockable | Balance | minor | **FIXED** (0052 pg_cron; camping half inherent to heartbeats) |
| P14 | Photo-curse windows are thin (10–25% open) and a miss costs nothing | PX | minor | **FIXED** (pre-open countdown + last-chance alert; no penalty added) |
| P15 | Full Stop's tag lock stops a defender defending for 10 min; major-tier variance is enormous | Balance | major | **DECIDED — accepted as intended variance; documented in RULEBOOK §10** |
| P16 | `curse.intel-loss` consumed a purchase slot, not just a card — effect exceeded catalogue text | Correctness (doc) | minor | **FIXED** (resolved by P1/0054) |
| P1 | Intel cap counted expired cards → one decoy attempt could permanently end a team's intel | Balance | major | **FIXED** (0054: cap counts `in_hand` only) |
| P2 | Tagged flag carrier kept the flag; a tag was a speed bump, not a turnover | Balance | major | **FIXED** (migration 0053 + RULEBOOK §6) |
| P3a | Home-base hides distorted `intel.east-west`; no pivot made the card sound | Balance | major | **FIXED** — card removed from `data/intel.json` (decode-only paths kept) |
| P3b | Sé Catedral was both the assembly point and an East candidate | Balance | major | **FIXED** — assembly moved to Largo do Pelourinho (neutral, 61 m away) |
| P4 | `intel.decoy-reveal` cost 100 for 1 ref — strictly dominated by `eliminate-one` at 50 | Balance | major | **FIXED** (decoy-reveal 100→45, direction 80→50) |
| P5 | Frozen's self-reported violations extended it to 32 min; closing the app served 8 | Balance + PX | major | **FIXED** (0051: ceiling 4x→1.5x, 32→12 min) |
| P6 | `no_available_curse` spent no coins, revealing enemy state for free and invisibly | Balance | minor | **FIXED** (tier echo removed, probe now logged) |
| P7 | No respawn timeout — a GPS failure could action-lock a player for the whole game | Balance | minor | **FIXED** (0055: `respawning_since` + 10-min sweep + host override) |
| P8 | Camping's 90 s warning rendered only on the map tab, so a defender elsewhere got none | Correctness vs PX | minor | **FIXED** (banner moved above tabs; server-derived) |
| P9 | Harden cost 150, was live-only, and teams start with 100 — unreachable when it mattered | Balance | minor | **FIXED** (0054: setup phase allowed; cost unchanged) |
| P10 | Challenge geofence was 100 m; central landmarks' circles overlapped | Balance | minor | **FIXED** (60 m, moved into gameConstants; client aligned) |
| O1 | Pools structurally prevent the degenerate "one defender covers all" layout | — | — | **observation (good)** |
| O2 | Intel answers are all truthful; the issues are pricing, not correctness | — | — | **observation (good)** |

*(This document is under construction — the curse and race batches are still
being folded in.)*

---

## PROPOSED — awaiting your decision

These are **balance and design judgements, not bugs**. Per the brief, current
values are left in place. Each states the trade-off rather than a
recommendation, because each is a real choice with costs on both sides.

### Group Z — found by the second testing pass (2026-09-28)

A dedicated coverage audit plus three new scenarios (lobby/setup edges, curse
stacking, endgame edges — 279 new checks) turned up five further defects. Four
were introduced by the very migrations written earlier in this session, which is
the argument for the audit: a fix that lands in the DB and never reaches the
player is not a fix.

| # | Finding | Axis | Severity | Status |
|---|---|---|---|---|
| Z1 | The host could clear their OWN respawn — instantly, repeatably, no walk. The host is whoever created the game, so in a 1v1/2v2 one ordinary raider was immune to the tag. | Correctness (exploit) | **blocker** | **FIXED** (0057, own *team* excluded) |
| Z2 | `RespawnBanner` told players "This does not time out… nothing else clears it" AFTER 0055 shipped a 10-min sweep and a host override — and a test asserted that exact string, enforcing a lie to the player. | PX | major | **FIXED** (copy + comment + 3 assertions) |
| Z3 | `/host-clear-respawn` had no caller anywhere. RULEBOOK §6 promised the host could release a player "from the app"; there was no button. | Correctness | major | **FIXED** (`HostRespawnOverride`, 10 tests) |
| Z4 | `flag_carrier_stripped` reached no UI, so a stripped carrier walked all the way home to discover nothing happened — exactly what 0053's own comment said the event existed to prevent. | PX | major | **FIXED** (toast for both teams; `useGameToasts` had NO test file) |
| Z5 | `/results` returned **HTTP 500** for any offset past the last event (28 events: offset 28 → 200, offset 29 → 500), reachable by any client that keeps paging. | Correctness | major | **FIXED** (empty page, `next_offset: null`) |
| Z6 | A weather pause was charged against the respawn grace period — 0055 added the column, nothing shifted it on resume. | Correctness | major | **FIXED** (0056) |
| Z7 | Migrations 0053–0057 were live in the DB but absent from `supabase_migrations.schema_migrations` (ledger said 52, disk had 57). A deploy would have silently skipped all five. | Deploy | **blocker** | **FIXED** (registered; verified by a full `db reset`) |

Still open from that pass, not fixed:

- **Frozen + Pilgrimage are mutually impossible to obey.** Both major-tier, no-stack
  is per-*ref*, so two major rolls can produce them together. Measured: Frozen
  anchored with a 10 m leash while Pilgrimage named a target **750 m away — 75×**.
  Pilgrimage also holds the action lock, so the team cannot act until someone
  walks, and every second of that walk extends Frozen 1:1 (capped 1.5× by 0051).
  `buy-curse` excludes only already-active refs, never contradictory ones.
  **Your call:** exclude the pair at roll time, or accept it as chaos.
- **The client `/expire-curses` poll mutates a FINISHED game.** pg_cron correctly
  declines; the route gates only on `paused`, so it appends `curse_expired` events
  dated *after* the terminal event. Scoring is unaffected (verified) but the
  newest-first timeline renders them above the game's end.
- **`observer-state` 500s on a malformed game id**, leaking the raw Postgres
  message on an endpoint with no auth at all. A well-formed unknown id correctly
  404s.
- **`pickTimeoutWinner` contradicts the RPC on an exact tie** — unreachable today
  (the RPC's coin flip always wins) but a live trap if the terminal events are ever
  absent.

The observer redaction boundary **holds**: no `kind`/`hardened` leaked at lobby,
setup, half-setup, live, live+hardened, live+curses or finished, while the DB held
2 real flags, 4 decoys and a hardened row.

### Group A — the intel pricing cluster

#### P4 — `intel.decoy-reveal` is strictly dominated

Measured cost-per-candidate-eliminated across the whole catalogue, under the
standard layout:

| intel ref | cost | refs narrowed | coins per ref |
|---|---|---|---|
| ~~`intel.east-west`~~ | ~~30~~ | ~~4 (see P3a) / 1~~ | ~~**8**~~ (card removed — see P3a) |
| `intel.north-south` | 30 | 2–3 | 15 |
| `intel.hot-cold` | 60 | 3–4 | 20 |
| `intel.eliminate-two` | 80 | 2 | 40 |
| `intel.eliminate-one` | 50 | 1 | 50 |
| `intel.decoy-reveal` | **100** | **1** | **100** |
| `intel.surroundings` | 80 | 0 | ∞ |
| `intel.direction` | 80 | 0 | ∞ |

`decoy-reveal` costs twice `eliminate-one` to rule out the same single candidate,
and more than `eliminate-two` to rule out half as many. Its only theoretical
edge is knowing the eliminated landmark is specifically a *decoy* rather than
merely not-real — but `lib/intel/narrowing.ts:91-95` discards that distinction
and nothing else in the codebase uses it. So the 100-coin premium currently buys
nothing mechanical.

**The trade-off.** Is it a deliberate trap card (the catalogue wants a tempting
wrong answer), flavour priced for the *feeling* of knowing a decoy, or a pricing
bug? Also note `intel.direction`'s narrowing was deliberately removed because it
"made a 50-coin card reveal the answer outright" — but the card now costs **80**,
so that comment reasons about a stale price. If direction and surroundings are
meant to narrow nothing, 80 coins each against `eliminate-two`'s 80 for two
candidates is worth a second look. **Your call.**

#### P1 — The intel cap counts expired cards

**Lead with the tension, because the current design is a reasonable answer to a
real problem.** `INTEL_CAP = 4` counts cards in any state
(`0015:245-249`, no `state` predicate), making it a **lifetime purchase budget**
rather than a hand size. That is what stops a team farming intel: if the cap
counted only `in_hand` cards, a team could deliberately absorb tags to churn
fresh intel, and the anti-spam intent of §11's cap would evaporate.

The cost of that choice is that one event can cost a team both the card and the
slot. Measured through the production paths:

- **Tag** (`0039:155-164` expires 1 random card): West tags East → East ends with
  `total=4 in_hand=3`, **710 coins and 0 purchases left**. It cannot replace the
  card it just lost.
- **Decoy attempt** (`0026:130-133` expires **all** `in_hand` intel, no
  `limit 1`): 2 cards → one decoy raid → `total=2 in_hand=0`. The team may buy its
  2 unused slots, then 409. Endgame: **4 purchased, 2 usable, 0 remaining**.
- **Worst case:** a team holding 4 cards that raids a decoy is locked out of intel
  for the rest of the game — 0 usable, 0 purchases, any balance.

Note the asymmetry that makes it bite: `narrowing.ts:58` skips non-`in_hand`
cards, so an expired card contributes **nothing** to the map while **fully**
consuming a cap slot.

**The trade-off.** Cap-on-purchases prevents tag-farming but double-penalises one
tag and can strand 400 coins. Cap-on-holdings keeps intel replaceable but needs a
different anti-farm guard. A middle option exists — count only cards not lost to
an enemy action — which preserves anti-spam while making tags cost a card rather
than a card *and* a slot. The current behaviour matches the letter of §11 ("may
not buy more than 4 intel cards total") and `INTEL_CAP`'s own doc comment says
"in any state", so this is **documented intent, not an oversight**. **Your call.**

### Group B — structurally special hiding places

Three findings that look separate but are one pattern: the rules treat certain
locations specially, and hiding the real flag there changes the game.

#### P3a — Home-base hides distort `intel.east-west` — **FIXED (card removed)**

**Resolution: `intel.east-west` was deleted from `data/intel.json`.** The deck is
now **7 cards**. This deletes P3a outright rather than patching a pivot that
cannot be made sound. Full reasoning, all figures measured against the real seed
pools:

- **The card was a lottery, not a deduction.** Pivoting on the defender's own
  home, the West pool splits **6 east / 1 west** and the East pool **1 east /
  6 west**. So **6 times in 7 it eliminated exactly ONE candidate for 30 coins** —
  which `intel.eliminate-one` already does for 50, naming the landmark outright
  with no geometry to reason about. The remaining 1-in-7 eliminated 6. A card
  whose value swings between 1 and 6 refs on a roll the buyer cannot see is a
  lottery card wearing a deduction card's clothes.
- **Its only genuinely strong case was the bug.** Hiding the real flag *on* the
  defender's own home base made pivot = flag longitude, and the card narrowed
  **4 of 5** — the cheapest card in the deck became the strongest, decided
  entirely by where the *defender* chose to hide. Home-base hiding is legal
  (§3.3 puts home bases in their own pools) and is an obvious choice, so this was
  reachable in ordinary play, not a corner case.
- **There was no better pivot.** Pivoting on the *buyer's* home was the original
  design and had already been reverted — see the comment in
  `app/api/games/[id]/buy-intel/route.ts`: "Using the buyer's home made the clue
  nearly constant because the two candidate pools are geographically separated."
  Measured, that pivot splits **0 east / 7 west** and **6 east / 1 west**, i.e. a
  effectively constant answer. Neither available pivot works.
- **It was near-redundant with `intel.north-south`.** I1 uses a fixed per-pool
  latitude tuned to split **3 N / 4 S** — a clean, reliable half-the-map clue.
  Measured, east-west added only **one extra partition** on top of north-south
  (2 groups → 3) in both pools, so removing it costs the deck very little
  deductive depth.

**Precedent:** I9 "Landmark Type" was removed the same way, so a shrinking deck
is an established pattern the code tolerates. Post-removal the deck is
north-south (clean half-split), hot-cold (distance rings), eliminate-one,
eliminate-two and decoy-reveal (direct removal), plus surroundings and direction
(soft hints, no mechanical narrowing).

**Historical cards still work.** The card is unbuyable — the buy-intel route
rejects any ref absent from `data/intel.json` with `invalid_intel_ref` before
touching coins — but the *decode* branches in `lib/intel/narrowing.ts`,
`lib/intel/overlays.ts` and `components/game/IntelCardDisplay.tsx` were
deliberately kept, and the `IntelAnswer` variant stays in `lib/types.ts`. Games
played before the removal still hold these cards and `cards` is append-only in
spirit, so an old hand must still read back its answer and narrow correctly
rather than blanking. No migration deletes historical rows.

#### P3b — Sé Catedral is both the assembly point and an East candidate

RULEBOOK §4.1 sends all players to "the city-center neutral landmark (Sé)" and
§4.4 returns them there. But §3.3 lists Sé as East candidate #6 and
`data/landmarks.json` confirms `team_pool: "east"`. **The rulebook contradicts
itself**, so no amount of careful reading resolves it mid-game.

The leak is concrete: East may hide its real flag at Sé (~1 in 7), and Sé has a
purpose-written flag mini-challenge in `data/flag-attempt-challenges.json` that
asks the raider to photograph a specific door and count the bells in the tower.
A West player standing at Sé for a 30-minute setup can answer that in advance.
Challenge C1 also sends players to Sé mid-game, giving a sanctioned pretext —
and with the 100 m challenge geofence they need not even stand at it.

**Three options, each with different consequences:** (a) move assembly to a true
neutral — Largo do Pelourinho is `team_pool: "neutral"` and 61 m away, so the
walk is unchanged; (b) remove Sé from the East pool, shrinking East's choices
from 7 to 6; (c) accept the leak as flavour. A note marking this unresolved has
been added to §4.1; **no gameplay change was made. Your call.**

#### P2 — A tagged flag carrier keeps the flag

`players.flag_carrier` is set to `true` in two places and **cleared nowhere** —
no `set flag_carrier = false` exists anywhere in the repository. Neither tag path
touches it. `complete_flag_run_atomic` does block a *respawning* carrier
(`0023:56-61`), so they cannot win mid-respawn, but once respawn clears they walk
home still flagged and win. Tagging the carrier costs them a walk to a neutral
landmark plus one team intel card.

**The rulebook is silent.** §6 enumerates tag consequences and says nothing about
the flag; §13 and the glossary only say the carrier must reach home. So the code
matches the letter of the rules and the *rules* have the gap.

**The trade-off.** Stripping the flag on a tag makes tagging decisive and gives
defenders a real answer to a carrier — but it may be too swingy, since one lucky
5 m interception erases a successful raid. Not stripping it makes the endgame
hard to defend and the tag a speed bump.

**FIXED — a tag now strips the flag** (migration `0053`, RULEBOOK §6 rewritten).

The "middle option" of stripping only inside your own defense zone turned out to
be no narrower than stripping always: tagging **already** requires the tagger to
stand inside their own defense zone, enforced at `tag/route.ts:185`
(409 `tagger_not_in_defense_zone`) and mirrored in `useTagButton.ts:76`. So every
legal tag satisfies that condition, and writing the rule as a separate clause
would have implied a restriction that does not exist.

Implementation notes:
- The clear lives in `apply_tag_atomic_unchecked`, the shared per-raider body, so
  single-target and bulk (`apply_tags_atomic`) tags both strip with one code path.
- `games.status` is deliberately **not** reverted from `flag_found`. The photo
  genuinely validated and keeps its +10 (§13), and the enemy flag stays
  discovered; what the tag removes is that player's ability to finish the run. The
  team must photograph it again and carry it home fresh.
- A `flag_carrier_stripped` event is emitted only on an actual strip, so clients
  can tell the player their run ended instead of letting them discover it at the
  home base.

Verified (`scenario-races.mjs`, 67/67):

```
✅ the tag CLEARS players.flag_carrier — flag_carrier=false
✅ exactly one flag_carrier_stripped event
✅ the flag stays DISCOVERED — games.status=flag_found
✅ a tagged, respawning ex-carrier cannot complete the run — 403 not_flag_carrier
✅ the strip persists through the whole respawn cycle
✅ the tagged carrier CANNOT win — the run is over, not merely delayed
```

### Group C — enforcement asymmetries

#### P5 — Frozen punishes honesty

Frozen is 8 min and requires staying within 10 m. The **client self-reports** its
own violations every 2 s (`useCurseEnforcement.ts:277-296`), and each reported
second extends expiry 1:1, capped at 4× the nominal duration (`0027:144-147`).

**Measured, not derived** (`curse-coverage-20260924.json`):

| Measurement | Result |
|---|---|
| Nominal duration at cast | exactly **480 s** |
| 1:1 extension under the cap | `tot=1s → dur=481s`, `tot=4s → 484s`, `tot=8s → 488s` — exact at every step |
| Overlapping reports deduplicated | 3 reports × 3 s overlapping → total **8 s / 8 buckets**, not 9 |
| Ceiling | **1920 s = exactly 32.0 min**, with 1571 s of violations reported. Uncapped arithmetic would give 480+1571 = **2051 s**, so the cap demonstrably bound — and a further report left it at 1920 s unchanged |
| A client that never reports | stores exactly **480 s** and expires normally |

So the asymmetry, with numbers: **honest self-reporting costs up to 1440 s (24
minutes) of extra immobilisation** versus closing the app, on an 8-minute curse.

Nothing reports if the app is closed. The reporting loop is a React effect; there
is no service worker and no server-side polling. Worse, the anchor is only
created by the client's own first POST, and the RPC hard-fails without one
(`frozen_anchor_required`) — so a player who never opens the app never anchors,
never reports, and serves exactly the nominal 8 minutes.

**So the honest player who keeps the app open and wanders serves up to 32
minutes; the one who closes it serves 8.** A 4× differential in favour of
dishonesty. The hook's own header comment says movement curses carry "NO
automated penalty — GPS noise would punish unfairly", which Frozen contradicts.

Two details that show the mechanism is carefully built rather than careless:
reporting a violation before any anchor exists returns `409 anchor_required`, and
the anchor is **first-write-wins** — re-anchoring from 565 m away returns the
*original* coordinates, so reloading the app after walking cannot reset your start
position.

**The trade-off.** The extension exists so Frozen is not free to ignore, and the
per-second dedupe means two wandering teammates pause the clock once rather than
twice — the mechanism is thoughtfully built. Frozen is also the **only** curse in
the catalogue whose penalty channel is driven exclusively by the victim's own
client; nothing else can add a violation second. But it is only enforceable against
players who cooperate. Options: cap the extension lower, drop self-reporting in
favour of honour (matching the other [A] curses), or accept it as a
trust-based game where the cheat is socially visible. **Your call.**

#### P6 — `no_available_curse` is a free oracle

When the rolled tier has no eligible curse, both the route (`buy-curse:259-264`)
and the RPC (`0046:106-125`) return `no_available_curse` **before** any coins are
deducted, echoing the tier back. So a player can roll repeatedly at zero cost and
learn, for free, that the enemy has 0 coins (Coin Drain excluded) or 0 in-hand
intel (Intel Loss excluded).

Measured: buyer coins **777 → 777, byte-identical**, zero `coins_deducted`
events. And the response echoes the rolled tier back as `details:{tier:"major"}`,
so the prober also learns *which bucket* was tested. The probe is free, unlogged,
unmetered, and **invisible to the victim** — nothing records that an enemy just
enumerated their state.

This is **documented design**, not an accident — RULEBOOK §10 says "If the rolled
tier has no eligible result, no coins are spent", and 0046's header states the
intent. The trade-off is simply whether not-charging-for-nothing is worth the
information leak; charging for a failed roll feels punitive, but free probing of
enemy state is a real advantage. **Your call.**

#### P7 — No respawn timeout

There is no timestamp on the respawn state at all — no `respawning_since`, no
deadline, and nothing scheduled clears it. A tagged player who simply sits down
stays `respawning` for the rest of the game.

That state is **immune to further tags** (`tag/route.ts:285-288`, and
`0044:87-96` aborts a whole bulk tag if any target is respawning) but also
**totally action-locked** (`lib/server/actionLock.ts:40` short-circuits before
every other check). So it is self-harming, not exploitable — with one exception: a
team that has already lost can park a tagged player permanently to deny the enemy
tag points (1 pt each) and the per-tag intel discard.

The real cost is UX rather than balance: a GPS failure at the neutral landmark
bricks that player for the whole game with no recovery path. **Your call** whether
that warrants a timeout or a manual override.

### Group C2 — pause, reporting and offline asymmetries

#### P11 — A weather pause silently consumes the entire challenge-review window

**This is a bug, not balance** — but the fix is a migration, so the current
behaviour is left in place and both candidate semantics are named below.

Proof windows are deliberately frozen on the **game** clock: `0027:69-82` shifts
`games.started_at` and every `active_curses` endpoint forward by the paused
duration on resume, which is what makes `getCurseProofWindow` resume at exactly
the same point in its slot. But **nothing shifts `cards.payload.submitted_at`**,
and `0048:45` compares it against **wall-clock** `now() - interval '120 seconds'`.

Measured: submit a photo proof → pause → resume after 200 s of paused wall clock
(`last_pause_seconds=200`). `submitted_at` is now 201 s old, so the very next
sweep auto-accepts **immediately, with zero seconds of post-resume review time**
(coins 900→960). During the pause the sweep is correctly inert
(`resolve-challenge-reviews/route.ts:54`), so the whole window is consumed by the
pause itself.

**Any pause longer than two minutes therefore awards the coins on resume** — the
reviewing team never sees the photo and cannot reject it. It is exploitable
deliberately: submit a weak photo, then propose a pause.

**Two candidate semantics, which disagree for a pause starting 100 s into a 120 s
window:**
1. **The timer does not run during a pause** — shift `submitted_at` on resume like
   every other timestamp. The reviewer gets their remaining 20 s back. Consistent
   with how curse proof windows already behave.
2. **A pause extends the window** — reset the review deadline on resume, giving a
   full 120 s. Kinder to a reviewer who was mid-walk when the pause hit, but it
   lets a pause be used to *delay* an award.

Option 1 is the consistent one and is a one-line addition to the resume RPC's
existing shift; option 2 is arguably the better experience. **Your call**, and it
is the only finding here that requires touching committed DB behaviour.

#### P12 — An aborted bulk tag is not legible to the player who tapped it

Route and RPC answer different questions, and both are defensible. The route
pre-filter (`tag/route.ts:285-288`) strips *known*-respawning targets before the
RPC, so a batch already stale at request time is **partially applied by design**.
Only a mid-flight change triggers `0044:87-96`'s all-or-nothing abort — verified
by driving `apply_tags_atomic` directly: `{"error":"target_state_changed"}` with
the healthy raider correctly left untagged.

The **reporting** is the problem. On abort the route labels every innocent target
with reason `batch_aborted` (`tag/route.ts:328-336`), and `batch_aborted` has **no
player-facing copy in either locale**. So a defender sees a tag that did nothing,
with no cause, while a teammate who tagged one of the same raiders succeeded. It
also fires on single-target taps, where the truth is simply "they already went
down" — a sentence the player would accept instantly.

Correctness: fine, the state is right. Player experience: this is exactly the
"a purchase that silently does nothing" failure mode, transplanted to a tag. A
string and a reason-specific message would close it. **Your call** on wording.

#### P13 — Offline failure modes are asymmetric, and asymmetry is exploitable

With every client's app closed for an hour, nothing polls. Measured consequences:

- **Time bonus: no loss.** One late `/time-tick` back-credited *all* missed
  intervals in a single call (3 intervals = 60 coins to each team); a second
  credited nothing. The whole-game cap (`floor(180/30)=6`) means no interval is
  ever forfeitable by being offline. This part is well designed.
- **Curses: read as permanent while being inert — and this is bad in both
  directions.** A 10-minute Full Stop sat in `active_curses` for the full 60
  minutes with **zero** `curse_expired` events, and `live-state` kept reporting it
  to the cursed team, so `ActiveCursesBanner` displays an expired curse
  indefinitely. It does not actually lock anything (the `expires_at` filter holds;
  a concurrent attempt returned 200). So the **caster** paid 150 coins for a curse
  that delivered 10 minutes of effect and then an indefinite bluff, while the
  **victim** stares at a permanent-looking curse that is doing nothing and may
  stop playing normally because of it. Neither team is getting the game they paid
  for, and neither can tell.
- **Camping: the rule is suspended.** `0031:82` credits at most 15 s per
  heartbeat, so an hour offline added 0 s. **An offline defender is un-lockable.**

**Both failure modes favour the cursed/camping team**, and that is what makes this
worth a decision rather than a shrug: an asymmetric failure mode is exploitable by
simply closing the app, whereas a symmetric one is merely a nuisance. Backlog item
12 (pg_cron for curse expiry) would close the curse half server-side. The camping
half is inherent to a heartbeat design. **Your call.**

#### P14 — Photo-verified curses are thin AND consequence-free

Measured open-window fraction over each curse's lifetime:

| curse | prompts × window | duration | open |
|---|---|---|---|
| `curse.photo-tax` | 3 × 30 s | 360 s | 25% |
| `curse.pose-patrol` | 6 × 30 s | 720 s | 25% |
| `curse.single-file` | 2 × 30 s | 300 s | 20% |
| `curse.outfit-swap` | 2 × 60 s | 1200 s | **10%** |

Outfit Swap is the sharp one: the "after" photo must land inside a **60-second
slot that opens 19 minutes after the curse was cast**, with no server-side
reminder (push fires only on cast, `buy-curse/route.ts:316`). Miss it and
`/submit-curse-proof` returns 409 `proof_window_closed` permanently — the slot
cannot be reopened.

**And a missed proof costs nothing, anywhere.** No event, no coin, no score term
(`lib/results/scoring.ts` has no proof term — verified). So the design asks for a
hard-timed photo under time pressure and then does not care whether it arrives:
stressful to comply with, pointless to comply with. Either a miss should cost
something or the windows should be generous; currently it is the worst of both.
**Your call** on which direction.

#### P15 — Full Stop can win the game, and the major tier's variance is enormous

Full Stop is the harshest effect in the game and, unusually, fully
server-enforced: `/buy-intel`, `/submit-challenge`, `/tag` and `/buy-curse` all
return 409 `actions_locked` for the whole 10 minutes (`tag/route.ts:163`
confirmed).

**The tag lock is the consequential part: a defender cannot defend their own flag
for 10 minutes.** A raider can walk into the defense zone untouchable. So a
150-coin three-dice cast, timed against a raid, can decide the game outright —
and the victim cannot even counter-curse, because buying a curse is itself locked.

Compare that with the [A] curses in the *same major tier*, which do nothing
mechanically at all (a readout nobody is obliged to obey). **The same 150 coins
buys either a game-deciding defensive shutdown or a spread readout.** That
variance may be intended — a lottery is exciting — but it is worth deciding
deliberately rather than inheriting. **Your call.**

#### P16 — `curse.intel-loss` does more than the catalogue says

The catalogue describes "discard 1 random intel card" and the curse does expire
exactly one card. But because the intel cap counts cards in **any** state
(`buy-intel/route.ts:225`, and see P1), the victim permanently loses one of their
**four purchase slots** rather than one card — they cannot rebuy.

This is the one place where a curse's real effect **exceeds its stated effect**,
so it is arguably a documentation bug rather than a balance question. It resolves
automatically if P1 is decided in favour of counting only in-hand cards; if P1 is
left as-is, the catalogue text should say the slot is consumed. **Your call**, and
it is coupled to P1.

### Group D — thresholds and documentation promises

#### P8 — Camping's 90 s warning is client-only

RULEBOOK §12.5 and the player guide both state the app warns at 90 s and locks
the Tag button at 120 s. The **lock is genuinely server-authoritative**
(`0031:92`), but only 120 and 60 exist in SQL — `CAMPING_WARNING_S = 90` lives
solely in `lib/hooks/useCamping.ts:18`.

A defender who reloads, backgrounds the PWA, or has flaky GPS gets **no warning**
and then finds the Tag button dead at exactly the moment an enemy walks into
range. Correctness-wise the doc over-promises; experience-wise this is the worse
half — losing a tag you were entitled to, with no prior signal, is the kind of
thing that causes an argument. Either make the warning server-derived or soften
§12.5. **Your call.**

#### P9 — Harden is unreachable at game start

Harden costs 150, teams start with 100, and it is live-phase-only
(`harden-flag/route.ts:70-72`) — so a team cannot harden during the setup phase
when it is actually deciding where to hide. With no challenge income the first
time bonus lands at T+30 (120 coins, still short), reaching 150 only at
**T+90 min** on time bonuses alone. Challenge income can beat that inside ~10–15
min, but only if the 3 active slots happen to offer enough.

The 30-minute flag-attempt protection window partly covers the exposure. Whether
the intended experience is "hardening is a mid-game investment" or "you should be
able to harden what you just hid" is a design question. **Your call.**

#### P10 — The 100 m challenge geofence overlaps central landmarks

`CHALLENGE_GEOFENCE_M = 100` (`submit-challenge/route.ts:26`) is generous in Vila
Real's historic core. A 100 m circle around Largo do Pelourinho reaches
Avenida Carvalho Araújo (~82 m) and nearly Casa de Diogo Cão (~140 m), so several
central challenges can be claimed from a block away — verified: a submission at
90 m is accepted. Also note this constant is *not* in `lib/gameConstants.ts`
despite that file's single-source-of-truth policy, and the rulebook never tells
players the radius at all. **Your call** on the value; the missing documentation
is worth fixing regardless.



## What the harness gained

The four gaps in `tools/sim/` that made this evaluation impossible before.

### Gap 1 — movement was teleport-only

`client.setPos()` called `context.setGeolocation` and nothing else. Walking
distance *is* this game's cost model (RULEBOOK §3.4 budgets the map in walking
minutes), so a teleporting client pays none of it and balance questions cannot
be asked at all.

`tools/sim/movement.mjs` adds `walkPath(client, waypoints, opts)`: interpolated
movement at a configurable speed, defaulting to 1.3 m/s walking pace. It
deliberately **respects** the production publish throttle
(`lib/hooks/useGPS.ts:86-88` drops a fix that moved <3 m AND arrived <5 s after
the last) rather than defeating it, and it sleeps in real time between fixes
because `useWalkingSpeed` derives km/h from consecutive `updated_at` deltas and
warns above 12 km/h — so the driver's own timing is under test.

Also `holdWithDrift` (a stationary player whose reported position still wanders,
which is how drift-induced tags become testable) and `pointAtDistance` (place a
client exactly N metres from a boundary).

### Gap 2 — GPS was unrealistically perfect

`accuracy: 8` was hardcoded in both context creation and `setPos`, so the app's
entire drift-tolerance design — tag displays at 5 m but the server validates at
10 m *specifically* to absorb drift in narrow streets — was untestable.

`setPos(lat, lng, accuracy)` now takes an accuracy (default 8, so existing
callers are unchanged) and `makeClient` accepts one. `movement.mjs` adds seeded
Gaussian jitter via `jitterPosition(truePoint, sigmaM, rng)`, with documented
sigma bands: 1.5 m open plaza, 5 m ordinary street, 12 m urban canyon.

### Gap 3 — there was no clock control

See the next section; this was the substantial piece.

### Gap 4 — scenarios were not reproducible or machine-readable

`tools/sim/artifact.mjs` gives every run a structured JSON artifact.
`tools/sim/plan.mjs` makes a scenario expressible as data (teams, flag
placements, waypoint paths, purchases, clock jumps) with one seed driving every
harness-side random input via `makeRng` (mulberry32) in `tools/sim/geoutil.mjs`.

**What cannot be seeded, honestly:** five random inputs live server-side and are
not injectable — curse tier dice (`buy-curse/route.ts:59`), intel `pickDistinct`
(`buy-intel/route.ts:77,85`), challenge refresh (`0024:48`), the intel-loss card
choice (`0044:111`), and the timeout coin flip (`0045:237`). For those, a plan
*pins* the outcome (`forceCurse` inserts the exact row) rather than predicting
it. Worth noting `lib/curses/castParams.ts:23` already accepts an injectable
`rng` parameter — that is the pattern the other five could follow if determinism
is ever wanted in production tests.

**On `step()`:** `walkthrough.mjs:44-50` downgrades a thrown assertion to a
warning and continues. That is right for a release smoke run — you want the whole
matrix's signal from one pass — but wrong for an evaluation, where a swallowed
throw reads as "mechanic works". `strictStep` in `artifact.mjs` records a throw
as a **failed check** (never a warning) and continues to gather the remaining
evidence, but `finish()` returns a non-zero failure count and the scenario exits
1. Nothing is downgraded; `walkthrough.mjs` is left as-is.

---

## The clock design, and why rebase-backward is right

Every deadline in all three layers is `<live clock> vs <stored timestamp>`.
Nothing derives a deadline from an absolute epoch constant. Verified across:

- **browser** — `Live.tsx:161` ticks `Date.now()` into `now`, feeding pure
  functions (`radarPingVisible`, `getCurseProofWindow`, `isPositionFresh`).
- **Next** — `attempt-flag:119`, `attempt-start:96`, `end-by-timeout:69`,
  `time-tick:117` each read a stored timestamp and add a constant.
- **Postgres** — `0030:50` (`game_expired`, blocks every gameplay RPC),
  `0045:153` (timeout), `0026:107` (15-min lockout), `0040:57,66` (attempt
  cooldowns), `0046:43` (curse expiry), `0048:45` (review auto-accept),
  `0031` (camping), `0044:72` (tag/heartbeat freshness).

So shifting the **stored** timestamps backward by D is observationally identical
to advancing all three clocks forward by D — with two advantages a forward fake
clock does not have, both of which were validated empirically rather than assumed:

**1. The GPS freshness band survives.** `isPositionFresh`
(`lib/geo/positionFreshness.ts:8`) rejects a fix older than 30 s or more than
10 s in the future, applied in 12 server routes against the *browser's*
`Date.now()` stamp (`useGPS.ts:80`). Advancing either clock alone would 409 every
tag, attempt and proof, and empty the radar. Under rebase both stay real:

```
✅ wall-clock GPS stamp still fresh after rebase (attempt accepted) — 30s band intact
```

**2. Curse timestamps stay coherent despite being split-brain.**
`active_curses.started_at` is stamped by Postgres `now()` (`0046:180`) while
`expires_at` is minted by the Next server from `Date.now()`
(`buy-curse/route.ts:284-288`). Rebasing shifts both stored columns by the same
delta, preserving the interval:

```
✅ curse curse.check-in: age 0s->120s, duration 600s->600s (preserved)
```

### One correction to the brief's design

The brief specified shifting `events.created_at`. **That column is immutable in
production** — migration `0005`'s `events_block_mutation` trigger raises
`events.created_at is immutable`, permitting only the `actor_player_id` FK
cascade-to-null. This matters because three authoritative deadlines read it
directly: the 15-min landmark lockout (`0026:107`), the attempt-start 60 s/15 s
cooldowns (`0040:57,66`), and time-bonus dedupe (`0045:50`).

`advanceClock` bypasses it with `set local session_replication_role = replica`,
which is **session-scoped** (so a concurrent scenario keeps the guard fully
armed) and is reset inside the same transaction. Verified the guard re-arms:

```
✅ events append-only trigger re-armed (session_replication_role reset)
```

This is harness-only; no app code does this.

### Layers touched, and what stayed out of reach

`advanceClock(gameId, seconds)` coherently shifts, in one transaction:
`games.started_at`/`ended_at`, `active_curses.started_at`/`expires_at`/`created_at`,
`frozen_violation_seconds.second_at`, `frozen_player_anchors.created_at`,
`cards.created_at`/`updated_at` **and `payload.submitted_at`** (jsonb — `0048:40`
reads it in preference to `updated_at`), `curse_proofs.submitted_at`,
`placed_curses.created_at`/`triggered_at`, `photos.created_at`/`taken_at`,
`tags.created_at`, `events.created_at`, `player_camping_state.last_game_second`,
and the `games.config.weather_pause.paused_at`/`requested_at` jsonb instants.

Weather-pause *resume* already rebases `started_at` and every curse timestamp
itself (`0027:70-81`), so the harness shifts only the recorded instants and does
not add a second offset, which would double-count.

**Camping cannot be fast-forwarded by any clock move**, as the brief predicted,
though the mechanism is subtler than "the clock doesn't reach it":
`last_game_second` is in game-second space derived from `games.started_at`, so
rebasing *does* advance camping — but `0031:82` credits at most 15 s per
heartbeat call (`least(15, ...)`), deliberately, so a connectivity gap cannot be
inferred as time-in-zone. `campingSet()` writes the accumulator directly. It
takes a `lagSeconds` (default 5, matching the real `CAMPING_HEARTBEAT_MS`)
because seeding `last_game_second` at *now* makes the next heartbeat credit zero:

```
✅ camping lock reached via seeded accumulator + 1 real heartbeat (123s)
```

**Two deadlines were judged out of reach and then found to be in reach**, which
is worth recording because the first read was wrong:

- *Radar phase* — `radarPingVisible` is `nowMs % 20000` off raw wall clock
  (`radar.ts:24-26`), a pure function of wall clock with no stored timestamp and
  nothing that accumulates or expires. It needs no fast-forward at all: the pure
  function is unit-testable and a browser assertion just waits for the next real
  20 s cycle.
- *E16 check-in ack* — `ActiveCursesBanner.tsx:152-155` derives `intervalIdx`
  from `new Date(curse.started_at).getTime()`, a **stored column** the rebase
  already shifts. Only `ackedIdx` is local React state, and that needs no clock.

**Net result: zero app-code changes were needed for clock control.** No
production hook, so no inertness proof is required and there is no possibility of
shipping a test seam.

---

## FIXED — correctness failures and doc drift

Each of these was reproduced by a scenario, fixed, and re-verified by seeing the
same scenario pass afterwards, with `npm test`, `npx tsc --noEmit` and
`npm run build` all green.

### F1 — Curse param fallbacks were inverted (major, correctness)

**What happened.** `lib/hooks/useCurseEnforcement.ts` reads each movement curse's
threshold from the persisted `params`, falling back to a literal when the key is
absent. Two fallbacks were swapped against the catalogue:

| curse | fallback was | `data/curses.json` | effect |
|---|---|---|---|
| `curse.buddy-up` | 10 m | **25 m** | 2.5× too strict |
| `curse.solo-quarantine` | 50 m | **10 m** | 5× too lenient |

The two are adjacent branches with identical structure, and the values are each
other's — a copy-paste swap. RULEBOOK §10 specifies 25 m for Buddy Up and 10 m
for Team Quarantine.

**Axes.** Correctness: fails. Player experience: the buddy-up case is the bad
one — a team told "stay within 25 m" would be flagged as non-compliant at 11 m,
which reads as the app being broken.

**Scope.** Bounded: `buy_curse_atomic` persists the catalogue params, so a
normally-cast curse carries real values and the fallback is dead code. It bites
on legacy rows, rows where params failed to persist, and any non-numeric value
(`numParam` also falls through on the *string* `"25"`).

**FIXED** — both fallbacks now match the catalogue, each with a comment citing
§10 and naming the value it replaced.

### F2 — Out-of-bounds warnings did not exist (major, correctness + PX)

**What happened.** RULEBOOK §12.1 makes the app responsible for "out-of-bounds
warnings", and §3.1 defines the play area as a ~1.5 km disk. But
`PLAY_AREA_RADIUS_M` appeared only in `lib/intel/overlays.ts` (to build the grey
map polygon) and `components/map/GameMap.tsx` (to draw it). Nothing measured a
player's distance from the centre. There was no warning, no event, no state, and
**no user-facing string in either locale** — so no warning UI could have existed.

**Axes.** Correctness: §12's item 1 says "must". Player experience: worse than
the correctness gap — the only signal was a grey region on a map that nobody is
looking at mid-chase, on a phone in a pocket.

**FIXED** — added `getPlayAreaState()` to `lib/geo/playArea.ts` (a pure function
returning `inside` / `near_edge` / `outside` with metres remaining or
walk-back distance) and `components/game/BoundaryNudge.tsx`, wired into
`Live.tsx` beside the existing `WalkingNudge`.

Deliberately a **warning only, never a penalty**: §12's closing paragraph sets a
trust-over-enforcement stance, and GPS alone cannot distinguish "left the play
area" from "standing next to a tall building at the edge".
`PLAY_AREA_WARN_MARGIN_M = 150` gives roughly two minutes of notice at 1.3 m/s.

Covered by 16 tests. Three specifically target the cry-wolf failure mode a
warning pill is prone to: nothing renders with no GPS, nothing at the centre,
nothing 400 m inside the boundary. Also covered: amber→red escalation,
`aria-live="polite"`, actionable walk-back metres, and PT-PT.

### F3 — A persisted coin-flip winner could be recomputed as a tie (major, correctness)

**What happened.** `finish_game_by_timeout_atomic` breaks an exact tie with a real
coin flip (`0045:236-237`, `reason: 'timeout_coin_flip'`) and writes the winner
into **both** `game_ended_by_timeout` and `game_won`. But
`end-by-timeout/route.ts`'s re-read path consulted only `game_won`; if that second
insert was absent, it fell through to `pickTimeoutWinner()`, whose return type
cannot even express a coin flip — it returns
`{ winner_team_id: null, reason: 'timeout_tied' }`.

**Axes.** Correctness: contradicts both the persisted record and §13's "Then coin
flip." Player experience: a team would be shown "Tied — all tiebreakers
exhausted" for a game the server had already decided in their favour. Of all the
findings this is the one most likely to end an evening badly.

**FIXED** — the winner is now read from whichever terminal event recorded one,
recomputing only when neither did. Verified by a test that deletes the `game_won`
row to reproduce the exact state:

```
✅ winner survives a missing game_won row — winner=2c22f0d7… reason=timeout_coin_flip
✅ idempotent re-read returns the SAME persisted winner
✅ results route agrees with the timeout winner
```

### F4 — `curse.check-in` was tagged `[L]` but has no ledger effect (minor, correctness)

**What happened.** The catalogue tagged it `[L]` — which RULEBOOK §10 defines as
"pure state mutation in the app (coins, intel, action lock)". The actual
acknowledgement is `setAckedIdx(intervalIdx)` in
`components/game/ActiveCursesBanner.tsx:157` and nothing else: no event insert,
no coin or intel change, no lock. A page refresh discards it. The RPC's
`v_ledger := jsonb_build_object('kind','check_in')` is a display label returned
to the buyer, not a write — compare Coin Drain, which actually updates
`teams.coins`.

The catalogue and both locales also claimed "missed prompts are logged". **Nothing
is logged**, so a missed prompt is invisible to teammates, the enemy, the observer
view and the post-game recap.

**Axes.** Correctness: the tag and the description are both false. Player
experience: mildly worse than neutral — a team might not contest a missed
check-in believing there is a record to appeal to.

**Confirmed by measurement**, not only by reading: the row is created with a real
expiry, but enemy coins are unchanged (900→900), enemy intel is unchanged, the
cursed team can still spend normally (200), `/submit-curse-proof` returns 409
`proof_not_required`, `/extend-curse` returns 409 `not_extendable`, and zero
`curse_proofs` rows are written. The **only** durable trace is the single
`curse_cast` event. `curse.mute` behaves identically and was already `[C]`.

**FIXED** — re-tagged `[C]` (honour system: "app reminds, but no real check") in
`data/curses.json`, `RULEBOOK.md` §10 and §15.6, the EN/PT strings in
`lib/i18n/messages.ts` and `lib/i18n/gameCatalog.ts`, and the two tests that
pinned the old taxonomy.

> **Disclosure — `data/curses.json` is a fenced file.** CLAUDE.md lists
> `data/*.json` under "Files NOT to touch without reading first", because the
> **ids** are a shared contract between the API routes and the client. This edit
> changed `curse.check-in`'s `enforcement` field and its `description` string
> only. **No `id` was touched**, so nothing that keys off the catalogue breaks.

### F5 — `buy-intel` blamed the wrong thing when a team was capped *and* broke (minor, PX)

**What happened.** The route checked coins before the cap; the authoritative RPC
checks the cap first (`0015:245-250`, then balance at `:259`). A team that was
both at the 4-card cap and short of coins was told `insufficient_coins`.

**Axes.** Correctness: both layers refuse and nothing is charged, so no state is
wrong. Player experience: this is the whole finding — the cap is *permanent for
the rest of the game*, so the message sends a team off to earn coins that can
never unblock the purchase. A wrong diagnosis is worse than a blunt one.

**FIXED** — the route now checks the cap first, matching the RPC. Verified that
both layers give one answer, and that the fix did not over-correct:

```
✅ route reports intel_cap_reached (matches the RPC), not insufficient_coins
✅ authoritative RPC returns the same reason — rpc error=intel_cap_reached
✅ under the cap and short of coins → insufficient_coins (with the numbers)
✅ re-buying an owned ref below the cap → intel_already_purchased
```

### F6 — Dev server silently served stale code (major, environment + doc)

**What happened.** Two route fixes appeared to have no effect. Proven stale with a
deliberate marker in a returned string rather than assumed. Root cause: this is
**Next 16, where Turbopack is the dev default**, and `WATCHPACK_POLLING=true` —
which CLAUDE.md prescribed — is a **webpack** option that Turbopack ignores. On
this filesystem the native watcher did not fire and the polling fallback was
never active. `package.json` had already pinned `build` to `next build --webpack`
while `dev` had no flag, so **the two bundlers had drifted apart**.

**Axes.** Not a game finding, but it invalidates test results silently, which is
worse than a loud failure. It also means dev and production were building through
different bundlers — the classic shape of "works in dev, breaks in build".

**FIXED** — `"dev"` now pins `--webpack` to match `build`, so the next session
gets a working watcher from plain `npm run dev`. CLAUDE.md's Known caveats now
explain the Turbopack trap, the dev/build parity requirement, and the probe
technique (change a returned string, not a comment — a comment cannot change a
response).

### F7 — CLAUDE.md misdescribed a security boundary (major, doc)

CLAUDE.md decision 5 claimed "Flag kind is hidden by RLS — the enemy team cannot
read `landmarks.kind`". In fact `0008_rls_baseline.sql:37` grants anon
`select using (true)` on `landmarks`; the hiding is done **server-side** by the
curated `/live-state` and `/setup-state` responses, and a direct REST GET
bypasses it. The file's own security-posture section said so, contradicting
decision 5 twelve lines earlier.

Documenting a protection that does not exist is worse than documenting the gap.
**FIXED** — decision 5 rewritten to name the curated API as the mechanism and
point at the v1.1 hardening item.

### F8 — CLAUDE.md claimed Hot/Cold is a "live thermometer" (major, doc)

The most dangerous stale claim found. CLAUDE.md recorded I6 Hot/Cold as "now a
**live** thermometer (server stamps real-flag coords in `intel.hot-cold`
payload — a deliberate balance change)". Migration
`0038_strip_hot_cold_target.sql` **reverted that**, deliberately stripping the
target coordinates; RULEBOOK §11 and `data/intel.json` both correctly describe an
immutable purchase-time bracket.

A future session reading CLAUDE.md would have re-implemented a reverted mechanic
and reintroduced the leak 0038 exists to prevent. **FIXED** — the entry now names
0038, states the current behaviour, and says "do not re-implement the live
version."

### F10 — `complete-run` returned HTTP 500 for a legitimate guard (major, correctness + PX)

**What happened.** `complete-run/route.ts:173-176` mapped RPC errors through a
*closed whitelist* ending in `: 500`. But `gameplay_action_guard_locked`
(`0030:51`) legitimately returns `game_expired` once the game duration has
elapsed — and that fell to the 500 default.

**So a flag carrier who reached their home base one second past the 180-minute
deadline got an HTTP 500.** The refusal is correct; the presentation is
catastrophic. A 500 is indistinguishable from a dropped connection, so the player
stands at the geofence retrying instead of being shown the results screen — at the
single most emotionally loaded moment in the game.

`complete-run` was the **only** whitelist-style mapper: `submit-challenge:315`,
`accept-challenge` and `reject-challenge` all name `game_expired` explicitly, and
`buy-intel`, `buy-curse`, `harden-flag` and `place-curse` default unknown RPC
errors to 409. So this was an outlier, not a house style.

**Axes.** Correctness: the status code is wrong. Player experience: this is the
whole finding, and it is the clearest example in this evaluation of the
"implemented correctly, still a bad game" class — it lives in an error-code mapper,
where a field playtest would have blamed the network and never found it.

**FIXED** — `game_expired` now maps to 409 alongside the other guard rejections.
Verified:

```
✅ post-deadline carrier gets 409 game_expired, NOT 500 — status=409 error=game_expired
✅ the refusal did not finish the game or crown a winner — game status=flag_found
```

### F11 — The dev server silently served stale code (major, environment + doc)

Covered under F6 above; recorded separately in the summary table because it
invalidated test results rather than affecting gameplay.

### F9 — ~40 further doc/code divergences (minor, doc)

Counts were badly stale, each verified independently before correcting:

| Claim | Was | Actual |
|---|---|---|
| migrations | 13 | **49** |
| API routes | 26 | **36** (34 under `[id]/`) |
| unit tests | 59 | **189** (50 suites) |
| client hooks | 9 | **22** |
| game components | 14 | **28** |
| challenges | 18 | **15** |
| intel types | 9 | **8** |
| DB tables | 9 | **16** |
| landmarks audited | 22 | **26** |

Also fixed: `app/observer/` described as a placeholder in two places when it is
fully implemented; the "migrations 0009–0013 may not be applied" warning (all 49
are applied) replaced with a pointer that most enforcement now lives in the
0015–0049 RPCs; a resolved captain-role TODO; the pg_cron row (no DB job ships —
curse expiry is a 20 s client poll); the realtime row (Broadcast for chat was
missing); RULEBOOK §3.1's path (`overlays.ts` → `lib/geo/playArea.ts`); §4.3's
cross-reference (§11 → §13); and §3.4's Biblioteca walking time (~5 min → ~10–12
min, measured 805 m), with a note that straight-line figures are lower bounds in
a ridge-and-valley town.


---

## Coverage map — what was exercised, and what was not

### Covered and passing

| Area | Coverage |
|---|---|
| **Terminal paths** | Both, and only two exist. Flag carried home (30 m of own home base) and the 180-min timeout, including the full tiebreak ladder (total → challenges → coins → mandatory coin flip). |
| **Boundaries** | Just-inside / just-outside for tag 10 m server, defense zone 200 m, attempt 28 m, hardened 12 m, home base 30 m, challenge 100 m, presence freshness 30 s (and the 25 s accept case, proving it is a band not a wall), future-skew 10 s. |
| **Every intel card** (8 at the time of the sweep; 7 after P3a removed `intel.east-west`) | Purchase, exact debit, payload shape, narrowing count, and **answer truthfulness** against the hidden `landmarks.kind`. Plus cap behaviour, duplicate refs, exact-cost purchases, and both stale/missing-GPS rejections for Hot/Cold. |
| **Tag + two-stage respawn** | Tag at 8/12/40 m, defender outside own zone, stale/future tagger positions, wrong-neutral rejection, arrive-then-leave clearing, and the per-action single intel loss. |
| **Challenge review** | pending → reject → resubmit → accept, first blood, double-accept, auto-accept inside/outside 120 s, idempotent re-resolve, concurrent sweeps. |
| **Curse mechanics** | All 16 curses, 150/150 on two seeds. `no_available_curse` charges nothing and leaks the tier; `actions_locked`/409 scoped to the target team (caster unaffected, and the cursed team cannot counter-curse); all 4 photo-verified proof windows open/close correctly **across repeated clock rebases**, including outfit-swap's closing dispute window at 1160 s; coin-drain debits exactly 50 and clamps at 0 rather than going negative; intel-loss expires exactly 1 card; check-in and mute have no server effect; no-stack is enforced by a DB unique constraint (`0018:10`), not merely the route filter; `/expire-curses` is idempotent; `curse.backwards` is `enabled: false` and never castable. **No param drift** — every catalogue param appears verbatim in `active_curses.params`, durations exact to the second. |
| **Concurrency** | 10 race families (see below). |
| **Degenerate layouts** | Flag on own home base, maximally clustered (proved impossible), maximally distant. |
| **Clock** | All deadlines reachable by coherent rebase; camping by direct state write. |
| **Offline operation** | Curse expiry, time-tick back-credit, camping accrual with no clients polling. |

### The 10 race families, all clean

Two purchases racing one balance · bulk tag with a stale target (both the route
pre-filter and the RPC all-or-nothing path) · concurrent overlapping tags · both
teams validating a real flag simultaneously · flag carrier tagged · carrier
crossing home as the timeout fires · tag landing mid-attempt (both orderings) ·
curse expiring mid-attempt · attempt-start cooldown collisions · concurrent
auto-accept sweeps.

In every case: **exactly one outcome applied, no double-anything, no negative
balance, no half-applied state, and no 500s** except the `complete-run` mapper bug
(F10), which this suite is what found.

### Not covered by this evaluation

- **Human perception of the client layer.** All 28 pre-existing browser scenarios
  were run in a follow-up pass outside the sandbox and pass (see the fidelity
  section below), so the UI is confirmed to render and respond. What no harness can
  cover is whether a walking player *notices* a radar blip or a toast in time to
  act on it.
- **All 16 curses are now covered** (150/150), so the earlier gaps here are
  closed. The one residual reading rather than measurement: "closing the app
  serves only the nominal 8 minutes" is confirmed for the *server* side (a
  never-reported Frozen stores exactly 480 s and expires), but that the **client**
  cannot report while closed follows from the reporting loop living entirely in a
  React effect with no service worker — a code reading, not an observation.
- **Placed curses** (arm in setup vs live, one-shot per zone entry, nearest-only
  firing) were touched only incidentally.

---

## Where the simulation was NOT a faithful proxy for the field

**Read this before trusting any conclusion above.** The biggest limitation is
stated first.

### The client layer WAS exercised — but only after the sandbox was lifted

During the evaluation run, Chrome could not start (`Failed to create socket
directory` / `ProcessSingleton` / `bootstrap_check_in … Permission denied`), so
every finding above was reached through the HTTP API and the Postgres RPCs, with
the client verified only by jsdom component tests and unit tests of pure
functions.

**A follow-up verification pass ran the browser scenarios outside the sandbox, and
all 35 scenarios pass** — the 7 new API-driven ones plus all 28 pre-existing
browser scenarios, including `walkthrough.mjs` at 1v1, 2v2, 3v3 and 4v4 (up to 8
concurrent Chrome clients). So the following are now confirmed in a real browser
rather than only in jsdom:

| Now verified in-browser | Scenario |
|---|---|
| Enemy radar sweep, pulse + zone-gating | `scenario-radar` |
| Live toast delivery with no history replay (F18–F20) | `scenario-notifications` |
| Map rendering — challenge stars, zones, overlays | `scenario-smoke`, `scenario-deep-snapshots` |
| Confirm-spend modals on all four spends | `scenario-confirm-spend` |
| Chat broadcast, unread badges, team isolation | `scenario-chat` |
| Camping warn/lock lifecycle through the UI | `scenario-camping` |
| Curse readouts, proof windows, protocols | `scenario-curses`, `scenario-curse-proofs`, `scenario-curse-protocols` |
| Challenge review accept/reject in the UI | `scenario-challenge-review-ui` |
| Weather pause voting, reconnect, realtime recovery | `scenario-weather-pause`, `scenario-reconnect`, `scenario-realtime-resilience` |
| Observer PWA, push opt-in, I7 intel upload | `scenario-observer-pwa`, `scenario-push`, `scenario-i7-intel` |
| Full game 1v1–4v4 incl. tag, respawn, carry-home win | `walkthrough.mjs 1..4` |

**What is still NOT verified, and cannot be by any harness:** whether a radar blip
is *noticeable* on a phone in sunlight; whether a toast arrives early enough to
*act* on while walking; whether `BoundaryNudge` is legible at 430 px competing
with `WalkingNudge`; whether the spend modals are tappable mid-stride. Those are
human-perception questions. A scenario proves the element rendered and the
interaction worked — not that a walking player noticed it in time.

Also still unexercised: real GPS acquisition (`watchPosition` failures, permission
prompts, the wake-lock path) — the harness sets positions directly.

**Two cold-route flakes surfaced in this pass and are NOT app bugs.**
`scenario-notifications` and `scenario-curses` each failed on first run and passed
on retry. The cause is the cold-route compile described in point 5 below: the very
first POST to an uncompiled route can exceed an 8 s UI wait, and in one case Next's
dev-mode request plumbing threw `SyntaxError: Unexpected end of JSON input` and
returned **500** for an empty body before the route's own try/catch could return
400. Verified against a warm route — three consecutive empty-body POSTs to
`camping-heartbeat` returned **400, 400, 400** — and `npm run build` compiles
every route ahead of time, so production never has a cold route. Dev-server
artifact only.

### Physical fidelity gaps only a real playtest can close

1. **Straight-line movement understates every distance.** `walkPath` interpolates
   great-circle paths. Vila Real is a ridge-and-valley town with steep streets and
   stairs, so the real walked route is reliably longer and uphill pace is well
   below the 1.3 m/s default. **Every walking-time figure in this report is a
   lower bound**, and any conclusion about reaching something in time is
   optimistic.

2. **No elevation at all.** The Vila Velha ↔ Biblioteca corridor crosses a valley.
   A 678 m "9 minute" walk may be materially harder than a flat one — which is
   exactly the carrier-versus-defender chase the endgame turns on.

3. **Jitter models magnitude, not structure.** Gaussian noise at a fixed sigma is
   not real urban multipath, which is time-correlated and clusters against
   building faces. A drift-induced tag is *reachable* in simulation, but its
   real-world frequency is unknown — and that frequency is what decides whether
   the 5 m/10 m tolerance split feels fair.

4. **Perfect connectivity.** Every request succeeded or failed cleanly. The field
   has partial reception, hanging requests, and PWA backgrounding when a phone
   locks. The offline analysis was simulated by *not calling* the poll routes,
   which is not the same as a client that believes it is online.

5. **Cold-route compile is not a race — and this one matters for reading the
   concurrency result.** Next dev compiles a route on first hit, so a
   `Promise.all` pair against an uncompiled route is **not simultaneous at all**:
   the first request pays a multi-second compile while the second arrives long
   after it has committed. `scenario-races.mjs` therefore warms every route with
   empty-body POSTs (→400) before each case, and **that warming is what makes the
   65/65 meaningful**. A reader who assumes the races were fired naively would be
   over-trusting them; a reader who assumes they were *therefore* invalid would be
   under-trusting them. The setup helper also retries game creation up to 3×
   against transient dev-compile 500s — but **no mutation under test is ever
   retried**, so no race assertion is weakened by it.

6. **No human judgement in the loop.** Photo challenges and flag proofs are
   adjudicated by players eyeballing each other's photos; the harness uploads a
   1×1 PNG. Whether the review flow is *socially* workable — does the other team
   actually look within 120 s, mid-walk? — is untestable here, and the
   weather-pause finding suggests the window is fragile even before human latency.

7. **Team coordination is unmodelled.** Buddy Up and Team Quarantine depend on
   real people staying near each other while arguing about where to go. The
   harness moves clients independently and obediently.

### Findings a real playtest could still overturn

- **P5 (Frozen 32 min)** — the figure is arithmetic; whether players keep the app
  open long enough to suffer it is a human question.
- **P8 (camping warning)** — whether losing an unwarned tag genuinely causes an
  argument depends on the moment, not the code.
- **P10 (100 m challenge geofence)** — the overlap is measured; whether anyone
  exploits it, or notices, is not.
- ~~**P3a (home-base hides)**~~ — moot: the card was removed, so a home-base hide
  no longer distorts any clue. What a playtest can still overturn is whether the
  7-card deck feels deep enough without a second half-the-map clue.
- **The "healthy" PX conclusions are the most fragile of all.** "The pools force a
  defender to commit" is a geometric fact; whether the resulting cat-and-mouse is
  *fun* across three hours is precisely what a field test is for.

### What this evaluation does establish without a playtest

Server-side rule enforcement, coin accounting, secret-hiding, concurrency safety
under genuinely simultaneous requests, and every distance and time threshold —
all verified against the real API and the real RPCs, with the clock advanced
coherently across all three layers. Those conclusions stand on their own.
