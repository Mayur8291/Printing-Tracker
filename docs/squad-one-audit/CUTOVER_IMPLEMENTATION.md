# Ownership cutover and release evidence

The backend contracts are implemented and have passed **46 isolated SQL tests and 42 proof-verifier tests**. Migration `20261108080502_squad_cutover_contracts.sql` has been deployed to staging without activating ownership. No hosted acceptance has been registered, no production release has been authorized, and staging remains a source mirror. Actual final source freeze, full acceptance evidence and business anomaly resolution are release gates, not accomplishments implied by these tests.

## Public contract

| Contract | Authority | Behavior |
|---|---|---|
| `canto_api.v1_cutover_preview(p_acceptance_id uuid = null)` | Current Printing Tracker platform admin | Read-only facts, explicit checks/blockers, readiness, opaque version and server time |
| `canto_api.v1_cutover_commit(p_acceptance_id uuid, p_expected_version text, p_idempotency_key uuid)` | Same live platform authority | One atomic, idempotent transition from clean mirror to owned data |
| `canto_api.squad_cutover_acceptance_register(p_evidence jsonb)` | Trusted service worker only | Registers a short-lived, exact-state acceptance proof; never activates ownership |

Legacy Admin is a business persona and cannot perform platform cutover. Browser clients cannot submit pass flags, create release authorizations or write any of the private acceptance/commit tables. Current session, role and ban checks remain authoritative. Default PUBLIC execution is revoked and search paths are fixed. Existing constrained roles execute the private functions; there is no new postgres-owned Auth-reading bridge.

Preview binds environment, current generation, edit/synced revisions, active refresh, latest source publication, media and identity exception digests, pending work, stock ambiguity, acceptance expiry and production release authorization. Missing, malformed, timezone-less, unordered, future or stale capture times are explicit blockers. Source host/database/project must match the existing environment mapping. A staged proof cannot activate production.

Commit takes the exclusive publication and relationship locks, locks environment/runtime state, and repeats all checks against the preview version. It flips `cutover` once, advances edit revision and generation, disables test writes, appends an immutable ownership record and audit, and records its idempotent result. An exact retry returns the same result even after later owned writes; changed payloads or a second activation fail. Business rows, Auth UUIDs and sequence values remain untouched. No historical notifications, provider orders, stock receipts or other outbound effects are emitted.

The existing refresh publisher rejects a cutover environment. There is no reverse-toggle API. After real new-system writes, recovery must preserve and replay/reconcile those writes; restoring the old source snapshot alone would lose data. `sa_domain.ownership_epoch()` returns an activation timestamp only when the persisted commit matches the current environment/generation and ownership flag. Warehouse ingress uses that verified watermark, never a raw test-write flag.

## Hard gates and exceptions

Acceptance requires a clean mirror, test override off, no active/queued/unconfirmed refresh, and no unfinished order/account/document/import/upload/outbox work. Queued effects are not discarded to make cutover appear ready. Reserved uploads must expire or complete. Stock availability ambiguities and invalid owners are hard blockers. The verifier additionally inspects each stock receipt using the same reconciliation evidence predicates; duplicate origins, invalid consumption and inconsistent source quantity/completion cannot be waived by an operator's freeze statement.

The known staging baseline contains duplicate stock origins and an overconsumed receipt. These currently prevent final acceptance. Reconciliation can safely rebuild a derived consumed counter when that is the only problem; it does not select a duplicate receipt to delete or fabricate a physical quantity. Business corrections require evidence and an approved correction policy.

Ready media must have a valid immutable object, size, verification metadata and matching bytes. Unknown, corrupt or unavailable supposedly-ready objects are blockers. Previously reported same-environment missing source files may be accepted only with `media_policy = reviewed_source_missing` and the exact current media-report digest. The collector independently confirms those source URLs still return the migration tool's accepted missing response; if a file has reappeared, another refresh is required. External shares remain external and are included in the same reviewed report. No production file is used to fill staging gaps.

Identity mappings must be complete. The verifier recomputes source eligibility and checks actual passwords, email identities, UUID/role metadata, confirmation and active/blocked state. Inactive source accounts stay blocked. Known source identity exceptions require `reviewed_identity_exceptions` and the exact mapping report; unexplained mismatches fail. No password, token, email or raw identity row is written to the proof artifact.

Production is denied by default. Its SQL gate additionally requires an unrevoked, unexpired `production_release_authorizations` record bound to the exact source run, generation and acceptance artifact. No app or service role can create that authorization. This implements the existing separate production release rule; it does not authorize production activity now.

## Trusted proof collector

`tools/squad/cutover_evidence.py` supports staging only. By default it collects a private local artifact and makes no database writes. `--register` records that artifact's acceptance after verification; the tool has no ownership activation call. The separate platform-admin commit remains the only activation path.

It requires an already-published final capture directory containing `source.dump` and `capture.json`, plus trusted test-runner reports:

