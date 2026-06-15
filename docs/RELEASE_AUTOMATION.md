# One-click release (staging → production)

Admin panel → **Test & deploy** → **Release to production** triggers a GitHub Action that:

1. Merges `develop` into `main` and pushes (automated merge commit)
2. Runs `supabase db push` on the **production** project
3. Deploys edge functions to production
4. **Builds** the Vite app with production Supabase keys
5. **Deploys** `dist/` to Netlify production (CLI or build hook)

**Important:** Promote only ships what is already **committed and pushed to `develop` on GitHub**. Local uncommitted files are not included — run `git push origin develop` before Release.

---

## One-time setup

### 1. GitHub — add workflow file to `main`

Commit `.github/workflows/promote-to-production.yml` (merge via PR or push to `main` once).

In the repo: **Settings → Actions → General → Workflow permissions** → enable **Read and write** for GitHub Actions.

### 2. GitHub — repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|--------|
| `SUPABASE_ACCESS_TOKEN` | [Supabase account token](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROD_PROJECT_REF` | `levwrmvqdntngeasrtnb` |
| `SUPABASE_DB_PASSWORD` | Production database password (Supabase → Project Settings → Database) |
| `VITE_SUPABASE_URL` | `https://levwrmvqdntngeasrtnb.supabase.co` (production — used when building in promote workflow) |
| `VITE_SUPABASE_ANON_KEY` | Production anon/publishable key |
| `NETLIFY_AUTH_TOKEN` | [Netlify personal access token](https://app.netlify.com/user/applications) — **recommended for deploy** |
| `NETLIFY_SITE_ID` | Netlify → Site settings → General → Site ID — **use with token above** |
| `NETLIFY_PRODUCTION_BUILD_HOOK` | *(fallback)* Netlify → Build & deploy → Build hooks → production hook URL |

### 3. GitHub — personal access token for the edge function

Create a fine-grained or classic PAT with:

- Repository: `Printing-Tracker`
- Permissions: **Actions: Read and write**, **Contents: Read and write** (if classic: `repo` + `workflow`)

### 4. Supabase — deploy edge function + secret

The app calls the function on **whichever Supabase project your build uses** (staging when `npm run dev`, production on the live site).

**Production** (required for live admin + real releases):

```bash
cd "/Users/mayurmule/Downloads/Scott Dashboard"
npx supabase link --project-ref levwrmvqdntngeasrtnb
npx supabase secrets set GITHUB_PROMOTE_TOKEN=ghp_YOUR_TOKEN_HERE
npx supabase functions deploy admin-promote-production
```

**Staging** (required if you test the button locally with `.env.development`):

```bash
npx supabase link --project-ref scvojtvgnkmbupvyslmb
npx supabase secrets set GITHUB_PROMOTE_TOKEN=ghp_YOUR_TOKEN_HERE
npx supabase functions deploy admin-promote-production
```

Optional: `npx supabase secrets set GITHUB_REPO=Mayur8291/Printing-Tracker`

Deploy the workflow file to GitHub **before** the button works.

**Error “Failed to send a request to the Edge Function”** = function missing on that Supabase project — run deploy steps above for the project ref shown in Admin (e.g. `scvojtvgnkmbupvyslmb` = staging).

---

## Daily use

1. Develop on `develop` + staging Supabase (local `.env.development`).
2. **Commit and push** to `origin develop` and test (staging Netlify rebuilds from this push).
3. Admin → **Test & deploy** → **Release to production** → confirm.

The release button does **not** upload files from your laptop. It only merges whatever is already on GitHub `develop`. If the live site is missing a feature you see in `npm run dev`, you almost certainly forgot to push `develop` (or you are looking at production before releasing).
4. Watch progress: link opens GitHub Actions run.
5. Verify live site after workflow is green.

---

## If the button errors

| Message | Fix |
|---------|-----|
| `GITHUB_PROMOTE_TOKEN` not configured | Step 4 above |
| `403 Forbidden` | User must be admin |
| GitHub `404` on workflow | Workflow file not on `main` yet |
| Merge conflict in Actions | Resolve `develop` vs `main` locally, push, retry |
| `Remote migration versions not found` on db push | Prod has history entries not in repo. Commit placeholder files under `supabase/migrations/20260604112625_remote_sync.sql` (etc.) or let `scripts/supabase-prod-db-push.sh` auto-repair orphans, then re-run promote |
| `Failed to resolve latest Supabase CLI release` | Workflow pins CLI version in `.github/workflows/promote-to-production.yml` — bump `version:` if needed; do not use `latest` in CI |
| `pipefail: invalid option name` on db push | `scripts/supabase-prod-db-push.sh` must use Unix (LF) line endings — CRLF breaks bash on GitHub runners |
| Promote green but live site unchanged | Add `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID`, or `NETLIFY_PRODUCTION_BUILD_HOOK`. Also `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` for the build step. Push changes to `develop` before Release — local-only edits are not promoted |
