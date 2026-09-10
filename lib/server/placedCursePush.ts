import { sendPushToTeam } from '@/lib/push/server'

export async function notifyPlacedCurseTriggered(args: {
  gameId: string
  gameCode: string
  targetTeamId: string
  curseName: string
}): Promise<void> {
  await sendPushToTeam(args.gameId, args.targetTeamId, {
    title: 'Your team has been cursed',
    body: `Your team triggered a placed curse: ${args.curseName}`,
    tag: 'cursed',
    url: `/game/${args.gameCode}`,
  })
}
