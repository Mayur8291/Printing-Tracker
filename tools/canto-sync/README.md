# Canto one-way database and authentication refresh

## Environment boundaries

| Environment | DigitalOcean source | Active database | Supabase destination |
| --- | --- | --- | --- |
| production | 165.22.210.53 / droplet 356904539 | scott_international_backend_production | levwrmvqdntngeasrtnb |
| staging | 64.227.186.227 / droplet 390843400 | scott_international_backend_staging_v2 | scvojtvgnkmbupvyslmb |

These are independent source-to-matching-destination paths. There is no production-to-staging transfer and no write-back to DigitalOcean. The similarly named non-v2 staging database is obsolete and is never selected.

All current application records belong in `sa_snapshot_20261019`, with `sa_` object prefixes. Printing Tracker's `public` tables, policies, functions and staff accounts remain outside the refresh write scope. Private operational records and historical identity keys are stored in `sa_sync`. Canto-only `auth.users`/email identities and private `sa_identity` reservations are also maintained by the authentication sync; existing Printing Tracker Auth accounts are excluded.

## Operating commands

From this directory:

```sh
./refresh-staging
./refresh-production
.venv/bin/python status.py
.venv/bin/python status.py --remote
```

Each refresh obtains a fresh source capture. It exits nonzero on failure or an unconfirmed outcome. `status.py` shows the last recorded success and its source capture time, not a claim of continuous replication.

To recheck and replay a previously captured snapshot explicitly:

```sh
./refresh-staging --reuse-capture private/staging_<capture-id>
```

The source environment, host, database, destination and archive SHA-256 are checked again. Reusing a capture does not claim fresh source data. Reports live in `private/<environment>_<run-id>/report_<run-id>.json`. Each committed run also writes its report to `sa_sync.refresh_runs` in the same transaction as publication. After a connection failure, inspect that commit journal before assuming the transaction rolled back.

## Implementation plan and execution stages

1. **Bounded source access.** Pin SSH host keys read from the authenticated DigitalOcean console. A dedicated SSH key forces a fixed `pg_dump` command against the corresponding database. It permits no shell, PTY, forwarding, caller-selected database or SQL. PostgreSQL exports a consistent read-only snapshot. The archive streams directly to this Mac, avoiding source disk consumption.
2. **Capture evidence.** Record source identity, destination project, capture start/end, archive digest and environment. Incomplete exports have a `.partial` suffix and cannot be imported. “Up to date” always means the consistent source snapshot, not writes committed afterward.
3. **Validate the schema offline.** Parse SQL as an AST using the audited mapper. Check separate complete schema fingerprints for production and staging. Preserve literal values and COPY data. Reject executable COPY commands, functions, extensions, unreviewed SQL or cross-schema references. Preserve staging's two additional order fields. Unexpected schema changes stop before destination writes.
4. **Compare every record locally.** Read all 86 destination tables in one repeatable-read transaction. Match rows by their actual primary keys and compare the complete COPY representation, including nulls, passwords, roles, flags and timestamps. Produce inserts, updates and hard deletions. Record per-table order-independent SHA-256 content fingerprints. A table over 512 MiB fails the bounded-memory preflight rather than risking an incomplete comparison.
5. **Save rollback data locally.** While reading the current destination, save every prior table as private gzip COPY files, plus content fingerprints, primary keys and sequence state. Backups contain private data and stay outside Git. No full duplicate of the database is kept on Supabase during routine refreshes.
6. **Check capacity and concurrency.** Use one advisory lock per destination. Changed runs require reported free space for temporary rows and WAL: at least 256 MiB, or twelve times delta bytes plus 128 MiB, whichever is greater. The check is conservative because platform metrics can lag. Stop on insufficient capacity. Verify the destination schema, indexes, constraints and permissions against the reviewed baseline.
7. **Publish one atomic delta.** Lock the snapshot tables and verify they still match the comparison baseline, preventing silent overwrites of intervening target edits. Stage only changed rows in session-local temporary tables. Defer the snapshot's foreign keys while applying inserts, updates and deletions, then force validation and restore their original definitions. Preserve reserved identities separately from source deletions. Use transactional sequence restarts to preserve the next sequence values. Never disable triggers or use replica mode.
8. **Verify before commit.** Compare every resulting table to the captured source, validate sequence positions, constraints and isolation, and confirm public schema and existing staff Auth records have not changed. Save a durable commit record. Any validation failure rolls back the entire publication. Identical repeated input yields zero row changes.
9. **Re-run on demand.** Repeat the same environment-specific command after ten days or whenever needed. There is no public sync endpoint, automatic schedule or Edge Function execution-time dependency. The Mac must be available and able to access its Keychain and both services.