1. Verify source environment/archive hash, re-extract the dump using the existing reviewed remapper, and reject schema drift.
2. Check deployed migration SQL against the release files and the reviewed schema/access fingerprints.
3. Verify every imported table's exact row content, constraints, direct-access isolation and sequence state; ensure every owned sequence's next value exceeds existing IDs without resetting sequences.
4. Recompute live Auth eligibility/password/role/email-identity parity and inspect all stock receipt evidence in batches of 100.
5. Compare source media references to the published inventory, download each unique required private object and verify SHA-256/byte length, and recheck missing source URLs. Network operations run outside database transactions with 1–8 bounded workers (default 4).
6. Recheck the entire state and code fingerprint after media reads, including Auth and sequence high-water checks. A refresh, new queued job, credential change or code change invalidates collection.
7. Save an immutable local artifact with mode 0600 before optional proof registration. Registration names its exact digest; a separate receipt file stores the returned acceptance ID. Proof expires after 15 minutes; verification timestamps must be recent.

The source-write freeze is **operator attestation**, explicitly separate from machine checks. The tool cannot observe every old-system writer or prove an operational freeze remains in force. The attestation must identify the actual freeze window and source watermark; its timestamp must precede capture. Neither a boolean toggle nor the existence of a dump is described as proof of that operational fact.

Example invocation, after actual release prerequisites have been satisfied:

```sh
tools/canto-sync/.venv/bin/python tools/squad/cutover_evidence.py \
  --capture /private/final-staging-capture \
  --bundle /private/staging-acceptance/bundle.json \
  --output /private/staging-acceptance/verified-proof.json
```

The output file must not already exist. Do not commit capture data, report fixtures, freeze references or private artifacts to the repository. A failed run does not register acceptance. A failed registration can leave the independently valid local artifact; no receipt is presented as successful unless registration returned after commit.

## Acceptance report format and trust boundary

The bundle contains `environment`, `source_run_id`, `generation` (string), `code_sha256` from `source_fingerprint()`, `acceptance_contract_sha256` from `contract_fingerprint()`, `freeze: {at, watermark, attestation}`, explicit media/identity policies and their current report digests, and exactly seven `reports: [{file, sha256}]`. Report paths are relative to the bundle directory, cannot escape it, and are bounded to 10 MiB. The contract fingerprint binds both `ACCEPTANCE.md` and `functionality-matrix.csv`.

Every report repeats the context fields and contains `kind`, timezone-aware `started_at`/`finished_at`, `status: passed`, integer `passed > 0`, `failed: 0`, named `runner`, and actual `cases`. Every case requires a unique `id`, `outcome: passed`, nonempty `test_ids` referencing executable tests, and nonempty `assertions` describing the verified outcomes. Old (>24 hours), future, failed, duplicate, incomplete or wrong-source/code reports are rejected.

| Report kind | Required coverage |
|---|---|
| `persona_journeys` | All 11 active personas, Tailor and SubTailor as managed subjects, and separate Printing Tracker admin; exact journey labels in `ACCEPTANCE.md` |
| `workflow_acceptance` | Every current workflow ID from `functionality-matrix.csv` |
| `permission_matrix` | All `SEC-*` acceptance groups |
| `refresh_rehearsal` | All `REF-*` groups |
| `mixed_load` | All `PERF-*` groups; measured database p95 <200 ms lists/details and <500 ms ordinary commands, concurrency ≥2, ≥100 measured samples, zero invariant/unhandled failures |
| `provider_configuration` | All `INT-*` groups, including environment separation and replay/reconciliation |
| `rollback_rehearsal` | `REF-05:new_owned_writes_preserved` and `REF-05:replay_reconciliation` |

Mixed-load metrics are `list_detail_db_p95_ms`, `ordinary_command_db_p95_ms`, `concurrency`, `samples`, `invariant_failures`, and `unhandled_errors`. Provider acceptance and API/network latency must remain distinct from the database budget.

These are trusted release-runner artifacts, not signed third-party attestations. Hashes prove which report bytes were reviewed, not that an untrusted author ran tests. A privileged operator/service worker is trusted to supply genuine test output; the browser cannot provide or waive these reports. The existing individual implementation evidence files are not automatically promoted to complete acceptance. Full workflow/persona/mixed-load/rollback reports still need to be generated from the final release verification.

## Verification and limits

The SQL suite covers authority, role/session revocation, environment/source/time mismatches, generation/revision/fingerprint staleness, exact replay/conflict, pending work preservation, media/identity policies, corrupt objects, stock blockers, explicit production authorization and row/UUID/sequence preservation. The collector suite adds real local Auth/identity/sequence/stock checks, all report validation negatives, byte-verifier failures, source-outage distinction, reappearing files, source/code races, read-only default, proof-only registration and production CLI denial.

```sh
SQUAD_TEST_DATABASE=squad_test_stock tools/canto-sync/.venv/bin/python -m unittest discover -s tools/squad -p 'test_cutover*.py'
```

Final proof collection intentionally performs a complete reconciliation and may take substantially longer than ordinary paginated APIs. It is an infrequent release operation with explicit publication locks and no database transaction held during HTTP reads. There is no claim that complete archive/media verification fits the ordinary 200/500 ms request budgets. The UI should show it as a release job if exposed later, while the mobile/web application continues to use the bounded normal services.
