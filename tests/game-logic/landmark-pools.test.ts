/** @jest-environment node */

import flagChallenges from '@/data/flag-attempt-challenges.json'
import landmarks from '@/data/landmarks.json'
import { haversineMeters } from '@/lib/geo/haversine'

const pools = {
  west: landmarks.filter((landmark) => landmark.team_pool === 'west'),
  east: landmarks.filter((landmark) => landmark.team_pool === 'east'),
}

const homes = {
  west: landmarks.find((landmark) => landmark.id === 'landmark.miradouro-vila-velha')!,
  east: landmarks.find((landmark) => landmark.id === 'landmark.biblioteca-municipal')!,
}

function maxHomeDistance(side: keyof typeof pools): number {
  return Math.max(
    ...pools[side].map((landmark) => haversineMeters(homes[side], landmark)),
  )
}

function overlappingDefensePairs(side: keyof typeof pools): number {
  let count = 0
  for (let i = 0; i < pools[side].length; i += 1) {
    for (let j = i + 1; j < pools[side].length; j += 1) {
      if (haversineMeters(pools[side][i], pools[side][j]) < 400) count += 1
    }
  }
  return count
}

describe('landmark pool balance', () => {
  it('offers seven candidate landmarks to each team', () => {
    expect(pools.west).toHaveLength(7)
    expect(pools.east).toHaveLength(7)
  })

  it('keeps the teams within a comparable home radius and defense-zone density', () => {
    const westRadius = maxHomeDistance('west')
    const eastRadius = maxHomeDistance('east')

    expect(westRadius).toBeLessThan(1_400)
    expect(eastRadius).toBeLessThan(1_400)
    expect(Math.abs(westRadius - eastRadius)).toBeLessThan(200)
    expect(
      Math.abs(overlappingDefensePairs('west') - overlappingDefensePairs('east')),
    ).toBeLessThanOrEqual(1)
  })

  it('authors a flag-attempt challenge for every candidate', () => {
    const authoredRefs = new Set(flagChallenges.map((challenge) => challenge.landmark_ref))
    expect([...pools.west, ...pools.east].filter(({ id }) => !authoredRefs.has(id))).toEqual([])
  })

  it('keeps removed candidates out of respawn and Pilgrimage selection', () => {
    const retired = landmarks.filter((landmark) => landmark.team_pool === 'retired')
    expect(retired.map((landmark) => landmark.id)).toEqual([
      'landmark.utad-main-library',
      'landmark.utad-jardim-botanico',
      'landmark.utad-geosciences-museum',
      'landmark.igreja-da-conceicao',
      'landmark.largo-do-pioledo',
    ])
  })

  it('includes the first-train memorial in the neutral respawn pool', () => {
    expect(landmarks.find((landmark) => landmark.id === 'landmark.homenagem-chegada-primeiro-comboio')).toMatchObject({
      team_pool: 'neutral',
      lat: 41.2952131,
      lng: -7.7391591,
    })
  })
})