## Rollback

Each successful delta run includes `rollback_directory`. Restore it with:

```sh
.venv/bin/python rollback.py staging /absolute/path/to/run/before
```

The rollback command checks the environment and every compressed file's content fingerprint, then uses the same comparison, capacity, transaction and verification path. It saves the dataset it replaces locally, so the rollback itself is reversible. Keep the complete `before/` directory and its manifest together. Initial staging bootstrap has no previous dataset; later delta runs do.

## Authentication sync

Old-system credentials remain authoritative until cutover: a subsequent refresh intentionally replaces new-system password/email/role changes with the captured Rails values.

Every refresh now enrolls eligible Canto accounts in Supabase Auth in the **same transaction** as the snapshot publication. Password hashes, email changes, legacy user IDs, role IDs and eligibility are synchronized. The legacy integer ID maps to a stable reserved Auth UUID. Old Rails sessions and its master-password bypass are never migrated.

Accounts use the isolated `sa_app` execution role. Their trusted `app_metadata` contains `application: canto`, `legacy_user_id` and `legacy_role_id` (the unchanged Rails enum 0–12). User-editable metadata is not an authorization source. Canto imports skip the Printing Tracker profile trigger; existing public functions, public schema/data and staff Auth users remain intact. The trigger routing change is on `auth.users`, with all new helpers and reservations in private schemas.

Eligibility matches the normal Rails password path: reject deleted users, disabled users and customers whose approval is explicitly false. Null approval remains allowed, as Rails does. Because Rails does not require confirmation at login, migrated eligible users are confirmed for Supabase password login; the reservation retains their actual source confirmation provenance. No welcome/reset emails are sent by migration. Reactivation works without discarding immutable historical reservations. Hard deletions retain reservations and ban any enrolled account.

Refresh also revokes sessions when passwords, email, role or eligibility change. Already issued JWTs remain cryptographically valid until expiry; future app data policies must check current account eligibility/session state for immediate revocation. Canto currently has no snapshot or Printing Tracker table privileges: this milestone verifies authentication, **not the rebuilt Expo app's business-data authorization**.

Email domains without a dot retain password-login compatibility. Case-colliding legacy accounts are held for review rather than silently merged. IDs **6795 and 6797**, in both environments, differ only by email capitalization; Supabase email login is case-insensitive. They need distinct verified login identifiers or a separately reviewed compatibility login flow. The report distinguishes eligible enrolled users from blocked/exception records. A blanket claim that every legacy account is already supported would be incorrect.

The import uses the inspected standard `auth.users` and email `auth.identities` shape with empty token defaults, confirmed timestamps and preserved bcrypt hashes. Actual Supabase password-token login is tested, rather than inferring success from hash equality. The installation SQL is `supabase/migrations/20261107035249_canto_auth_sync.sql`; install once per environment with `.venv/bin/python auth_sync.py <environment> --install`. Routine use is still just `./refresh-staging` or `./refresh-production`. Reapplying the installer does not overwrite existing reservations.

`auth_test.py` checks the Mailinator account against both Rails and Supabase, wrong-password rejection and Printing Tracker access isolation. `auth_edge_tests.py` tests disabled/unapproved/deleted states, reactivation, null approval, role updates and a domain without a dot, restoring the staging snapshot test user afterward. `auth_session_test.py` also verifies that disabling the test account invalidates its refresh token. These state simulations change only the staging Supabase test record; the real registration and password change run through existing Rails APIs. The extended delta integration test injects a password change and failure before commit and checks Auth rollback as well as all snapshot contents.

For manual verification, open `login-check.html`, select Production, and enter your existing production email/password. Or serve only the public checker directory with `.venv/bin/python -m http.server 8766 --bind 127.0.0.1 --directory login-check` and visit http://127.0.0.1:8766/. It sends credentials directly to the selected Supabase project, does not persist tokens/passwords, displays the legacy ID/role and closes its test session. This is a test page, not an Expo application. Never serve the `private/` directory.

## Credentials and setup

