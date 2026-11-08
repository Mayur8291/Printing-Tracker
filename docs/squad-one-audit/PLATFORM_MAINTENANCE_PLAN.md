# Supabase platform maintenance proposal

Prepared 8 November 2026. **Preparation only; no upgrade, restart, restore, or extension update has run.** Execution needs approval of the maintenance window. Application backend parity is already verified; this proposal closes the remaining managed-platform difference.

## Exact target and scope

| Environment | Project | Current Supabase Postgres build | Offered target | Platform downtime estimate |
|---|---|---|---|---|
| Staging | `scvojtvgnkmbupvyslmb` | `17.6.1.127` | `17.11.0.018`, GA | 1 hour |
| Production | `levwrmvqdntngeasrtnb` | `17.6.1.084` | `17.11.0.018`, GA | 1 hour |

The Management API currently offers only this target, not production's upgrade to staging's older build. Consequently, upgrade **staging first**, validate it, and then upgrade production to the same build. PostgreSQL remains major version 17. Recheck the offered build immediately before each operation; a changed target requires a revised review, not automatic acceptance of a different release.

Current `pg_net` is 0.20.3 in staging and 0.20.0 in production. The target's actual installed/default extension versions must be measured on upgraded staging before production proceeds. Do not assume the new build installs 0.20.3 specifically. Match the tested, supported package in both environments; never downgrade staging or fabricate extension metadata.

Reserve **90 minutes per environment**: the platform's one-hour estimate plus 30 minutes for verification. These are planning windows, not a downtime guarantee. Production starts only after staging passes; allow separate windows if rehearsal or backup verification takes longer. Database-dependent Printing Tracker operations, login, and Realtime may be unavailable during that environment's upgrade. DigitalOcean remains operational and unchanged.

The upgrade affects the whole Supabase project, including the existing Printing Tracker. Application code, migrations, `public` definitions, business data, users, media destinations, provider settings, and cutover state are to be preserved. No refresh, environment-to-environment data copy, Uniware activation, Airtable work, or frontend release is included.

## Read-only preparation completed

Evidence: [eligibility and backups](implementation-evidence/platform-maintenance-eligibility.json), [database preflight](implementation-evidence/platform-maintenance-preflight.json).

- Both projects report `ACTIVE_HEALTHY`, upgrade eligibility, and no platform validation errors or warnings. Neither has an upgrade in progress.
- Production database: 481,176,723 bytes (~459 MiB); staging: 814,320,787 bytes (~777 MiB).
- Cron history: ~9.3 MiB production, ~27.8 MiB staging. No history deletion is proposed.
- Both contain eight enabled schedules, including five existing Printing Tracker schedules and three Squad schedules. Capture and restore **all eight**, preserving their commands, owners, timing, and enabled states.
- No invalid indexes or `ltree` table columns were found. Installed extension inventories are saved in the evidence.
- Production has no replication slots. Staging has two active Supabase Realtime slots. Despite these, its eligibility response reports no blocking errors. Recheck after the other task's acceptance run; do not manually drop managed Realtime slots. If the platform later reports a blocker, use the supported Supabase procedure before proceeding.
- Each project has seven completed daily physical backups. Latest production: **8 November 03:11 IST** (`2026-11-07T21:41:00.792Z`). Latest staging: **8 November 03:40 IST** (`2026-11-07T22:10:05.645Z`). **PITR is disabled in both.** These backups predate today's final backend release and are not sufficient as the sole pre-upgrade recovery point.
- Both refresh dispatchers now use frozen release `codex/backend-parity-20261108-112`, commit `1123afa155d3a271520dcba6059873073a529932`. The remote SHA and both secret digests were verified. No refresh was dispatched. [Release evidence](implementation-evidence/backend-refresh-release.json).

## Execution sequence after approval

