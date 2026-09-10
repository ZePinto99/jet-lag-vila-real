# Jet Lag: Vila Real

Self-serve referee app for a walking-only capture-the-flag game in Vila Real, Portugal.
Paired with `RULEBOOK.md` (game rules) and `PLAYER_GUIDE.md` (player-facing guide).

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind + Supabase + Leaflet, served as a PWA.

## Prerequisites

- Node.js 20.9 or newer
- A Supabase project (free tier is fine)
- Supabase CLI for local database setup and hosted migrations

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project at https://supabase.com and grab the project URL,
   anon key, and service role key from Project Settings -> API.

3. Copy the env template and fill in the values:

   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

4. Start local Supabase and apply every checked-in migration:

   ```bash
   supabase start
   supabase db reset --local
   ```

   For a hosted project, link the repository to the intended project and push
   the complete migration history. Never apply only the first migrations:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push --linked
   ```

5. Start the dev server:

   ```bash
   npm run dev
   ```

6. Open http://localhost:3000 — choose **Create game** or **Join game**.

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — Next/ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — unit and route tests
- `npm run test:e2e` — browser + API simulation against local Supabase and a dev server on port 3001

## Production configuration

Configure all variables from `.env.example` in Vercel. The three Supabase
variables are required. Web Push variables are optional, but when enabled the
public key must match in both `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
`VAPID_PUBLIC_KEY`; keep `SUPABASE_SERVICE_ROLE_KEY` and `VAPID_PRIVATE_KEY`
server-only.

Before promoting a deployment, run:

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
npm audit --omit=dev --audit-level=moderate
```

## Companion documents

- `RULEBOOK.md` — full game rules. The app enforces the responsibilities listed in §12.
- `PLAYER_GUIDE.md` — short player-facing primer.
- `data/` — seed catalogs (landmarks, challenges, curses, intel) maintained by other agents.