The Supabase PAT is retrieved from macOS Keychain service `codex-printing-tracker-supabase`, account `kundan9595gmail.com`. The SSH key and pinned host keys are under `~/.config/canto-sync/`; the private key must have mode 0600. Supabase uses a temporary CLI login through the Management API, TLS hostname verification, and a SHA-256-pinned CA certificate. No owner database password is reset or retained.

Dependencies are pinned in `requirements.txt`; Python 3.9+ and PostgreSQL `pg_restore` 17.11 are required. The current executable path is `/opt/homebrew/opt/postgresql@17/bin/pg_restore`. Original migration packages remain unchanged.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest -v test_sync.py
```

Do not copy secrets or private dumps into Git. Local backup retention is manual: keep the last successful run and required rollback generations. The private directory can grow, so review local disk usage over time.

## Verification and capacity incident

The initial staging bootstrap was fully verified and committed. A later full-copy rollback experiment exhausted staging's then-2-GB disk while writing WAL. The incomplete test transaction did not commit. The generated test import was removed, all four platform health checks recovered, and the published staging snapshot was reverified. Supabase subsequently reported an 8-GB staging disk. This workflow did not issue a disk-resize or billing request.

That experience led to the current local-comparison/delta design. The normal commands no longer perform full-copy publication or retain full remote backup schemas. `delta_integration_check.py` tests a temporary insertion, update and deletion, validates the result inside a transaction, forces rollback, rechecks all original contents/sequences/schema, and checks concurrent-run exclusion. See `tests/README.md` and the run reports for evidence.

## Dashboard refresh worker

The admin Data Refresh page calls `canto-refresh` in the selected Supabase project. The controller verifies the administrator's live session, records a job, and dispatches the existing GitHub configuration workflow with a job UUID. That entrypoint calls `canto-refresh.yml` on `develop`; ordinary configuration checks keep their existing behavior. The runner claims the UUID once, obtains the advisory lock, captures the matching DigitalOcean database, compares all 86 tables, and uploads an AES-GCM encrypted recovery archive to the private `canto-sync-backups` bucket. Every encrypted chunk is read back before publication. Database and authentication changes commit together. The commit journal resolves interrupted status updates.

Required repository secrets: `CANTO_SUPABASE_ACCESS_TOKEN`, `CANTO_EXPORT_SSH_KEY`, `CANTO_BACKUP_KEY` (base64 32-byte key). Required function secrets: `CANTO_GITHUB_TOKEN`, `CANTO_WORKFLOW_REF`. Keep a separate recovery copy of the backup key; it is not stored alongside the encrypted database. The Mac recovery copy is protected at `~/.config/canto-sync/backup.key`. Never publish raw exports, error diagnostics, keys, passwords, or database dumps as GitHub artifacts.

`sa_admin` contains the allowlisted Masters API metadata, media links, and change audit. `canto_api` exposes only guarded functions, not snapshot tables. The API requires an existing Printing Tracker administrator; imported Canto customer roles do not grant dashboard administration. `sa_sync.environment_state` tracks edits and the active refresh. A refresh requires the exact current edit revision when replacing Supabase edits; edits pause while a job is queued or running. Setting `cutover=true` disables old-system refresh.

Recovery: run `encrypted_backup.py ENVIRONMENT JOB_UUID NEW_PRIVATE_DIRECTORY`, then pass the resulting `before` directory to `rollback.py`. The archive includes snapshot records, sequence state, and companion media links. Rollback uses the same content verification and authentication enrollment transaction and is blocked during a job or after cutover. Recovery changes account state to match the restored snapshot; it does not restore previously revoked sessions.

## Deploying the administration API

The existing snapshot and identity migration must already be installed. From the repository root, use `tools/canto-sync/.venv/bin/python tools/canto-sync/deploy_admin.py staging` to apply and record only the two Canto administration migrations, expose the guarded RPC schema, and deploy the controller. `deploy_admin.py production --check` is a read-only compatibility check. A production release requires the repository's explicit release authorization; after the reviewed code reaches `main`, the same deployment command with `production` configures that controller to dispatch the `main` worker. Do not run a blanket database push to reconcile unrelated historical migrations.

Private App Asset companion fields preserve the form's name and add-on selection, which the legacy snapshot table does not contain. These values, like companion media links, are included in recovery archives and replaced on an explicitly confirmed refresh. Legacy imported image files themselves remain on their original server until a separate file migration. Supabase uploads are already independent.
