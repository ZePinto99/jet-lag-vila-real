# Jet Lag: Vila Real — Rulebook v0.1

A walking-only Capture the Flag game inspired by Jet Lag: The Game, set in Vila Real, Portugal. Players hunt for an enemy flag hidden among decoy landmarks while managing coins, curses, and intel through a self-serve referee app.

> **Status:** Draft. Numbers and lists are starting points to tune in playtest.
> **Local verification needed:** landmark names, walking times, and challenge details rely on general Vila Real knowledge and should be confirmed on the ground before play.

---

## 1. Overview

- **Format:** Two teams. Each team hides a flag in their own territory among a set of candidate landmarks. The first team to photograph the enemy flag and return to their own home base wins.
- **Players:** 4–8, split into two equal teams.
- **Duration:** ~4 hours total. 30 min setup, 3 hr play, 30 min wrap.
- **Movement:** Walking only. No buses, scooters, taxis, lifts.
- **Referee:** A web app. No human GM required.

---

## 2. Players and teams

- 2 teams of 2–4 players each. No captain role — every player can buy intel and cast curses in the app at any time.
- One phone per team minimum, ideally one per player. Players install the PWA before the game.

---

## 3. Map and landmarks

### 3.1 Boundaries

Play area is the **City of Vila Real plus Casa de Mateus and UTAD campus**. Anything outside this perimeter is out of bounds. The app shows the perimeter as a polygon.

### 3.2 Home bases

- **Team West:** UTAD main campus
- **Team East:** Casa de Mateus

These are the two anchor points of the game. Each team picks 5 candidate landmarks from their **team pool** (§3.3) — the pools mostly reflect proximity to the home base, though Vila Real's compact geography means some city-centre landmarks could plausibly belong to either team. Tag eligibility is governed by **defense zones** around each candidate (§6), not by an east/west territorial line.

### 3.3 Landmark pool

Each team picks **5 candidate landmarks** from their territory's pool at game start. Of those 5: **1 holds the real flag**, **2 hold decoys**, **2 are empty**. The app records the assignments secretly.

#### Team West candidate pool (UTAD side)

1. UTAD Main Library
2. UTAD Jardim Botânico (botanical garden)
3. UTAD Geosciences Museum
4. Parque Florestal de Vila Real
5. Igreja da Conceição
6. Estação Ferroviária de Vila Real (train station)
7. Mercado Municipal
8. Nosso Shopping

#### Team East candidate pool (Mateus side)

1. Main Gate of Palácio de Mateus
2. Igreja de Mateus
3. Sé Catedral de Vila Real
4. Igreja dos Clérigos (Capela Nova)
5. Casa de Diogo Cão
6. Largo do Pelourinho
7. Câmara Municipal de Vila Real

#### Neutral / shared landmarks

Used for tag respawns and challenge sites:

- Avenida Carvalho Araújo (midpoint)
- Ponte Metálica do Corgo
- Teatro de Vila Real
- Estação Rodoviária

> **TODO:** verify each landmark exists, is publicly accessible, and is open during the play window. Add precise GPS coordinates in the app config.

### 3.4 Walking budget reality check

From city center (Sé), approximate one-way walking times:

| Landmark | Time |
|---|---|
| Pelourinho, Capela Nova | <5 min |
| Forum, Mercado, train station | 5–15 min |
| UTAD campus | ~25 min |
| Casa de Mateus | ~45 min |

A single round trip UTAD ↔ Mateus is ~70 min of walking. Plan curses and intel costs accordingly.

---

## 4. Game phases

### 4.1 Setup (30 min)

1. Players assemble at the city-center neutral landmark (Sé).
2. Teams form, captains assigned, app accounts created and joined to the game.
3. Teams walk to their home bases. Timer does not start yet.
4. At home base, the team collectively selects 5 candidate landmarks and secretly assigns: 1 real flag, 2 decoys, 2 empty. Any team member can do this in the app.
5. Each team physically places a printed marker (provided) at the real flag and decoy locations. Empty landmarks get nothing.
6. Both teams confirm "ready" in the app. Game timer starts.

### 4.2 Play (3 hours)

Open play. Teams freely move, raid, defend, complete challenges, buy intel, cast curses. See sections 5–8.

### 4.3 Endgame trigger

Game ends when **either**:
- A team's raider photographs the enemy real flag (validated on the spot) and subsequently crosses their own home base geofence (winner declared by app), **or**
- The 3-hour timer expires (see tiebreaker, §11).

### 4.4 Wrap (30 min)

Teams return to Sé. App shows full event log, winner, and stats.

---

## 5. Flag mechanics

### 5.1 Markers

Each team prints 3 numbered markers before the game:

- **Marker R** (real flag)
- **Marker D1, D2** (decoys)

All three markers look identical from the outside (same envelope or printed sheet). The difference is only visible when the raider opens / scans / photographs the assigned detail (see §5.3).

### 5.2 Photographing a flag

When a raider reaches a candidate landmark:

1. They tap "Attempt flag" in the app at the landmark (geofence-checked, must be within 20 m).
2. The app reveals the **challenge gate** for that landmark (see §5.3).
3. Raider completes the challenge and submits the photo.
4. App auto-validates by EXIF time + geolocation + presence of the marker code in the photo.
5. Result:
   - **Real flag:** photo accepted, raider must now return to home base to win.
   - **Decoy:** photo rejected, raider **loses all intel cards** and must return to a neutral landmark before raiding again.
   - **Empty:** no marker present. The attempt fails immediately, but no penalty beyond wasted time.

### 5.3 Challenge gating

Each candidate landmark, when attempted, requires the raider to perform a small **flag challenge**: a Vila Real–specific photo task tied to the landmark. Examples:

- *Sé Catedral:* photograph the bell-tower clock from the south facade with the marker visible in foreground.
- *Casa de Mateus:* photograph yourself at the central garden topiary with the marker.
- *UTAD Botanical:* photograph a labeled plant species starting with the same letter as your team name.

Defenders can spend **150 coins** to **harden** their own flag's challenge once during the game (the app upgrades the task to a harder variant). Cannot be hardened twice.

---

## 6. Tag rules

Vila Real's geography (UTAD and the historic centre are both on the west side; only Mateus is far east) makes a strict east/west midline meaningless. Instead, defending territory follows your **flag candidates**:

- A team's **defense zone** is the union of **200 m circles** around each of the team's 5 candidate landmarks.
- A **defender** is any player currently inside their own defense zone.
- A **raider** is any player currently outside their own defense zone (and presumably approaching enemy candidates).
- When a defender comes within **5 m** of any enemy raider, a **Tag button activates automatically** in the app. Tapping it tags **every adversary currently within that 5 m radius** simultaneously — a single tap catches an entire raiding party if they're bunched together. The app enables the button only when GPS confirms (a) the defender is inside their own defense zone and (b) the proximity threshold is met. The tag is recorded server-side against both players' coordinates at that timestamp.
- **Camping rule:** defenders cannot stand within 50 m of any of their own candidate landmarks for more than 2 consecutive minutes. The app warns at 90 s and disables the Tag button at 120 s. They must leave the radius for at least 60 s to reset. (The 50 m no-stand zone sits inside the 200 m defense zone — you can patrol the donut between them freely.)
- A tagged raider:
  - Loses **1 intel card** (random)
  - Must walk to the nearest **neutral landmark** before raiding again (app enforces with geofence)
  - Cannot be tagged again until they leave the neutral landmark

---

## 7. Coin economy

### 7.1 Starting balance

- Each team starts with **100 coins**.

### 7.2 Earning coins

- **Challenges:** 20–60 coins each, based on difficulty. See §9.
- **Time bonus:** every 30 minutes of game time, each team earns +20 coins automatically.
- **First blood:** the first team to complete any challenge earns +30 coins.

### 7.3 Spending coins

| Action | Cost |
|---|---|
| Buy 1 intel card | 30–80 (varies by intel type) |
| Buy 1 curse die | 50 |
| Roll up to 3 dice combined | 50 × number of dice |
| Harden own flag challenge (one-time) | 150 |

---

## 8. Card decks

Three decks live in the app. Drawing/buying from a deck is a server action that mutates team state.

### 8.1 Challenges (earn coins)

- Open the Challenges tab in the app.
- See up to 3 active challenges at any time, refreshed when completed.
- Each challenge has: location, task, photo proof requirement, coin reward.
- Submit photo → app validates → coins credited.

### 8.2 Curses (slow the enemy)

- Any player spends 50 coins per die, rolls 1–3 dice.
- Higher total → stronger curse drawn from the curse deck.
  - Roll 1–3: minor curse (5–10 min)
  - Roll 4–8: medium curse (10–20 min)
  - Roll 9+: major curse (20+ min or one-shot disruption)
- Curse is applied to the *enemy team*. App pushes a notification, starts a timer, and enforces compliance through prompts.

### 8.3 Intel (find the real flag)

- Any player buys intel cards. Each card reveals partial info about the enemy team's flag assignment.
- Intel is **persistent**: stays in the team's view until the game ends or the team is tagged (loses 1 card).

---

## 9. Challenge reference (Vila Real–flavored)

Starter set. Each challenge specifies location + task + reward. The app picks 3 active at a time and refreshes when one is completed.

