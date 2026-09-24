'use client'

// The in-app player guide. Deeper companion to the printed PLAYER_GUIDE.md
// one-pager, and the only teaching surface a player has on them mid-game.
//
// Two readers at once: someone learning the game before kickoff (so it opens
// with a 60-second summary and teaches in order), and someone settling an
// argument on a street corner (so every section is a jump-nav target and the
// long detail is collapsed).
//
// This page has NO Supabase, NO GPS and NO game-state dependency — the only
// network call is the map's vector tiles. That makes it the one route in the app
// you can preview with nothing but `npm run dev`.
//
// Every number below is interpolated from lib/gameConstants.ts or derived from
// the seed catalogs. Do not type a distance, cost or timer into this file or
// into the message catalog: the whole point is that a balance change cannot
// leave the guide lying to players.

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useT } from '@/lib/i18n/context'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { GuideNav } from '@/components/guide/GuideNav'
import {
  GuideDetails,
  GuideFigure,
  GuideNote,
  GuideSection,
  GuideStat,
  GuideWarning,
} from '@/components/guide/GuideSection'
import { ZoneDiagram } from '@/components/guide/ZoneDiagram'
import { TagDiagram } from '@/components/guide/TagDiagram'
import { CampingDiagram } from '@/components/guide/CampingDiagram'
import { FlagOutcomeDiagram } from '@/components/guide/FlagOutcomeDiagram'
import { EconomyDiagram } from '@/components/guide/EconomyDiagram'
import { IntelNarrowingDiagram } from '@/components/guide/IntelNarrowingDiagram'
import { GameArcDiagram } from '@/components/guide/GameArcDiagram'
import { getSeedLandmarksByPool } from '@/lib/landmarks'
import { DEFENSE_ZONE_RADIUS_M, ENEMY_CANDIDATE_RAID_RADIUS_M } from '@/lib/geo/zones'
import { PLAY_AREA_RADIUS_M } from '@/lib/geo/playArea'
import { TAG_RADIUS_M } from '@/lib/hooks/useTagButton'
import {
  CAMPING_COOLDOWN_S,
  CAMPING_LOCK_S,
  CAMPING_WARNING_S,
} from '@/lib/hooks/useCamping'
import { TIME_BONUS_INTERVAL_MINUTES } from '@/lib/timeBonuses'
import { WEATHER_PROPOSAL_WINDOW_MS } from '@/lib/weatherPause'
import {
  ATTEMPT_RANGE_M,
  CAMPING_RADIUS_M,
  CHALLENGE_PTS,
  COIN_COST_PER_DIE,
  DEFAULT_DURATION_MIN,
  FLAG_PTS,
  HARDEN_COST,
  INTEL_CAP,
  LANDMARK_LOCKOUT_MS,
  NEUTRAL_LEAVE_RADIUS_M,
  PROTECTION_WINDOW_MS,
  STARTING_COINS,
  TAG_PTS,
  TAG_RANGE_M,
  TIME_BONUS,
} from '@/lib/gameConstants'
import challengesSeed from '@/data/challenges.json'
import intelSeed from '@/data/intel.json'

// Only the map needs the client-only Leaflet bundle.
const GuidePoolMap = dynamic(() => import('@/components/guide/GuidePoolMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 w-full items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-sm text-neutral-500">
      …
    </div>
  ),
})

// Coin ranges are derived from the seed so the prose cannot drift when a
// challenge is repriced.
const CHALLENGE_REWARDS = (challengesSeed as Array<{ reward_coins: number }>).map(
  (c) => c.reward_coins,
)
const INTEL_COSTS = (intelSeed as Array<{ cost_coins: number }>).map((c) => c.cost_coins)

const FIRST_BLOOD_COINS = 30 // migration 0015_atomic_game_mutations.sql
const CHALLENGE_REVIEW_AUTO_ACCEPT_S = 120 // resolve-challenge-reviews route

const WEST_HOME = 'landmark.miradouro-vila-velha'

