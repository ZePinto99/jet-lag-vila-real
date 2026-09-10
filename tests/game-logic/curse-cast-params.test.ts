import { buildCurseCastParams } from '@/lib/curses/castParams'

describe('buildCurseCastParams', () => {
  it('selects a deterministic neutral landmark for Pilgrimage', () => {
    expect(buildCurseCastParams('curse.pilgrimage', { geofence_required: true }, () => 0))
      .toEqual({
        geofence_required: true,
        target_landmark_ref: 'landmark.igreja-dos-clerigos',
      })
  })

  it('persists one deterministic named geometry for Detour', () => {
    const params = buildCurseCastParams('curse.detour', { banned_street_random: true }, () => 0)
    expect(params).toEqual(
      expect.objectContaining({
        banned_street_random: true,
        banned_street_id: 'street.avenida-carvalho-araujo',
        banned_street_name: 'Avenida Carvalho Araújo',
        corridor_m: 18,
      }),
    )
    expect(params.banned_street_polyline).toEqual(expect.arrayContaining([[41.2943, -7.7462]]))

    const lastEnabled = buildCurseCastParams('curse.detour', {}, () => 0.999)
    expect(lastEnabled.banned_street_id).toBe('street.rua-dom-pedro-de-castro')
    expect(lastEnabled.banned_street_id).not.toBe('street.rua-senhora-de-lourdes')
  })

  it('leaves non-targeted curse parameters unchanged', () => {
    expect(buildCurseCastParams('curse.slow-walk', { max_speed_kmh: 2.5 }, () => 0))
      .toEqual({ max_speed_kmh: 2.5 })
  })
})