| # | Location | Task | Reward |
|---|---|---|---|
| C1 | Sé Catedral | Photograph the date carved on the main facade | 30 |
| C2 | Largo do Pelourinho | Photograph the full pillory from 3 different cardinal directions | 40 |
| C3 | Avenida Carvalho Araújo | Find a statue, photograph the inscription | 30 |
| C4 | Igreja dos Clérigos (Capela Nova) | Count the windows visible from the street, submit number | 20 |
| C5 | Casa de Diogo Cão | Photograph the commemorative plaque | 30 |
| C6 | Palácio de Mateus | Buy a postcard at the gift shop and photograph it | 50 |
| C7 | Palácio de Mateus gardens | Photograph the central reflecting pool | 40 |
| C8 | UTAD Botanical | Photograph a tree with a Latin name placard, submit the name | 40 |
| C9 | UTAD Library | Photograph the main entrance with a teammate inside | 30 |
| C10 | Mercado Municipal | Photograph a vendor's price sign for any product | 20 |
| C11 | Train Station | Photograph the station clock and current time | 30 |
| C12 | Nosso Shopping | Photograph any storefront with the team's first letter | 20 |
| C13 | Ponte Metálica | Photograph the river from mid-bridge | 40 |
| C14 | Teatro de Vila Real | Photograph the current playbill | 30 |
| C15 | Câmara Municipal | Photograph the Portuguese flag at the building | 20 |
| C16 | Any landmark | Ask a local for the best pastel de nata in town, submit a quote | 60 |
| C17 | Parque Florestal | Photograph two different bird species (any) | 50 |
| C18 | Igreja de Mateus | Photograph the church facade with all team members | 40 |

> **TODO:** validate each location for accessibility and accuracy. Add 10–15 more.

---

## 10. Curse reference

Curses target the *enemy team*. App pushes the notification, starts the timer, and pings periodically to enforce.

Each curse is tagged with its **enforcement category**:

- **[A] GPS-verified** — app measures location/speed; breach = warning then penalty
- **[B] Photo-verified** — app prompts for proof photo, must submit within window
- **[C] Honor system** — app reminds, but no real check; trust + social pressure
- **[L] Ledger-only** — pure state mutation in the app (coins, intel, action lock); no field check needed

### Minor (rolls 1–3)

- **[A] Slow Walk** — 5 min, average speed must stay below 2.5 km/h (warn at 3, penalty at 4)
- **[B] Single File** — 5 min, team must walk in a single file; app prompts twice for group photo from the front
- **[B] Photo Tax** — 8 min, selfie at any sign every 90 s
- **[L] Check-in** — 10 min, captain must answer in-app prompts every minute (auto-locks captain actions on miss)

### Medium (rolls 4–8)

- **[A] Detour** — 15 min, banned from one named street (random); auto-flagged on entry
- **[A] Buddy Up** — 15 min, all team members within 10 m of each other
- **[B] Outfit Swap** — must swap one item of clothing with a teammate, keep it for 20 min; before/after photos
- **[C] Mute** — 15 min, may only communicate by typing in the app; app pings "still muted? ✓" each minute
- **[C] Backwards** — 10 min, must walk facing backwards (a teammate may guide); honor only
- **[B] Pose Patrol** — 12 min, every 2 min the app sends a pose ("hands on head") that must be photographed within 30 s

### Major (rolls 9+)

- **[A] Frozen** — 8 min, all team members stay within 10 m of position at curse start
- **[A] Pilgrimage** — must walk to a specific neutral landmark before any other action; geofence-gated
- **[L] Coin Drain** — lose 50 coins immediately
- **[L] Intel Loss** — discard 1 random intel card
- **[A] Solo Quarantine** — 15 min, team members must each be at least 50 m apart
- **[L] Full Stop** — 10 min, no app actions allowed (no purchases, no tags, no challenge submissions)

> Curses cannot stack on the same effect. If the enemy is already Frozen, a new Frozen does nothing — the app prevents purchase.

> **Note on Slow Walk:** earlier drafts included a "heel-to-toe" gait requirement. Dropped — GPS can prove slow speed but not gait, and heel-to-toe in public is uncomfortable for most players. Slow Walk by speed alone is the right tradeoff.

---

## 11. Intel reference

Each card reveals one piece of information about the *enemy team's* flag assignments.