export default function GuidePage() {
  const t = useT()

  const westPool = getSeedLandmarksByPool('west')
  const eastPool = getSeedLandmarksByPool('east')

  const sections = [
    { id: 'sixty', label: t('guide.sixty.nav') },
    { id: 'where', label: t('guide.where.nav') },
    { id: 'roles', label: t('guide.roles.nav') },
    { id: 'tag', label: t('guide.tag.nav') },
    { id: 'camping', label: t('guide.camping.nav') },
    { id: 'flag', label: t('guide.flag.nav') },
    { id: 'economy', label: t('guide.economy.nav') },
    { id: 'intel', label: t('guide.intel.nav') },
    { id: 'mistakes', label: t('guide.mistakes.nav') },
    { id: 'endgame', label: t('guide.endgame.nav') },
  ]

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-6 px-6 pb-20 pt-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/"
            className="text-sm text-neutral-400 transition hover:text-neutral-200"
          >
            ← {t('guide.back')}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-neutral-50">
            {t('guide.title')}
          </h1>
          <p className="mt-1 text-sm italic text-neutral-400">{t('guide.subtitle')}</p>
        </div>
        <LanguageSwitcher />
      </header>

      <GuideNav label={t('guide.jump_to')} items={sections} />

      {/* ---------- 1. the game in 60 seconds ---------- */}
      <GuideSection id="sixty" heading={t('guide.sixty.heading')}>
        <p>{t('guide.sixty.goal')}</p>
        <div className="flex gap-2">
          <GuideStat
            value={t('guide.sixty.stat_duration', { n: DEFAULT_DURATION_MIN / 60 })}
            label={t('guide.sixty.stat_duration_label')}
          />
          <GuideStat
            value={t('guide.sixty.stat_area', { n: PLAY_AREA_RADIUS_M / 1000 })}
            label={t('guide.sixty.stat_area_label')}
          />
          <GuideStat
            value={t('guide.sixty.stat_teams')}
            label={t('guide.sixty.stat_teams_label')}
          />
        </div>
        <p>{t('guide.sixty.walking')}</p>
        <p>{t('guide.sixty.referee')}</p>
      </GuideSection>

      {/* ---------- 2. where you play ---------- */}
      <GuideSection id="where" heading={t('guide.where.heading')}>
        <p>{t('guide.where.body', { radius: PLAY_AREA_RADIUS_M })}</p>
        <GuideFigure
          caption={t('guide.where.map_caption', { n: eastPool.length })}
          note={t('guide.where.map_offline')}
        >
          <GuidePoolMap
            side="west"
            homeRef={WEST_HOME}
            homeLabel={t('guide.where.home_base')}
          />
        </GuideFigure>
        <p>
          {t('guide.where.pools', {
            n: westPool.length,
            pick: 5,
            real: 1,
            decoy: 2,
            empty: 2,
          })}
        </p>
        <p>{t('guide.where.markers')}</p>
        <GuideDetails summary={t('guide.where.pool_list')}>
          <PoolList title={t('guide.where.pool_west')} names={westPool.map((l) => l.name)} />
          <PoolList title={t('guide.where.pool_east')} names={eastPool.map((l) => l.name)} />
        </GuideDetails>
      </GuideSection>

      {/* ---------- 3. defender or raider ---------- */}
      <GuideSection id="roles" heading={t('guide.roles.heading')}>
        <p>{t('guide.roles.body', { radius: DEFENSE_ZONE_RADIUS_M })}</p>
        <GuideFigure>
          <ZoneDiagram
            labels={{
              alt: t('guide.roles.diagram_alt'),
              zone: t('guide.roles.label_zone'),
              scale: t('guide.tag.label_radius', { n: DEFENSE_ZONE_RADIUS_M }),
              one: t('guide.roles.label_one'),
              two: t('guide.roles.label_two'),
              three: t('guide.roles.label_three'),
            }}
          />
        </GuideFigure>
        <ul className="flex flex-col gap-1.5">
          <Bullet>{t('guide.roles.defender')}</Bullet>
          <Bullet>{t('guide.roles.raider')}</Bullet>
        </ul>
        <p>{t('guide.roles.overlap', { n: ENEMY_CANDIDATE_RAID_RADIUS_M })}</p>
      </GuideSection>

      {/* ---------- 4. tagging ---------- */}
      <GuideSection id="tag" heading={t('guide.tag.heading')}>
        <p>{t('guide.tag.body', { radius: TAG_RADIUS_M })}</p>
        <GuideFigure>
          <TagDiagram
            labels={{
              alt: t('guide.tag.diagram_alt'),
              radius: t('guide.tag.label_radius', { n: TAG_RADIUS_M }),
              defender: t('guide.tag.label_defender'),
              raiders: t('guide.tag.label_raiders'),
              cost: t('guide.tag.label_cost'),
              step1: t('guide.tag.label_step1'),
              step2: t('guide.tag.label_step2', { n: NEUTRAL_LEAVE_RADIUS_M }),
            }}
          />
        </GuideFigure>
        <GuideNote>{t('guide.tag.bunching')}</GuideNote>
        <p>
          {t('guide.tag.tolerance', { client: TAG_RADIUS_M, server: TAG_RANGE_M })}
        </p>
      </GuideSection>

      {/* ---------- 5. camping ---------- */}
      <GuideSection id="camping" heading={t('guide.camping.heading')}>
        <p>{t('guide.camping.body', { radius: CAMPING_RADIUS_M })}</p>
        <GuideFigure>
          <CampingDiagram
            labels={{
              alt: t('guide.camping.diagram_alt'),
              radius: t('guide.camping.label_radius', { n: CAMPING_RADIUS_M }),
              landmark: t('guide.camping.label_landmark'),
              warn: t('guide.camping.label_warn', { n: CAMPING_WARNING_S }),
              lock: t('guide.camping.label_lock', { n: CAMPING_LOCK_S }),
              reset: t('guide.camping.label_reset', { n: CAMPING_COOLDOWN_S }),
            }}
          />
        </GuideFigure>
        <p>{t('guide.camping.patrol')}</p>
      </GuideSection>

      {/* ---------- 6. attempting a flag ---------- */}
      <GuideSection id="flag" heading={t('guide.flag.heading')}>
        <p>{t('guide.flag.body', { range: ATTEMPT_RANGE_M })}</p>
        <GuideFigure>
          <FlagOutcomeDiagram
            labels={{
              alt: t('guide.flag.diagram_alt'),
              start: t('guide.flag.label_start'),
              realTitle: t('guide.flag.label_real'),
              realBody: t('guide.flag.label_real_body'),
              decoyTitle: t('guide.flag.label_decoy'),
              decoyBody: t('guide.flag.label_decoy_body'),
              emptyTitle: t('guide.flag.label_empty'),
              emptyBody: t('guide.flag.label_empty_body'),
            }}
          />
        </GuideFigure>
        <p>
          {t('guide.flag.lockout', { n: LANDMARK_LOCKOUT_MS / 60_000 })}
        </p>
        <p>{t('guide.flag.protection', { n: PROTECTION_WINDOW_MS / 60_000 })}</p>
        <p>{t('guide.flag.public_text')}</p>
        <GuideNote>{t('guide.flag.carrier')}</GuideNote>
      </GuideSection>

      {/* ---------- 7. coins, intel and curses ---------- */}
      <GuideSection id="economy" heading={t('guide.economy.heading')}>
        <p>
          {t('guide.economy.body', {
            start: STARTING_COINS,
            bonus: TIME_BONUS,
            interval: TIME_BONUS_INTERVAL_MINUTES,
            min: Math.min(...CHALLENGE_REWARDS),
            max: Math.max(...CHALLENGE_REWARDS),
            first: FIRST_BLOOD_COINS,
          })}
        </p>
        <GuideFigure>
          <EconomyDiagram
            labels={{
              alt: t('guide.economy.diagram_alt'),
              challenges: t('guide.economy.label_challenges'),
              coins: t('guide.economy.label_coins'),
              passive: t('guide.economy.label_passive', {
                n: TIME_BONUS,
                interval: TIME_BONUS_INTERVAL_MINUTES,
              }),
              intel: t('guide.economy.label_intel'),
              curses: t('guide.economy.label_curses'),
              harden: t('guide.economy.label_harden'),
            }}
          />
        </GuideFigure>
        <p>
          {t('guide.economy.spending', {
            intelMin: Math.min(...INTEL_COSTS),
            intelMax: Math.max(...INTEL_COSTS),
            die: COIN_COST_PER_DIE,
            harden: HARDEN_COST,
          })}
        </p>
        <p>{t('guide.economy.review', { n: CHALLENGE_REVIEW_AUTO_ACCEPT_S })}</p>

        <h3 className="mt-2 text-sm font-semibold text-neutral-200">
          {t('guide.curses.heading')}
        </h3>
        <p>{t('guide.curses.body')}</p>
        <p className="text-neutral-400">{t('guide.curses.legend_intro')}</p>
        <div className="overflow-hidden rounded-xl border border-neutral-800">
          <EnforcementRow tag="A" text={t('guide.curses.legend_a')} />
          <EnforcementRow tag="B" text={t('guide.curses.legend_b')} />
          <EnforcementRow tag="C" text={t('guide.curses.legend_c')} />
          <EnforcementRow tag="L" text={t('guide.curses.legend_l')} />
        </div>
        <p>{t('guide.curses.placed')}</p>
        <p className="text-neutral-400">{t('guide.curses.team_size')}</p>
        <p className="text-xs text-neutral-500">{t('guide.in_app_hint')}</p>
      </GuideSection>

      {/* ---------- 8. reading intel ---------- */}
      <GuideSection id="intel" heading={t('guide.intel.heading')}>
        <p>{t('guide.intel.body', { cap: INTEL_CAP })}</p>
        <GuideFigure>
          <IntelNarrowingDiagram
            labels={{
              alt: t('guide.intel.diagram_alt'),
              before: t('guide.intel.label_before'),
              card: t('guide.intel.label_card'),
              after: t('guide.intel.label_after'),
              ruledOut: t('guide.intel.label_ruled_out'),
            }}
          />
        </GuideFigure>
        <p>{t('guide.intel.sequence')}</p>
        <GuideWarning>{t('guide.intel.loss')}</GuideWarning>
      </GuideSection>

      {/* ---------- 9. how to lose by accident ---------- */}
      <GuideSection id="mistakes" heading={t('guide.mistakes.heading')}>
        <GuideWarning>{t('guide.mistakes.decoy')}</GuideWarning>
        <GuideWarning>{t('guide.mistakes.camping', { n: CAMPING_LOCK_S })}</GuideWarning>
        <ul className="flex flex-col gap-1.5">
          <Bullet>{t('guide.mistakes.bounds')}</Bullet>
          <Bullet>{t('guide.mistakes.clock')}</Bullet>
          <Bullet>{t('guide.mistakes.radar')}</Bullet>
        </ul>
      </GuideSection>

      {/* ---------- 10. winning ---------- */}
      <GuideSection id="endgame" heading={t('guide.endgame.heading')}>
        <p>{t('guide.endgame.body', { n: DEFAULT_DURATION_MIN })}</p>
        <GuideFigure>
          <GameArcDiagram
            labels={{
              alt: t('guide.endgame.diagram_alt'),
              lobbyTitle: t('guide.endgame.label_lobby'),
              lobbyBody: t('guide.endgame.label_lobby_body'),
              setupTitle: t('guide.endgame.label_setup'),
              setupBody: t('guide.endgame.label_setup_body'),
              huntTitle: t('guide.endgame.label_hunt'),
              huntBody: t('guide.endgame.label_hunt_body'),
              endTitle: t('guide.endgame.label_end'),
              endBody: t('guide.endgame.label_end_body'),
              protection: t('guide.endgame.label_protection', {
                n: PROTECTION_WINDOW_MS / 60_000,
              }),
            }}
          />
        </GuideFigure>
        <p>
          {t('guide.endgame.points', {
            flag: `+${FLAG_PTS}`,
            challenge: `+${CHALLENGE_PTS}`,
            tag: `+${TAG_PTS}`,
          })}
        </p>
        <p>{t('guide.endgame.tiebreak')}</p>
        <p className="text-neutral-400">
          {t('guide.endgame.weather', { n: WEATHER_PROPOSAL_WINDOW_MS / 60_000 })}
        </p>
      </GuideSection>

      <a
        href="#sixty"
        className="self-center text-xs text-neutral-500 transition hover:text-neutral-300"
      >
        ↑ {t('guide.to_top')}
      </a>
    </main>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="text-neutral-600">
        •
      </span>
      <span>{children}</span>
    </li>
  )
}

function PoolList({ title, names }: { title: string; names: string[] }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
        {title}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {names.map((name) => (
          <li key={name} className="text-xs text-neutral-400">
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EnforcementRow({ tag, text }: { tag: string; text: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-neutral-900 px-3 py-2 text-xs last:border-b-0 odd:bg-neutral-900/30">
      <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-neutral-200">
        {tag}
      </span>
      <span className="text-neutral-400">{text}</span>
    </div>
  )
}
