# Squad backend environment parity

Scope authorized on 8 November 2026: backend parity only. Do not refresh data or media, copy production data into staging, change the Printing Tracker public schema, or activate ownership/cutover as part of this release.

## Release boundary

The reviewed Squad migration prefix, private execution roles, RPC definitions, grants, three Edge artifacts, private upload/document/transfer buckets, and environment-bound schedules must agree. Compare semantic definitions and code hashes; Edge deployment version numbers are independent counters.

Preserve each environment's users/passwords, business rows, provider destinations, credentials, source baseline, revisions, and existing public-schema applications. Production-only buckets remain. Uniware acceptance is explicitly deferred; Airtable is excluded. Provider writes and ownership remain disabled, and push stays in validation mode. Backend parity does not close pending email, physical-device, provider, or launch acceptance.

## Production source compatibility

The old production export contains 848 columns; staging contains 850. The rebuilt services require two additional destination fields on `sa_orders`: nullable `dashboard_reservation_id varchar`, and `order_source varchar NOT NULL DEFAULT 'unicommerce'`, matching staging and the original production provider. The explicitly reviewed bootstrap is `tools/squad/sql/production_snapshot_compatibility.sql`.

Original production columns and values are preserved. The source fingerprint and manifest remain unchanged. Refresh comparisons and writes use the original source projection, while encrypted backups and rollback include both companion values. Unknown extra columns stop refresh. No refresh is performed by this deployment.

The deeper catalog comparison also found 151 imported production text columns and four identity text columns using explicit `C.utf8`, while staging uses the database's `en-US` ICU default. These are different sorting semantics, not interchangeable names. The explicit `production_collation_compatibility.sql` bootstrap aligns those exact production columns to staging **before** installing dependent Squad functions. It preserves their types and values; it does not change the database-wide default or public schema. A hosted production rollback preview successfully exercised all 155 changes.

Migration `20261108144542_squad_backend_environment_parity.sql` aligns older identity metadata: both environments receive production's existing validated state/disposition/confirmation checks, restricted foreign key and canonical-email index. It also aligns constraint names and the equivalent transaction-time default, and restores all sequence privileges only to the existing `postgres` owner on 39 imported sequences. API-role permissions are not broadened.

## Reproducible release tools

- `release_mirror.py`: explicit target/cutoff; exact staging migration body comparison; transaction and refresh locks; protected-data and permission checks; rollback by default. An fsynced receipt precedes commit and supports explicit baseline recovery.
- `install_mirror_runtime.py`: production mirror provisioning only; new environment-specific secrets; no credential rotation; exact Edge hash comparison; private bucket verification; preserve unrelated schedules. Requires restored staging schedules and no active test fixtures.
- `verify_mirror_parity.py`: read-only semantic schema, role, permission, type, sequence-configuration, Edge, bucket and schedule comparison. Test-write access must be disabled. Current sequence values and business data are intentionally environment-specific.
- `verify_mirror_endpoints.py`: bootstrap, anonymous denial, worker pause, disabled ingress and production rehearsal rejection. No real-user sign-in or provider effect. Individual HTTP probe timings are not load benchmarks.

For this release, `squad-account` was packaged on staging with paths rooted at `squad-account/` and `_shared/`. Exact reproduction requires its checked-in `deno.lock` as well as the files returned by the Edge source-download tool, which omits the lockfile. Production was deployed through the Supabase connector with that same layout and lockfile; its final bundle SHA256 matches staging. Do not weaken the artifact comparison to accommodate a different package layout or omitted dependency lock.

Do not use the old staging-only installers for production or blanket-push unrelated database migrations. Do not dispatch refresh to test deployment. Before future refresh, the configured workflow ref must contain the exact reviewed target catalog/access baselines and the companion-aware backup code.

