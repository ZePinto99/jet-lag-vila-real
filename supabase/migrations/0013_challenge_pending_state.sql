-- Migration 0013: allow the 'pending' card state (playtest item D14).
--
-- Photo challenges now sit in a `pending` state while the other team reviews
-- them (accept/reject). The original cards_state_check (migration 0001) didn't
-- include 'pending', so the submit-challenge UPDATE was rejected. Extend it.

alter table public.cards drop constraint if exists cards_state_check;
alter table public.cards
  add constraint cards_state_check
  check (state in ('available', 'in_hand', 'active', 'consumed', 'expired', 'pending'));
