# Test Summary

Generated on 2026-06-18 for the Jest/React Testing Library suite.

## Verification

| Command | Result |
|---|---|
| `npm test -- --runInBand` | 22 suites passed, 59 tests passed |
| `npm run test:coverage -- --runInBand` | Passed, coverage generated |
| `npm run typecheck` | Passed |

Note: `npm test` initially failed because Watchman attempted to write under `~/.local/state/watchman`; Jest now has `watchman: false` in `jest.config.js`.

## Coverage Snapshot

Coverage command:

```bash
npm run test:coverage -- --runInBand
```

| Area | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All collected files | 44.79% | 30.65% | 41.74% | 46.15% |
| `lib/geo` | 100% | 100% | 100% | 100% |
| `lib/intel` | 72.00% | 59.61% | 75.00% | 75.47% |
| `lib/results` | 98.30% | 79.31% | 100% | 98.14% |
| `lib/hooks` | 63.37% | 48.36% | 62.62% | 66.11% |
| `components/game` | 26.59% | 24.44% | 34.53% | 27.01% |

The game-logic target is effectively met for the core pure modules currently tested (`geo`, `intel`, `results`). The full collected total is lower because the requested coverage collection includes large untested UI/map surfaces and Supabase client wrappers.

## Implemented Tests

- Game logic: haversine distances, defense zones, intel narrowing, intel overlays, timeout scoring.
- Hooks: live realtime, GPS, tag eligibility, flag attempt eligibility, Presence, camping, curse enforcement, discovered enemy kinds, placed curse trigger, curse expiry poll.
- Components: TagButton, ActiveCursesBanner, HardenFlagButton, IntelCardDisplay, RespawnBanner, FlagFoundBanner, GameOverOverlay.
- Shared harness: `jest.setup.ts`, `jest.config.js`, `tests/test-utils.tsx`, Supabase/GPS/Storage/Presence mocks, Zustand reset helpers, factories.

## Gaps

- API route schemas are inventoried but not directly tested yet because the schemas are local to route modules; the next pass should either export schemas or test route handlers with mocked Supabase chains.
- Untested high-value components: `FlagAttemptButton`, `IntelPurchasePanel`, `CursePurchasePanel`, `PlacedCursePanel`, `ChallengesPanel`, `FlagCarrierBanner`.
- Untested supporting UI/history: `ChallengeHistoryList`, `CurseHistoryList`, `ToastLayer`, `RememberGameCode`, `components/ui/*`.
- Map components are not covered; meaningful map tests should mock Leaflet/react-leaflet or use browser-level visual tests.
- Current i18n code uses locales `en` and `pt`. Several legacy components still hard-code English despite available translation keys; the inventory marks these localization gaps.

No tests are skipped or pending.
