# Canto foundation acceptance — 7 November 2026

Runtime code verified at `57cdd41c90c109395842460869ba08c0a66856d8`, pushed to `develop`.

## Delivered

- npm workspaces: existing dashboard in `apps/admin`, Expo starter in `apps/mobile`, shared constants in `packages/shared`, refresh tooling in `tools/canto-sync`.
- All 22 existing Masters screens retain their forms and support an independent Old system / Supabase target and staging / production selection. The new Supabase administration API is deployed to staging; production deployment is pending.
- Data Refresh authorizes an administrator, starts a background GitHub job, shows progress and persistent history, verifies an encrypted recovery backup, and atomically publishes matching DigitalOcean data and Canto Auth state.

## Verification evidence

| Check | Result |
| --- | --- |
| Clean Node 26 install, admin UI gate, mobile typecheck | Passed |
| Expo web, Android and iOS exports | Passed; web starter also rendered in Chrome |
| 22 actual browser service CRUD flows and 22 form dialogs | Passed |
| Selected-project images, removal, relations and atomic relation failure | Passed |
| Six concurrent creates, six bulk updates and stale-edit rejection | Passed |
| Visible create form and six-row CSV preview/import | Passed |
| Admin authorization, environment boundaries, edit confirmation, cutover, duplicate job and failure reconciliation | Passed |
| Source parser/schema safety and encrypted-backup tamper tests | Passed |
| Cloud backup download, decryption and all 86 table fingerprints | Passed |
| Forced failure after applying insert/update/delete and a password change | Passed; data, sequences, Auth password/session state and constraints restored |
| Staff sign-in during an exclusive snapshot table lock | Passed; new-account/email/role collision checks still reject invalid changes |
| Real old-system and Supabase password sign-in regression | Passed in staging, including wrong-password rejection and stable identity |
| Final Data Refresh UI, clean edit revision, reload and browser errors | Passed; zero browser errors |
| Temporary administrator cleanup | Passed; original four staff accounts remain, no temporary allowlist entries or active job |

The forced-failure regression was repeated after the transaction-isolation change. Its private result is `tools/canto-sync/private/delta_fixture_d12bab2319/result.json`.

## Verified cloud runs

1. [Initial dashboard refresh](https://github.com/Mayur8291/Printing-Tracker/actions/runs/42342755283): succeeded, including cloud backup recovery verification.
2. An intervening run failed before publication. Its commit-journal entry is absent and its previous dataset remained intact. The failed job remains visible in history.
3. [Refresh after concurrency fixes](https://github.com/Mayur8291/Printing-Tracker/actions/runs/42344925859): succeeded; removed remaining test master records.
4. [Final unchanged-data refresh](https://github.com/Mayur8291/Printing-Tracker/actions/runs/42345655664): succeeded with **zero inserts, zero updates and zero deletions**. A real staff password sign-in also succeeded during publication.

The final run verified **86 tables, 1,382,126 rows and 7,469 source users**. All 6,860 eligible Canto accounts matched their source password hashes, roles and identities. The public schema and staff Auth preservation checks passed. The two existing ambiguous email identities remain held for manual resolution; 607 source accounts are inactive. This is not a claim that every source account is eligible to sign in.

Publication compares preservation checks within a consistent transaction snapshot, so independent staff sign-in timestamps are not mistaken for migration writes. See [PostgreSQL repeatable-read semantics](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-REPEATABLE-READ).

## Release status and limits

- No DigitalOcean code or configuration changes were needed for this work. The existing restricted export key is reused.
- Production received read-only compatibility checks: all 24 master/option contracts and the expected existing Auth guard matched. The three new administration/guard migrations and refresh Edge Function have **not** been deployed there; `main` was not pushed.
- The user confirmed Vercel is the live host. The latest Vercel build passed. GitHub calls its deployment environment `Production` but marks `production_environment=false`; that metadata alone does not establish the live branch mapping. Vercel dashboard access is still needed: the currently signed-in Not Funny account receives 404 for `mayur8291s-projects/scott_dashboard`. Repository Netlify instructions are not authoritative for the live host.
- Browser acceptance used the local admin against the deployed staging API. Hosted preview acceptance remains pending the correct Vercel project access.
- The pre-existing Scott configuration CI check reports missing production `SCOTT_AUTH_EMAIL` / `SCOTT_AUTH_PASSWORD`. It is not reported as passing.
- Expo is a starter, not the completed mobile app. Native bundles were exported; a physical device/simulator run has not been performed.
- Existing imported media still uses its legacy URLs. Newly uploaded images use Supabase Storage; transferring old files is a separate task.

After release authorization, verify the Vercel project/production branch, promote the reviewed `develop` code, and run `tools/canto-sync/.venv/bin/python tools/canto-sync/deploy_admin.py production`. That command installs only the reviewed Canto migrations, exposes the guarded RPC schema, deploys the controller and selects the `main` worker. Do not substitute an unrelated blanket migration push. The database refresh remains one-way and requires explicit confirmation before replacing Supabase edits; cutover disables old-system refresh.

Secrets, test credentials, row exports and backups are excluded from this report and Git. The temporary test administrator and saved test browser session have been removed.