The refresh entrypoint calls `./.github/workflows/canto-refresh.yml`; GitHub resolves this local reusable workflow from the caller's commit. Pinning both dispatch refs to the reviewed backend release therefore keeps the wrapper, runner and each environment's catalog baselines together. Environment inputs still select separate DigitalOcean sources and Supabase destinations. See [GitHub's reusable-workflow version rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_iduses).

The existing Printing Tracker updates `public.hr_user_presence` through its normal dashboard heartbeat. The committed release preserved all protected rows within its transaction, but that heartbeat changed afterward during baseline recovery. `--accept-presence-heartbeat` permits only this explicitly reviewed, same-row-count table change during **post-commit** recovery; all source, Auth, media, other public data, public structure and backend artifacts must still match. It never relaxes the transaction's preservation checks and never rewrites presence data. The release receipt and recovery evidence record this exception.

## Evidence

Final release status is determined by saved hosted evidence, not this runbook or a successful local test count. Expected artifacts are `backend-mirror-parity.json`, `backend-mirror-endpoints.json`, `production-mirror-runtime.json`, and the release's rollback/apply verification report. An interrupted first rollback preview was cancelled to replace per-statement network calls with per-migration batches; production was independently verified to retain zero Squad migrations and its original schema/revisions afterward.

## Managed-platform difference

The final application schema, role/grant definitions, RPCs, four checked Edge artifacts (three Squad functions plus `canto-refresh`), private buckets, schedules, Data API settings and database collation match. Both projects run PostgreSQL 17.6. Production's available `pg_net` package ends at **0.20.0**, while staging provides **0.20.3**; production has no extension update path to 0.20.3. `pg_cron` 1.6.4 and Vault 0.3.1 match.

The verifier deliberately retains `equal: false` for this remaining platform difference and reports `application_artifacts_equal` separately. No managed database upgrade, downgrade, restart or fabricated extension-version change was performed. Supabase requires a [platform/Postgres upgrade to obtain newer pg_net packages](https://supabase.com/docs/guides/database/extensions/pg_net); its [current extension policy](https://supabase.com/changelog/extension-version-pinning-ignored) also ignores explicit version pins for non-superusers. A production maintenance upgrade must be planned separately because it can interrupt the live Printing Tracker and affect platform-managed extensions.

`verify_mirror_transport.py` exercises each installed pg_net version against its own paused worker and records the actual HTTP response. This establishes the required transport behavior without claiming the extension packages are identical or activating provider work.

## Saved release and maintenance preparation

The initial refresh release was `codex/backend-parity-20261108-112`, commit `1123afa155d3a271520dcba6059873073a529932`. The follow-up release below supersedes it; `implementation-evidence/backend-refresh-release.json` records the current verified dispatcher ref and exact commit. No refresh ran.

The user requested preparation of the remaining managed upgrade. Both projects currently offer GA build `17.11.0.018` with a one-hour estimate each, so the reviewed proposal upgrades staging first and production only after validation. Existing daily backups were checked; fresh verified recovery points remain mandatory execution gates. See [the maintenance plan](PLATFORM_MAINTENANCE_PLAN.md). No upgrade has started.

## Historical migration 113 production follow-up

On 8 November 2026, production received `20261108154028_squad_dashboard_customer_type_summary.sql`, matching staging. It restores the full filtered RMP customer-type summary before pagination. The dashboard task verified 53 focused database tests, 2,126 complete regression tests, all 14 source customer-type groups, and warm default SQL performance. The root release independently verified the production migration in a rolled-back transaction before applying it.

The production apply and post-commit baseline verification passed. All 86 source tables, Auth and business data, public schema, media metadata, and sequence state were protected. Normal live `public.hr_user_presence` heartbeat activity was the sole explicitly reviewed post-commit recovery exception. Every schedule's exact definition and prior enabled state was restored. See `implementation-evidence/production-followup-20261108154028-preview.json` and `production-followup-20261108154028-applied.json`.

Final hosted verification confirms 113 matching migrations, application artifact equality, unchanged public structures, disabled rehearsal writes, and passing endpoint checks. Strict overall parity remains false only for the documented managed `pg_net` patch version. The release remains in mirror mode with no refresh, cutover, provider activation, or platform upgrade.

Future refreshes must use the frozen `codex/backend-parity-20261108-113` release containing both reviewed access baselines. Keep the earlier 112 branch unchanged. Do not move either ref to a frontend development branch.

This backend alignment does not mark the dashboard frontend acceptance complete: the separate task is investigating a report-search/CSV statement timeout in the existing query path. Migration 113 changes the summary aggregation, not that RMP search path. Any subsequent SQL fix requires a new coordinated backend release and refreshed parity evidence.

## Current application release: migration141 (9 November2026)

This section supersedes the migration 113 release status above; those results and frozen refs remain historical. Production received the 28 reviewed migrations through `20261109043010_squad_worker_scope_index.sql`, bringing both environments to 141. The guarded transaction verified all 86 production source tables, protected data and public structure; exact schedules were restored. No source refresh, ownership cutover, provider activation or managed-platform upgrade ran. See the [production apply receipt](../squad-one-web/evidence/production-release-141.json).

The production `squad-account` and `squad-jobs` deployments now match staging; `canto-refresh` and `squad-webhooks` stayed unchanged. All four checked Edge bundle hashes agree, without secret/provider configuration changes ([Edge receipt](../squad-one-web/evidence/production-edge-release-141.json)). The [saved141 parity result](../squad-one-web/evidence/application-parity-141.json) reports `application_artifacts_equal: true` for schemas, roles/grants, RPCs, Edge artifacts, private buckets and schedules. Both projects have141 matching migrations.

Strict `equal` remains **false**: production `pg_net`0.20.0 and staging0.20.3 still differ. The verifier exited1 for that documented platform difference only; it was not suppressed or represented as identical infrastructure. The managed maintenance plan remains separate. [Endpoint checks](../squad-one-web/evidence/backend-endpoints-141.json) pass, including anonymous denials, paused workers and disabled ingress/rehearsal paths. These single HTTP probes are not performance/load benchmarks.

Both environments' [reviewed refresh catalog/access baselines](../squad-one-web/evidence/refresh-catalog-check-141.json) match 141. The [frozen refresh reference receipt](../squad-one-web/evidence/frozen-refresh-reference-141.json) now confirms `codex/backend-parity-20261109-141` at commit `14e178d108220418e7a6bc1da14971f9bfa0cba3` configured in both environments, with every other secret digest preserved. No refresh was executed for this verification. Frontend release acceptance remains separately tracked in the [web execution gates](../squad-one-web/release-execution-gates.md); application backend parity does not claim native Safari, deployed web, provider or strict platform completion.
