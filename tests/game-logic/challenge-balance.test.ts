/** @jest-environment node */

import challenges from '@/data/challenges.json'
import landmarks from '@/data/landmarks.json'

describe('challenge geography balance', () => {
  it('has five West, five East, four neutral, and one anywhere challenge', () => {
    const poolByRef = new Map(landmarks.map((landmark) => [landmark.id, landmark.team_pool]))
    const counts = { west: 0, east: 0, neutral: 0, anywhere: 0 }
    for (const challenge of challenges) {
      if (challenge.landmark_ref === null) counts.anywhere += 1
      else {
        const pool = poolByRef.get(challenge.landmark_ref)
        if (pool === 'west' || pool === 'east' || pool === 'neutral') counts[pool] += 1
      }
    }
    expect(counts).toEqual({ west: 5, east: 5, neutral: 4, anywhere: 1 })
  })

  it('uses permanent proof targets and the rebalanced rewards', () => {
    expect(challenges.find((challenge) => challenge.id === 'challenge.largo-pelourinho-cardinals')).toMatchObject({ reward_coins: 30 })
    expect(challenges.find((challenge) => challenge.id === 'challenge.parque-florestal-birds')).toMatchObject({ reward_coins: 40 })
    expect(challenges.find((challenge) => challenge.id === 'challenge.mercado-price-sign')).toMatchObject({ landmark_ref: 'landmark.capela-sao-lazaro' })
    expect(challenges.find((challenge) => challenge.id === 'challenge.train-station-clock')).toMatchObject({ landmark_ref: 'landmark.jardim-da-carreira' })
    expect(challenges.find((challenge) => challenge.id === 'challenge.avenida-statue-inscription')).toMatchObject({ landmark_ref: 'landmark.igreja-sao-pedro' })
  })
})
