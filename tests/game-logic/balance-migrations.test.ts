/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TAG_COIN_PENALTY } from '@/lib/gameConstants'

function migration(name: string): string {
  return readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8')
}

describe('balance migration contracts', () => {
  it('removes legacy Hot/Cold targets', () => {
    expect(migration('0038_strip_hot_cold_target.sql')).toContain("payload, '{}'::jsonb) - 'target'")
  })

  it('applies the batch intel loss after all per-player tags', () => {
    const sql = migration('0039_one_intel_loss_per_tag_action.sql')
    expect(sql.indexOf('foreach v_raider_id')).toBeLessThan(sql.indexOf('select * into v_victim'))
  })

  describe('0058 — a tag fines coins instead of expiring intel', () => {
    const sql = () => migration('0058_tag_drains_coins_not_intel.sql')

    it('fines a flat amount clamped at the team balance, so it can never go negative', () => {
      // `greatest(0, ...)` guards a null/negative balance; `least(40, ...)` is the
      // clamp that makes a broke team pay what it has rather than overdraw.
      expect(sql()).toContain('least(40, greatest(0, coalesce(v_raider_coins, 0)))')
    })

    it('no longer touches intel cards at all', () => {
      // The whole point of 0058: the old rule expired a card whose answer the
      // client had already been shown, so it confiscated a map overlay rather
      // than the knowledge.
      expect(sql()).not.toContain("state = 'expired'")
      expect(sql()).not.toContain("kind = 'intel'")
    })

    it('fines once per Tag ACTION, after the per-raider loop, not once per raider', () => {
      expect(sql().indexOf('foreach v_raider_id')).toBeLessThan(
        sql().indexOf('select coins into v_raider_coins'),
      )
    })

    it('writes the ledger event before mutating the materialised counter', () => {
      // Project-wide rule for every coin mutation: event first, then teams.coins,
      // same transaction.
      const text = sql()
      expect(text).toContain("'reason', 'tag_penalty'")
      expect(text.indexOf("insert into public.events")).toBeLessThan(
        text.indexOf('update public.teams set coins = coins - v_drain'),
      )
    })

    it('skips the ledger write entirely when there is nothing to take', () => {
      expect(sql()).toContain('if v_drain > 0 then')
    })

    it('preserves 0044 precondition — recreating an RPC must not revert later guards', () => {
      // An earlier draft of 0058 was built from 0039, which predates 0044, and
      // silently dropped the "every requested id must still be a valid raider"
      // check. scenario-races caught it (the batch raised
      // tag_batch_invariant_failed from inside the loop instead of returning a
      // clean target_state_changed). This pins it so the same mistake cannot
      // land twice.
      expect(sql()).toContain('v_valid_raider_count <> cardinality(p_raider_player_ids)')
      expect(sql()).toContain('v_valid_raider_count integer;')
    })

    it('agrees with the TAG_COIN_PENALTY constant the guide quotes', () => {
      expect(TAG_COIN_PENALTY).toBe(40)
      expect(sql()).toContain(`least(${TAG_COIN_PENALTY},`)
    })
  })

  it('requires every requested bulk-tag target to remain a valid raider', () => {
    const sql = migration('0044_bulk_tag_precondition_count.sql')
    expect(sql).toContain('v_valid_raider_count <> cardinality(p_raider_player_ids)')
    expect(sql.indexOf('v_valid_raider_count <>')).toBeLessThan(sql.indexOf('foreach v_raider_id'))
  })

  it('serializes attempt-start cooldowns', () => {
    const sql = migration('0040_atomic_flag_attempt_start.sql')
    expect(sql).toContain("interval '60 seconds'")
    expect(sql).toContain("interval '15 seconds'")
  })

  it('checks active placed effects before disarming', () => {
    const sql = migration('0041_preserve_blocked_placed_curses.sql')
    expect(sql.indexOf('if exists (')).toBeLessThan(sql.indexOf('update public.placed_curses'))
  })

  it('checks one-shot curse eligibility before charging and reuses the locked intel victim', () => {
    const sql = migration('0046_authoritative_curse_eligibility_and_expiry.sql')
    expect(sql).toContain("jsonb_build_object('error', 'no_available_curse'")
    expect(sql.indexOf("p_curse_ref = 'curse.intel-loss'")).toBeLessThan(
      sql.indexOf("'reason', 'buy_curse'"),
    )
    expect(sql).toContain('where id = v_victim.id;')
  })

  it('serializes expiry with normal and placed same-ref casts', () => {
    const buySql = migration('0046_authoritative_curse_eligibility_and_expiry.sql')
    const placedSql = migration('0047_placed_curse_expired_reentry.sql')
    const orderingSql = migration('0049_serialize_curse_expiry_with_game_actions.sql')
    expect(buySql).toContain('pg_advisory_xact_lock')
    expect(buySql.indexOf("'curse_expired'")).toBeLessThan(
      buySql.indexOf('delete from public.active_curses where id = v_row.id'),
    )
    expect(placedSql.indexOf('expire_active_curse_ref_locked')).toBeLessThan(
      placedSql.indexOf('update public.placed_curses set'),
    )
    expect(orderingSql.indexOf('from public.games where id = p_game_id for update')).toBeLessThan(
      orderingSql.indexOf('v_expired := public.expire_active_curse_ref_locked'),
    )
  })

  it('requires 120 seconds and pending state for automatic challenge awards', () => {
    const sql = migration('0042_challenge_review_auto_accept.sql')
    expect(sql).toContain("v_card.state <> 'pending'")
    expect(sql).toContain("interval '120 seconds'")
    expect(sql).toContain('award_challenge_atomic_unchecked')
  })

  it('settles due bonuses and awards no curse or coin primary points at timeout', () => {
    const sql = migration('0043_authoritative_time_bonus_and_timeout_scoring.sql')
    expect(sql).toContain('select public.apply_time_bonus_interval(')
    expect(sql).toContain("'curse_points', 0")
    expect(sql).toContain("'coin_points', 0")
  })

  it('caps late time-bonus settlement at the configured game duration', () => {
    const sql = migration('0045_cap_time_bonus_intervals.sql')
    expect(sql).toContain('v_max_intervals := floor(v_duration_min / 30.0)')
    expect(sql).toContain('v_due_intervals := least(v_max_intervals, v_elapsed_intervals)')
  })

  it('uses submitted_at authoritatively for challenge review age', () => {
    const sql = migration('0048_challenge_review_submitted_at.sql')
    expect(sql).toContain("v_card.payload->>'submitted_at'")
    expect(sql).toContain('coalesce(v_submitted_at, v_card.updated_at)')
  })

  // P11: a weather pause used to consume the whole 120 s challenge-review
  // window, because resume shifted games.started_at and active_curses but not
  // the review deadline that 0048 reads off cards.payload.submitted_at.
  it('shifts the pending challenge review deadline across a weather pause', () => {
    const sql = migration('0050_pause_shifts_challenge_review_window.sql')
    // Both timestamps 0048 can read must move by the paused duration.
    expect(sql).toContain("jsonb_set(\n              payload,\n              '{submitted_at}'")
    expect(sql).toContain('set updated_at = updated_at + make_interval(secs => v_pause_seconds)')
    // Only still-pending challenge cards in this game.
    expect(sql).toContain("and kind = 'challenge'")
    expect(sql).toContain("and state = 'pending'")
    // A malformed payload must not abort the resume; it keeps the fallback.
    expect(sql).toContain("pg_input_is_valid(payload->>'submitted_at', 'timestamptz')")
    // The shift belongs to the resume branch, after the active_curses shift and
    // before the games row is restored — otherwise a pause could still award.
    const cursesShift = sql.indexOf('update public.active_curses')
    const cardsShift = sql.indexOf("'{submitted_at}'")
    const gamesRestore = sql.indexOf('update public.games set status = v_prior_status')
    expect(cursesShift).toBeGreaterThan(-1)
    expect(cursesShift).toBeLessThan(cardsShift)
    expect(cardsShift).toBeLessThan(gamesRestore)
  })

  // P5: Frozen's self-reported violations stretched an 8-min curse to 32 min,
  // so a player who closed the app served 8 and an honest one served up to 32.
  it('clamps the Frozen extension ceiling to 1.5x inside the RPC', () => {
    const sql = migration('0051_frozen_extension_ceiling.sql')
    expect(sql).toContain('v_max_factor constant numeric := 1.5')
    // Clamped from the caller's value, so no route can reinstate 4x.
    expect(sql).toContain('v_factor := least(p_max_extension_factor::numeric, v_max_factor)')
    // The ceiling term must use the clamped factor, not the raw parameter.
    expect(sql).toContain('p_nominal_duration_seconds*v_factor')
    expect(sql).not.toContain('p_nominal_duration_seconds*p_max_extension_factor')
    // The clamp has to happen before the expiry is recomputed.
    expect(sql.indexOf('v_factor := least(')).toBeLessThan(sql.indexOf('v_expires_at:=least('))
    // Mechanisms P5 explicitly keeps: per-second dedupe + first-write-wins anchor.
    expect(sql).toContain('on conflict do nothing')
    expect(sql).toContain("raise exception 'frozen_anchor_required'")
  })

  // P13: with every client offline nothing polled /expire-curses, so timed
  // curses read as permanent while being inert.
  it('sweeps expired curses server-side, skipping paused games', () => {
    const sql = migration('0052_pg_cron_curse_expiry.sql')
    expect(sql).toContain('create extension if not exists pg_cron')
    expect(sql).toContain("cron.schedule(\n      'expire-curses-sweep',\n      '30 seconds'")
    // Only in-play games: expiring mid-pause would steal time that resume owes
    // back (0027/0050 shift every expires_at forward by the paused duration).
    expect(sql).toContain("where g.status in ('live', 'flag_found')")
    // Reuses the audited atomic path rather than deleting rows itself.
    expect(sql).toContain('public.expire_curses_atomic(v_game_id, null)')
    expect(sql).not.toMatch(/delete\s+from\s+public\.active_curses/i)
    // One stuck game must not abort the sweep for every other game.
    expect(sql).toContain("set local lock_timeout = '2s'")
    expect(sql).toContain('exception when others then')
    // Housekeeping stays service-role only.
    expect(sql).toContain('revoke all on function public.sweep_expired_curses() from public, anon, authenticated')
  })
})
