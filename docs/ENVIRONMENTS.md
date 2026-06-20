# Scott Dashboard — staging vs production

Two isolated stacks so you can build and test without touching live data.

| Layer | Production | Staging |
|-------|------------|---------|
| **Git branch** | `main` | `develop` |
| **Netlify** | Production deploy (`main`) | Branch deploy (`develop`) — see below |
| **Supabase** | Existing project (`levwrmvqdntngeasrtnb`) | **New** project you create in dashboard |
| **Local dev** | Do not use for daily work | `.env.development` with staging keys |

---

## Daily workflow

1. **Feature work:** branch from `develop`, open PR into `develop`.
2. **Local run:** `npm run dev` (uses `.env.development` → staging Supabase).  
   **`npm run dev:staging`** needs a real **`.env.staging`** file (not `.env.development`). Without it, Vite falls back to **`.env` = production**.
3. **Shared preview:** push to `develop` → Netlify staging URL (after branch deploys + env vars).
4. **Release:** Admin → **Test & deploy** → **Release staging → production** (automated), or merge `develop` → `main` manually. See [RELEASE_AUTOMATION.md](./RELEASE_AUTOMATION.md).

```bash
git checkout develop
git pull origin develop
cp .env.development.example .env.development   # once; fill staging keys
npm install
npm run dev
```

Schema changes: apply migrations to **staging** first (`supabase link` to staging ref, then push). **First-time staging:** run `schema.sql` in SQL Editor, then `migration repair` — see [supabase/README-staging.md](../supabase/README-staging.md) (do not run bare `db push` on an empty project).

---

## Git branches

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready; deploys to live Netlify production context |
| `develop` | Integration / QA; deploys to staging Netlify context |

```bash
git fetch origin
git checkout develop
git pull -u origin develop
```

---

## Supabase

**Production (existing):**

- Project ref: `levwrmvqdntngeasrtnb`
- API URL: `https://levwrmvqdntngeasrtnb.supabase.co`
- Keys: [Dashboard → Project Settings → API](https://supabase.com/dashboard/project/levwrmvqdntngeasrtnb/settings/api) (anon / publishable only in frontend)

**Staging (you create once):**

1. [Supabase Dashboard](https://supabase.com/dashboard) → **New project** (e.g. `scott-dashboard-staging`).
2. Note **project ref**, **URL**, and **anon key**.
3. Follow [supabase/README-staging.md](../supabase/README-staging.md) for `db push`, storage, edge functions, and test users.

Never point local `.env.development` at production.

---

## Netlify

Repo: [Mayur8291/Printing-Tracker](https://github.com/Mayur8291/Printing-Tracker)

`netlify.toml` sets **production** context to branch `main` and a **staging** context to branch `develop`. You still enable branch deploys and set env vars in the UI (CLI was not logged in during automated setup).

### One-time Netlify setup

1. **Log in / link site** (if not already):
   ```bash
   npx netlify-cli login
   cd "/path/to/Scott Dashboard"
   npx netlify-cli init   # or link existing site
   ```
2. **Site settings → Build & deploy → Continuous deployment**
   - Production branch: `main`
   - **Branch deploys:** All branches (or at least `develop`)
3. **Site settings → Environment variables**

   | Variable | Production (`main`) | Staging (`develop` / context `staging`) |
   |----------|-------------------|----------------------------------------|
   | `VITE_APP_ENV` | `production` (hides Admin → Test & deploy on live site) | `staging` |
   | `VITE_SUPABASE_URL` | `https://levwrmvqdntngeasrtnb.supabase.co` | `https://YOUR_STAGING_REF.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | prod anon key | staging anon key |

   `netlify.toml` sets `VITE_APP_ENV` per context; you can mirror it in the dashboard if UI vars override the file.

   Use **Scopes**: Production vs **Branch deploys** / deploy context **staging** so prod keys never apply to `develop` builds.

4. **Optional second site:** Instead of branch deploys, create a second Netlify site from the same repo with production branch `develop` and staging env vars only on that site.

### URLs

- **Production:** your existing Netlify URL (set after `netlify link` or in team dashboard).
- **Staging:** `https://develop--<site-name>.netlify.app` (pattern for branch deploys) or custom subdomain if configured.

Do not change production env vars remotely without confirming values in the dashboard.

---

## Local env files

| File | Used by | Keys |
|------|---------|------|
| `.env.development` | `npm run dev` | Staging |
| `.env.staging` | `npm run dev:staging` | Staging (explicit mode) |
| `.env.production.local` | `npm run build` locally only | Avoid; CI uses Netlify |

Examples (committed, no secrets): `.env.example`, `.env.development.example`, `.env.staging.example`.

---

## Checklist: first staging bring-up

- [ ] Create Supabase staging project + `README-staging.md` steps
- [ ] Copy staging URL/anon into `.env.development`
- [ ] Netlify: enable branch deploy for `develop`, set staging env vars
- [ ] Push to `develop`, open staging URL, smoke-test auth + one order flow
- [ ] Only then merge to `main` for production release

---

## MCP / automation notes

- Supabase MCP (`user-supabase_scott1`) is linked to the **production** project above.
- Creating a second Supabase project requires the dashboard (billing/org); duplicate schema via `supabase db push` on the new ref.

---

## Troubleshooting: user in Auth but not in Admin user list

**Symptom:** Admin → **List users** shows “No viewer accounts yet” (or no row for that email), but **Create user** fails with “A user with this email address has already been registered”.

**Why:**

1. **Orphaned Auth row** — `auth.users` exists without a matching `public.profiles` row (e.g. create succeeded in Auth then profile upsert failed, or user was created before the `handle_new_user` trigger existed).
2. **Wrong environment** — user was created on **staging** Supabase while admin is on **production** (or vice versa). Auth is per-project; lists only show profiles in the project you are connected to. See `npm run dev:staging` note: without `.env.staging`, local dev can fall back to production `.env`.
3. **Admin account** — profile exists with `role = 'admin'`. The user list only loads `role = 'viewer'` rows, so admins never appear there.

**Fix (app):** After deploying the latest `admin-create-user` edge function, submit **Create user** again with the same email and a new password. The function detects the existing Auth user, upserts the missing profile (or refreshes an existing viewer profile), and sets the password.

**Fix (manual SQL on the correct Supabase project):** In Dashboard → SQL Editor, find the auth user id, then insert the profile if missing:

```sql
-- Replace with the stuck email
select id, email from auth.users where lower(email) = lower('user@example.com');

insert into public.profiles (id, email, full_name, role, is_active)
values (
  '<uuid-from-auth-users>',
  lower('user@example.com'),
  'Display Name',
  'viewer',
  true
)
on conflict (id) do update set
  email = excluded.email,
  is_active = true;
```

Then refresh **List users** in Admin. Redeploy edge function after code changes:

```bash
npx supabase link --project-ref levwrmvqdntngeasrtnb   # production
npx supabase functions deploy admin-create-user
```
