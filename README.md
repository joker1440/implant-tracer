# Implant Tracker

React + Vite + Supabase implant case management app for single-clinic use.

## Stack

- React + Vite
- Supabase Auth / Postgres / Storage
- Vercel deployment

## Local setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Run the Supabase SQL migration in `supabase/migrations/202604160020_init_implant_case_manager.sql`
4. Install packages with `npm install`
5. Start the app with `npm run dev`

## Deploy to Vercel

1. Import the project into Vercel
2. Add the same two environment variables in Vercel project settings
3. Deploy with the default Vite build settings

## Notes

- Storage bucket name: `case-photos`
- Storage paths are namespaced by `auth.uid()`
- The app assumes FDI tooth numbering
