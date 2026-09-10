export interface TeamSizeRestrictedDefinition {
  min_team_size?: number
}

/** Whether a catalog entry can be completed by a team of this size. */
export function supportsTeamSize(
  definition: TeamSizeRestrictedDefinition,
  teamSize: number,
): boolean {
  const minimum = definition.min_team_size ?? 1
  return Number.isInteger(teamSize) && teamSize >= minimum
}