| # | Card | Reveals | Cost |
|---|---|---|---|
| I1 | North/South | Whether the real flag is N or S of the city centre (lat 41.295) | 30 |
| I2 | East/West | Whether the real flag is E or W of the team's home base | 30 |
| I3 | Eliminate One | Names one of the 5 candidate landmarks that is *not* the real flag | 50 |
| I4 | Eliminate Two | Names two candidate landmarks that are *not* the real flag | 80 |
| I5 | Decoy Reveal | Names one of the two decoys (does not reveal real) | 60 |
| I6 | Hot/Cold | Distance bracket from your current GPS to real flag (<200 m / <500 m / <1 km / further) | 60 |
| I7 | Surroundings | One photo of the surroundings within 30 m of the real flag, no marker visible | 80 |
| I8 | Direction | Compass bearing from city center to real flag (8 cardinal directions) | 50 |
| I9 | Landmark Type | Reveals the *category* of the real flag (church, civic, park, museum, etc.) | 40 |

> **Anti-spam:** a team may not buy more than 4 intel cards total. Forces commitment and prevents the rich-get-richer spiral.

---

## 12. The app as referee — responsibilities

The app is the single source of truth. It must:

1. **Enforce geofences** for landmark attempts, tag proximity, and out-of-bounds warnings.
2. **Maintain coin ledger** as an append-only event log; UI shows derived balance.
3. **Adjudicate flag attempts:** validate photos by GPS + timestamp + marker code, return real/decoy/empty result.
4. **Enforce curses:** push notifications, run timers, prompt for compliance photos when required.
5. **Enforce camping limits:** detect a defender within 50 m of own landmark, warn at 90 s, lock tag at 120 s.
6. **Prevent retries on intel:** once bought, cannot refund; tagged player loses 1 random intel.
7. **Hide secret state:** real flag assignments visible only to the owning team's captain.
8. **Log every action** so the wrap-up can show a full timeline.

App **does not** mediate disagreements between players. If players disagree about something the app can't see (was a curse actually obeyed?), the affected team takes the screenshot and the group decides post-game. We encourage trust over enforcement.

---

## 13. Win conditions and tiebreakers

### Primary win

The flag photo is submitted and validated **on the spot** at the candidate landmark. The app immediately notifies both teams. The win triggers when the raider who submitted the photo **crosses the home base geofence** — no separate upload step required.

### Timeout tiebreaker (3-hour expiry, no winner)

Score by points:

- Photograph enemy real flag: **+10 pts**
- Each completed challenge: **+1 pt**
- Each successful tag: **+1 pt**
- Each curse cast: **+0.5 pt**
- Coins remaining at timeout: **+1 pt per 50 coins**

If still tied: most challenges completed wins. Then most coins. Then coin flip.

---

## 14. Glossary

- **Anchor / Home base:** team's start and finish landmark.
- **Candidate landmark:** one of 5 places where a team's flag *could* be.
- **Decoy:** a marker placed at a candidate landmark that is not the real flag.
- **Flag challenge / Challenge gate:** task required to claim a flag photo at a candidate landmark.
- **Flag carrier:** the player who submitted the validated flag photo; must reach home base geofence to trigger the win.
- **Intel:** information cards about the enemy flag.
- **Tag:** physical interception of a raider by a defender in their own territory.
- **Raider:** any player currently outside their own defense zone.
- **Defender:** any player currently inside their own defense zone (within 200 m of one of their own candidate landmarks).
- **Defense zone:** union of 200 m circles around each of a team's 5 candidate landmarks. Defines where you can tag enemies (§6).

---

## 15. Resolved decisions

All open questions resolved for v1. Listed here as a record.

1. **Pre-game scouting:** No. Captain assigns flags from home base only. Faster setup; less risk of accidental leaks while teams roam.
2. ~~**Midline as hard barrier:**~~ Obsolete. The midline territory mechanic was dropped during step 3 in favour of per-candidate defense zones (§6). Vila Real's geography (UTAD + historic centre both west, Mateus far east) makes a longitude split meaningless.
3. **Photo validation:** Auto-accept on geofence + EXIF check. Opposing captain may dispute within 60 s in-app; dispute escalates to a quick group decision. Trust + log.
4. **Phone discharge:** Players bring power banks. A dead phone means that player can't buy intel, cast curses, or trigger tags until recharged — honor-system play in the meantime. No captain transfer needed since there is no captain role.
5. **Inclement weather:** Either captain may call a "weather pause" in-app; the other captain must confirm within 5 min. Pause stops the game timer and all curse timers. Resume is also two-key. Decision to abort entirely is a group call.
6. **Curse compliance verification:** Mixed enforcement, tagged per curse in §10. Three categories: GPS-verified [A] for measurable movement (Slow Walk, Frozen, Detour, Buddy Up, Solo Quarantine, Pilgrimage), photo-verified [B] for state proof (Outfit Swap, Pose Patrol, Single File, Photo Tax), honor system [C] for the unverifiable (Mute, Backwards), ledger-only [L] for app-state effects (Coin Drain, Intel Loss, Full Stop, Check-in).
