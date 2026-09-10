import { notifyPlacedCurseTriggered } from '@/lib/server/placedCursePush'
import { sendPushToTeam } from '@/lib/push/server'

jest.mock('@/lib/push/server', () => ({
  sendPushToTeam: jest.fn().mockResolvedValue(undefined),
}))

describe('placed curse push boundary', () => {
  it('awaits one team-targeted notification with the triggered curse', async () => {
    await notifyPlacedCurseTriggered({
      gameId: 'game-1',
      gameCode: 'ABCD',
      targetTeamId: 'team-east',
      curseName: 'Frozen',
    })

    expect(sendPushToTeam).toHaveBeenCalledTimes(1)
    expect(sendPushToTeam).toHaveBeenCalledWith('game-1', 'team-east', {
      title: 'Your team has been cursed',
      body: 'Your team triggered a placed curse: Frozen',
      tag: 'cursed',
      url: '/game/ABCD',
    })
  })
})
