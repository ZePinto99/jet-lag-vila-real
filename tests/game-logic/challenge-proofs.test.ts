import challenges from '@/data/challenges.json'
import { buildChallengeProofIndex, challengeProofUrl } from '@/lib/challenges/proofs'
import { makeEvent } from '../test-utils'

describe('challenge proof photos', () => {
  it('requires a photo for the pastel de nata eating challenge', () => {
    const pastel = challenges.find((challenge) => challenge.id === 'challenge.pastel-de-nata-quote')

    expect(pastel).toMatchObject({
      photo_required: true,
    })
    expect(pastel?.task).toMatch(/eat a pastel de nata/i)
  })

  it('links a completed challenge to its earlier submitted proof', () => {
    const submitted = makeEvent({
      id: 'submitted',
      type: 'challenge_submitted',
      payload: {
        card_id: 'card-1',
        photo_url: 'https://example.test/proof.jpg',
      },
    })
    const completed = makeEvent({
      id: 'completed',
      type: 'challenge_completed',
      payload: { card_id: 'card-1' },
    })
    const proofIndex = buildChallengeProofIndex([submitted, completed])

    expect(challengeProofUrl(completed, proofIndex)).toBe('https://example.test/proof.jpg')
  })

  it('prefers a proof copied directly onto the completion event', () => {
    const completed = makeEvent({
      id: 'completed',
      type: 'challenge_completed',
      payload: {
        card_id: 'card-1',
        photo_url: 'https://example.test/completed-proof.jpg',
      },
    })

    expect(challengeProofUrl(completed, new Map())).toBe('https://example.test/completed-proof.jpg')
  })
})
