# Supabase staging project setup

Use this after you create a **new** Supabase project for staging (separate from production `levwrmvqdntngeasrtnb`).

## 1. Create project (dashboard)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name e.g. `scott-dashboard-staging`, pick region, set DB password (store in password manager).
3. Copy from **Project Settings → API**:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` / publishable key → `VITE_SUPABASE_ANON_KEY`

## 2. Link CLI to staging

From repo root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_STAGING_PROJECT_REF
```

To switch back to production later:

```bash
npx supabase link --project-ref levwrmvqdntngeasrtnb
```

## 3. Apply database schema

```bash
npx supabase db push
```

If remote has drift:

```bash
npx supabase db push --include-all
```

Fresh project alternative: run `supabase/schema.sql` in SQL Editor, then mark migrations or use push as above.

## 4. Storage & RLS

Migrations in `supabase/migrations/` create buckets and policies. After push, confirm **Storage** buckets exist in dashboard (approved designs, invoices, chat files, etc.).

## 5. Edge functions

Deploy all admin helpers to **staging** (same code as prod):

```bash
npx supabase functions deploy admin-create-user
npx supabase functions deploy admin-delete-user
npx supabase functions deploy admin-reset-password
```

Set function secrets in dashboard if your project uses them (match production only where intended).

## 6. Auth & test users

- Create test users in **Authentication** (or use in-app admin after first admin exists).
- Promote admin in SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = 'USER_UUID_HERE';
```

Use **fake / test data only** on staging.

## 7. Wire frontend

| Target | What to set |
|--------|-------------|
| Local | `.env.development` from `.env.development.example` |
| Netlify `develop` | Site env vars scoped to branch deploy / `staging` context |
| Never | Do not put staging keys on `main` production scope |

## 8. Ongoing migrations

1. Add migration under `supabase/migrations/`.
2. `supabase link` → staging ref → `supabase db push` → test app on staging.
3. `supabase link` → prod ref → `supabase db push` → merge `develop` → `main`.

## Production reference

| | Production | Staging |
|---|------------|---------|
| Ref | `levwrmvqdntngeasrtnb` | *(your new ref)* |
| URL | `https://levwrmvqdntngeasrtnb.supabase.co` | `https://<staging-ref>.supabase.co` |
