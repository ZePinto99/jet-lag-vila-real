# Jet Lag: Vila Real

Self-serve referee app for a walking-only capture-the-flag game in Vila Real, Portugal.
Paired with `RULEBOOK.md` (game rules) and `PLAYER_GUIDE.md` (player-facing guide).

## Stack

Next.js 15 (App Router) + TypeScript + Tailwind + Supabase + Leaflet, served as a PWA.

## Prerequisites

- Node.js 20 or newer
- A Supabase project (free tier is fine)

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

4. Apply the database migrations in order. Either via the Supabase dashboard
   SQL Editor, or with psql:

   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_adjustments.sql
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

## Companion documents

- `RULEBOOK.md` — full game rules. The app enforces the responsibilities listed in §12.
- `PLAYER_GUIDE.md` — short player-facing primer.
- `data/` — seed catalogs (landmarks, challenges, curses, intel) maintained by other agents.
