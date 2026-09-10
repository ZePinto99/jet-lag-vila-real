-- Migration 0038: Hot/Cold is an immutable purchase-time bracket. A previous
-- client experiment stored the real flag coordinates in card.payload.target,
-- which turned a 60-coin clue into an exact live tracker. Remove that secret
-- from every historical row; live-state also sanitizes defensively.

update public.cards
set payload = coalesce(payload, '{}'::jsonb) - 'target',
    updated_at = now()
where kind = 'intel'
  and ref = 'intel.hot-cold'
  and coalesce(payload, '{}'::jsonb) ? 'target';
