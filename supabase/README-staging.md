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

### ⚠️ CLI link does NOT change your app or live site

| Tool | What it controls |
|------|------------------|
| `supabase link` + `db push` | **Database** for that project ref only |
| `.env` / `.env.development` | **Local app** (`npm run dev`) |
| **Netlify env vars** | **Hosted** production vs staging URLs |

If `.env` still has `levwrmvqdntngeasrtnb`, every `npm run dev` hits **production** even when CLI is linked to staging.

**Fix local dev:**

```bash
cp .env.development.example .env.development
# Edit .env.development — paste STAGING url + anon key only
npm run dev
```

Keep production keys in Netlify **Production** scope only — not in `.env.development`.

**Verify which DB the app uses:** open browser devtools → Network → any Supabase request → host should be `YOUR_STAGING_REF.supabase.co`, not `levwrmvqdntngeasrtnb`.

## 3. Apply database schema

**New empty project (staging):** migrations only *alter* tables like `orders`; they do not create the base schema. `db push` alone will fail with `relation "public.orders" does not exist`.

### 3a. Fresh staging (recommended)

1. Open **staging** project → **SQL Editor** → New query.
2. Paste and run the full file `supabase/schema.sql` from this repo (wait until it finishes).
3. Back in the repo (linked to **staging** ref), mark migrations as already applied:

```bash
cd "/Users/mayurmule/Downloads/Scott Dashboard"
npx supabase migration repair --status applied \
  20260504120000 20260513120000 20260513180000 20260513200000 20260516120000 20260517120000 \
  20260520120000 20260520180000 20260521120000 20260521130000 20260521140000 20260521150000 \
  20260522120000 20260523120000 20260524120000 20260525120000 20260525130000 20260525140000 \
  20260526120000 20260526130000 20260526140000 20260526150000 20260526160000 20260526170000 \
  20260527120000 20260528120000 20260528140000 20260528150000 20260528160000 20260528170000 \
  20260528180000 20260528190000 20260528200000 20260529120000 20260530120000 20260601120000 \
  20260602120000 20260603120000 20260604120000 20260605120000 20260606120000 20260606130000 \
  20260606140000 20260606150000 20260607120000 20260608120000 20260609120000 20260610120000 \
  20260611120000 20260612120000
```

4. Confirm: `npx supabase migration list` — remote should show all **applied**.

### 3b. Production or DB that already has tables

```bash
npx supabase db push
```

If remote has drift:

```bash
npx supabase db push --include-all
```

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
- Promote admin in SQL Editor (**two steps** — direct `set role = 'admin'` is blocked by `enforce_profile_update_scope`):

```sql
-- 1) Allow this email to become admin
insert into public.admin_emails (email)
values ('devadmin@scott.com')
on conflict (email) do nothing;

-- 2) Promote (must be viewer → admin; use email or UUID, not email in id column)
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('devadmin@scott.com');
```

Or log out / log in after step 1 only — new signups get `admin` automatically if their email is in `admin_emails`.

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
| URL | `https://levwrmvqdntngeasrtnb.supabase.co` | `https://scvojtvgnkmbupvyslmb.supabase.co` |
