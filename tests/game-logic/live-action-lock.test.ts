import { resolveLiveActionLock } from '@/lib/liveActionLock'

describe('live action lock', () => {
  it('locks regular actions while respawning but leaves the respawn CTA unlocked', () => {
    expect(resolveLiveActionLock({
      weatherPaused: false,
      weatherLabel: 'weather',
      curseLocked: false,
      curseLabel: null,
      respawning: true,
      respawnLabel: 'respawn required',
    })).toEqual({
      actionsLocked: true,
      lockedLabel: 'respawn required',
      respawnLockedLabel: null,
    })
  })

  it('still locks respawn confirmation for weather pause or Full Stop', () => {
    expect(resolveLiveActionLock({
      weatherPaused: true,
      weatherLabel: 'weather',
      curseLocked: true,
      curseLabel: 'full stop',
      respawning: true,
      respawnLabel: 'respawn required',
    }).respawnLockedLabel).toBe('weather')
  })
})