1. **Coordinate and recheck.** Wait for staging acceptance fixtures to finish and schedules/test flags to be restored. Agree the production window. Re-read project eligibility, target build, status, backup inventory, extensions, replication status, active refreshes, and outbox state. Stop on a new blocker, unexpected build, active refresh, or unaccounted work. Capture pre-window security advisors and query latency samples for comparison.
2. **Establish a fresh recovery point for that environment.** During a controlled write pause, create an encrypted, consistent database backup covering application schemas, `public`, Auth data, Storage metadata, migration history, roles/grants, and schedule definitions. Capture environment configuration and recovery material separately in protected local storage, never Git. Do not treat the existing source-snapshot refresh backup as a whole-project backup. Validate the archive, checksums, decryption, and an isolated restore of the application/Auth schemas and representative rows before starting the platform operation. If a complete restorable backup cannot be demonstrated, stop before upgrade. Repeat at production's own window; do not reuse staging's backup.
3. **Preserve non-database recovery material.** Inventory Storage buckets/objects and current media checksums; retain object versions or protected copies where a destructive rollback would otherwise lose them. Save Edge artifacts and configuration independently. Inventory custom login roles and ensure their credential recovery procedure is available without printing passwords. Verify Vault-dependent operations remain recoverable. A database-only backup must not be described as a complete project backup.
4. **Confirm the quiet baseline.** The write pause in step 2 must include affected schedules and draining in-flight work before the final baseline/backup. Record every schedule's original state and commands securely. Capture source/business/Auth content digests, sequence state, public/schema definitions and grants, migration bodies, Storage metadata, provider flags, and worker/outbox state. Keep ownership/cutover disabled and provider writes disabled. Arrange client reconnect/reload after service returns. If writes occurred after the validated recovery point, establish a new consistent final backup before starting.
5. **Upgrade staging through the supported Supabase project upgrade control.** Verify the displayed GA target is `17.11.0.018` before submitting. The documented API accepts a Postgres major target (`17`) and release channel (`ga`), not a guaranteed immutable build pin; do not send an invented build-level payload. Submit once and poll upgrade status; do not retry an ambiguous upgrade POST. Retain status/log evidence and leave production alone until staging acceptance passes.
6. **Validate staging before reopening writes.** Check the acceptance gates below. If the package is available but `pg_net` remains on an older installed version, review the actual supported update path and perform the normal extension update on staging, then repeat the transport/security tests. Record its exact result for production. Restore schedules to their recorded state and test Realtime reconnection. Observe normal behavior before scheduling production.
7. **Repeat the verified procedure on production.** Use its own backup, baseline, credentials, and schedules. Require the same tested target and extension versions. Repeat all acceptance gates, restore original schedule states, reopen writes, and monitor errors/latency for at least 30 minutes. Preserve audit evidence for any unavoidable platform-generated definition changes; never automatically rewrite `public` to make a hash match.

Fresh backup creation and restore rehearsal are **required execution gates, not completed claims**. Preparation has inspected existing backups; no full-project backup or restore has been performed by this task.

## Acceptance gates

- **Final production gate:** both projects are healthy on the same reviewed Supabase Postgres build. Required extension versions match and the complete backend parity verifier returns `equal: true`.
- **Intermediate staging gate:** production intentionally remains on its old build. Require application-artifact equality and staging's own before/after preservation checks; record only the specifically reviewed platform build/extension differences as temporary. The strict parity verifier may exit 1 at this intermediate stage. Any additional difference is a stop condition; do not weaken the verifier. Full equality is required after production completes.
- All 112 migration bodies, seven application schemas, execution roles and grants, RLS, four checked Edge bundles, private buckets, Data API configuration, and environment-normalized schedules retain their reviewed definitions.
- Within each environment, source/business/Auth rows, password hashes, sequence next values, and Storage metadata match the quiet pre-upgrade baseline. Investigate any differences; do not discard them as expected traffic without evidence.
- Existing `public` application definitions and access policies match their own pre-upgrade baseline. Any serialization difference introduced by the newer PostgreSQL version requires a semantic review; no schema repair is authorized simply to normalize the report.
- Run the existing verification programs from the repository root:

  ```sh
  tools/canto-sync/.venv/bin/python tools/squad/verify_mirror_parity.py
  tools/canto-sync/.venv/bin/python tools/squad/verify_mirror_endpoints.py
  tools/canto-sync/.venv/bin/python tools/squad/verify_mirror_transport.py
  ```

- Reconfirm anonymous denial, authenticated access boundaries, paused workers, disabled provider ingress, and actual database-originated HTTP transport. These checks do not authorize email, push, warehouse, or order side effects.
- Verify the existing dashboard session or a designated test account, a safe dashboard read, representative media access, and Realtime reconnect in each environment. Confirm all eight schedules survived and have their original state; do not manually trigger business schedules as a smoke test.
- Compare security advisors, invalid-index checks, query plans/latency samples, and application logs against the pre-window baseline. No unresolved functional regression, broader permission, or material performance regression is acceptable. Single-request timings do not establish load capacity.

## Failure and recovery

If staging fails, keep production unchanged and investigate once against the captured evidence. Supabase's upgrade procedure includes recovery of the original database on an upgrade failure; an application regression after a successful upgrade is a different case and has no promised one-click downgrade. [Supabase upgrade procedure](https://supabase.com/docs/guides/platform/upgrading).

Keep writes closed while deciding recovery. Prefer restoring the fresh backup into an isolated recovery project to verify integrity before replacing a live database. A destructive restore or accepting loss of writes requires an explicit recovery decision; do not automatically restore yesterday's backup. Recovery duration is not yet measured and is separate from the one-hour upgrade estimate. If writes have reopened, reconcile post-backup changes before any restore.

Database backups exclude Storage object bytes and have custom-role credential limitations, so their recovery must be planned separately. [Supabase backup scope and recovery](https://supabase.com/docs/guides/platform/backups).

The platform upgrade recreates `pg_cron`, making full schedule preservation and verification mandatory. [Supabase pg_cron upgrade caveat](https://supabase.com/docs/guides/platform/upgrading#pg_cron-usage).

## Approval boundary

Approve a staging-first maintenance run with these backup and verification gates, followed by production only after staging succeeds, or provide a preferred production window. No platform operation will start from this preparation alone. If the target changes, eligibility fails, backup restore cannot be verified, or staging regresses, stop before production and report the concrete issue.
