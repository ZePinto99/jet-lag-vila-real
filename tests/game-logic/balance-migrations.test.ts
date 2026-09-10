/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
})
