# Canto foundation acceptance — 7 November 2026

Runtime code verified at `57cdd41c90c109395842460869ba08c0a66856d8`. Release commit `b6411c1a79b8da21d4414179537230641fb824de` was pushed to both `develop` and `main` after production authorization.

## Delivered

- npm workspaces: existing dashboard in `apps/admin`, Expo starter in `apps/mobile`, shared constants in `packages/shared`, refresh tooling in `tools/canto-sync`.
- All 22 existing Masters screens retain their forms and support an Old system / Supabase source switch. Supabase Masters and Data Refresh share the dashboard header environment and its existing signed-in client; only the Old system keeps an independent environment selector. The new Supabase administration API is deployed to both staging and production.
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

## Authorized production release

[Production cloud refresh](https://github.com/Mayur8291/Printing-Tracker/actions/runs/42346748707) succeeded from `main` at release commit `b6411c1`. Dashboard job `bf5037bf-1a56-4a90-8c5c-009866ece7cd` reached `succeeded / verified` on 7 November 2026 at 06:27 UTC.

- Verified **86 tables, 1,534,365 rows and 7,992 source users** after applying 90 inserts, 51 updates and zero deletions.
- Enrolled one new Auth account. All **7,353 eligible users** passed source password-hash, role and stable-identity parity. The 637 inactive accounts and two pre-existing ambiguous email identities remain excluded from eligible sign-in.
- The public schema and staff Auth preservation checks passed within the refresh transaction. An actual staff password sign-in succeeded while the refresh was running. The separate whole-release comparison retained all 41 original staff IDs; 40 complete row hashes were unchanged, while one row had an `updated_at` of 06:24:50 UTC. That broader comparison does not establish which fields changed or attribute the change, and is not reported as a byte-identical whole-release result.
- All 24 master/option resources passed authenticated production REST reads. Anonymous refresh access and requests naming the wrong environment were rejected. The final controller status and master read also passed after publication.
- The production rollback backup downloaded and decrypted locally, and all 86 table fingerprints matched its manifest (1,534,275 pre-refresh rows). This recovery test did not write recovered data back to production.
- The security-advisor comparison added no error-level findings. Six informational findings identify private tables with RLS enabled and no policies (intentional default denial). Three warnings identify authenticated execution of `SECURITY DEFINER` admin RPCs. Each RPC has a fixed `pg_catalog` search path, calls the live-session admin guard, and denies `anon` and `sa_app` execution; these expected warnings were reviewed rather than suppressed.
- The temporary production administrator, its allowlist entry, profile, sessions and local credential file were removed. All 41 original staff accounts remain; the public schema still matches the pre-release fingerprint. Production has no active job and edit/synced revisions are both zero. Staging remains clean with both revisions at 167.
- The owner’s manual **legacy production user/password sign-in** test remains outstanding. Source hash parity and the production staff test do not substitute for that user acceptance test.

## Release status and limits

- No DigitalOcean code or configuration changes were needed for this work. The existing restricted export key is reused.
- Production passed all 24 master/option compatibility checks. The reviewed migrations `20261107045242`, `20261107050603`, and `20261107060300` and the `canto-refresh` Edge Function are deployed. Production dispatches its worker from `main`; staging uses `develop`.
- The user confirmed Vercel is the live host and requested Git-based deployment. Both release builds succeeded: the `develop` push produced deployment `7617546377`, labeled `Production`; the `main` push produced deployment `7617587700`, labeled `Preview`. Both contain the same release commit. GitHub marks both `production_environment=false`, so these labels are not proof of the canonical live alias. Both generated deployment URLs redirect to Vercel sign-in; the available browser account cannot access this Vercel project. Repository Netlify instructions are not authoritative for the live host.
- Initial browser acceptance used the local admin against the deployed staging API. After the dashboard-session correction, the canonical live URL `https://scottdashboard.vercel.app` passed actual browser acceptance using a temporary staging administrator: one dashboard login, real Masters rows, refresh history, reload, zero wrong-project requests and zero browser exceptions. Generated preview URLs remain protected by Vercel sign-in.
- The pre-existing Scott configuration CI check reports missing production `SCOTT_AUTH_EMAIL` / `SCOTT_AUTH_PASSWORD`. It is not reported as passing.
- Expo is a starter, not the completed mobile app. Native bundles were exported; a physical device/simulator run has not been performed.
- Imported media migration is implemented below. Newly uploaded Masters images continue using their existing Supabase bucket.

The authorized production release used `tools/canto-sync/.venv/bin/python tools/canto-sync/deploy_admin.py production`. That command installed only the reviewed Canto migrations, exposed the guarded RPC schema, deployed the controller and selected the `main` worker. Do not substitute an unrelated blanket migration push. The database refresh remains one-way and requires explicit confirmation before replacing Supabase edits; cutover disables old-system refresh.

Secrets, test credentials, row exports and backups are excluded from this report and Git. The temporary test administrator and saved test browser session have been removed.

## Dashboard session correction

Masters previously remembered its own environment and could show Production while the dashboard was signed into Staging. Data Refresh had a separate saved selection too. Both Supabase pages now use the dashboard environment and client, ignore stale page-level environment selections, and have no second account-connection dialog. Use the existing header control to change the dashboard environment. The normal dashboard login and server-side admin guards still apply; sessions are not copied across Supabase projects.

Regression: `apps/admin/tests/canto-dashboard-session.mjs` uses a real staging dashboard login with conflicting saved Production targets, verifies authenticated master reads and refresh history, checks reload behavior, and asserts no production requests or browser exceptions. It separately verifies production client resolution without moving staging credentials or writing production data. The UI build gate also passed.

Hosted verification of runtime commit `b39150c`: `CANTO_TEST_URL=https://scottdashboard.vercel.app node apps/admin/tests/canto-hosted-session.mjs` passed after Vercel deployed the `develop` push. This verifies the correction on the canonical live site supplied in the user screenshot. No database migrations, production database writes, master changes or refresh jobs were needed for this correction.

## Media refresh implementation

The refresh now inventories source file references, copies available files into private, immutable Supabase Storage objects, verifies every file with a SHA-256 read-back, and publishes media mappings in the same transaction as the snapshot and Auth updates. Each environment reads only its matching source. Missing files stay explicitly reported; external service links are preserved rather than downloaded as HTML.

Staging backfill `20261107070904_819a56` published successfully: 10,379 source URLs checked, 1,403 available files verified (900,916,209 source bytes), 8,976 missing source files and 21 external references. Two connection resets in the first attempt blocked publication; the retry completed with zero transfer errors and reused verified objects. This is a successful refresh with reported exceptions, not a claim that missing files were recovered.

Real staging checks passed: migrated images decode with all DigitalOcean requests blocked; public/anonymous access is denied; normal administrator edits preserve permanent image references; forced publication rollback preserves the previous mapping; recovery validates an authentic retained object checksum. The exception list renders in the dashboard. UI build, nine source-schema tests, six media tests and encrypted-backup tamper tests passed.

Production deployment and cloud refresh acceptance are in progress; no production media completion is claimed by this entry.
