# Hisaab

Personal finance, Splitwise-style group expenses, and household tiffin meal splitter — one Supabase account for all three modules.

## Stack

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS
- **Backend / Auth / DB / Realtime:** Supabase
- **Charts:** Recharts
- **Deploy:** Vercel (or any static host)

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project.
2. Open **SQL Editor** and run the full script in [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql).
3. In **Authentication → Providers**, keep Email enabled.
4. In **Project Settings → API**, copy the Project URL and `anon` public key.

### 2. Configure the app

```bash
cp .env.example .env
```

Fill in:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 3. Install & run

```bash
nvm use 20   # Node 20+
npm install
npm run dev
```

Open http://localhost:5173 — sign up with email/password.

### 4. Realtime (optional but recommended)

In Supabase **Database → Replication**, ensure the tables listed at the bottom of the migration are added to the `supabase_realtime` publication (the migration already tries to do this).

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel.
3. Add the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables.
4. Deploy (build command: `npm run build`, output: `dist`).

## Modules

| Route | Module |
|-------|--------|
| `/` | Unified dashboard |
| `/expenses` | Personal income/expenses, budgets, charts |
| `/groups` | Group expense splitter + settlements |
| `/tiffin` | Daily lunch/dinner attendance & cost splits |
| `/reports` | Analytics + CSV/PDF export |
| `/notifications` | In-app notifications |
| `/settings` | Profile & theme |

Invite links: `/join/group/:code` and `/join/tiffin/:code`.

## Calculation notes

- **Groups:** net = paid − share; settlements are payments (not new expenses); settle-up uses a greedy minimizer.
- **Tiffin:** meal cost is divided only among members who **consumed** (including guest heads). Non-consumers are never charged. Contributors get credit for what they paid.
