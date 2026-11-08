# Shared import and export service

Iteration 27 implements validated CSV imports for Masters, prices and zones, and scoped Masters exports. It extends `squad-account` and `squad-jobs`; no additional Edge deployment is required. Source snapshots remain in `sa_snapshot_20261019`. Transfer state is private to `sa_domain`; files use the private `squad-transfers` bucket. Existing Printing Tracker public structure is unchanged.

## Contracts and client flow

| Shared SDK method | Purpose |
|---|---|
| `reserveTransferUpload(kind, resource, file, key)` | Reserve a fixed, write-once CSV path and obtain an authenticated signed upload |
| `verifyTransferUpload(id)` | Verify exact byte length, UTF-8 content and SHA-256 through the account Edge |
| `requestImport(kind, request, key)` | Start validation, explicitly apply a clean validated version, or cancel |
| `transfers(page)` / `transfer(id, page)` | Cursor-paginated own history or row results, including durable errors and applied count |
| `requestExport(resource, request, key)` | Capture an immutable, filtered Masters export with allowed columns |
| `downloadTransfer(id)` | Recheck current authority/generation and issue a short private download grant |

The request/status/export RPCs are `v1_import_request`, `v1_import_status` and `v1_export_request`. Upload/verification/download orchestration shares `squad-account`. Only the trusted queue worker can call `squad_transfer_work` or cleanup. User input cannot choose arbitrary tables, SQL, buckets, object paths or provider URLs.

Masters and prices require current Printing Tracker staff administration. Zones also support a current legacy Admin. Each queued step rechecks current identity, role, principal, generation and lease. Staff accounts keep their own identity; legacy Admin is not promoted into Printing Tracker staff. Imports and exports require new-system ownership; the disposable staging write override does not bypass this bulk-job gate. Existing interactive Masters retain their established mirror behavior. Refresh expires old jobs/uploads/results without replaying changes.

Upload, validation, apply and export are separate observable stages. **Validation does not mutate application rows or consume application sequences.** Applying requires the latest transfer version and a nonempty, error-free validation result. Each apply step is one atomic batch of at most 50 rows. An entire large file is not a single transaction: cancellation or a later conflict preserves earlier successful batches and reports their count. Automatic retry does not silently overwrite concurrent edits or restart a completed batch.

## Shared business behavior

Masters use the existing registry and mutation dispatcher, including required fields, actual column types, references, relation replacement and audit. CSV headers resolve legacy camel-case fields. An optional match field must be a real allowed registry field. Ambiguous matches, duplicate input identities and duplicate new unique names are errors before apply. Per-row versions detect changes between validation and apply; unrelated form edits do not invalidate an entire import.

Price CSVs require unambiguous SKU and price-type references, finite valid numeric values and strict fields. Blank legacy MRP retains the existing zero interpretation. Replacement captures the exact candidates and their versions at validation; it affects only the touched SKUs. It preserves concurrently added prices and rejects modified replacement candidates. It cannot delete every price by receiving an empty or malformed input.

Zones resolve case-insensitive names and reject ambiguity. Their follow-up pricing refresh runs in two bounded passes so customers inherit the updated dealer zone. These are rules for future orders; historical order financial values are preserved.

Exports capture their source rows once under the publication fence, then render resumable parts from that snapshot. Allowed columns and reference filters come from the existing Masters registry. Relation IDs remain usable for re-import. UTF-8, quoted commas, embedded newlines and Unicode survive serialization; cells beginning with spreadsheet formula characters are escaped. Private row input/normalized values and object paths are absent from user-facing history.

## Limits, retry and retention

| Boundary | Limit |
|---|---:|
| CSV file | 10 MiB |
| Rows per file | 20,000 |
| Columns | 100 |
| CSV field / record | 16,000 characters / 64 KiB |
| Range read / validation step | 256 KiB / 100 rows |
| Atomic apply / export part | 50 / 100 rows |
| Captured export JSON / merged CSV | 8 MiB / 10 MiB |
| Export parts | 200 |
| History or row-status page | 100 maximum, 25 default |
| Active imports per actor / uploads per day | 1 / 20 |
| Exports per actor per hour | 10 |
| Export download grant | 120 seconds |

The worker validates exact Storage ranges and checksums. Retried uploads cannot overwrite an existing different object. At most one heavy document or CSV job is claimed per invocation; external I/O shares a 35-second work deadline, with bounded concurrent part reads and five durable attempts. Transient Storage errors remain retryable; invalid input is terminal and visible. The existing demand-driven five-second Cron pump also picks up transfer work.

Uploads initially expire after one hour; verification extends retention to three days. Transfers expire after three days. Cleanup expires queue leases before deleting files, erases raw/normalized row material in bounded batches, and enumerates only deterministic owned paths. Each claimed cleanup receipt corresponds to one path; acknowledgement never consumes an unseen next batch. Missing files are safe to delete again after a lost acknowledgement.

Supabase signed upload tokens remain valid for two hours. Because a still-valid reservation can request another token, input cleanup waits at least three hours fifteen minutes from reservation creation. Output cleanup waits five minutes past expiry for in-flight uploads. These grace periods prevent a still-valid writer from recreating already-cleaned data. [Signed upload reference](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl), [Edge runtime limits](https://supabase.com/docs/guides/functions/limits).

## Evidence and remaining work

The reviewed migration prefix passes **1,257 database tests**. Transfer contracts and worker tests include dry validation, concurrent replacement safety, current authority, replay, strict mirror fencing, refresh invalidation, bounded processing and cleanup. CSV/Storage/handler tests exercise malformed UTF-8, quoted boundaries, range responses, checksums, invalid paths, recovery and timeouts. Shared SDK tests and mobile typing pass.

The committed staging acceptance used actual GoTrue, the shared SDK, deployed Edges and private Storage: 201 synthetic records, a 291,510-byte upload crossing range boundaries, three validation steps, five apply steps, three export parts and one merge. Export contained all 201 rows; checksums, Unicode, multiline fields, quote handling, formula escaping, private access and duplicate-row rejection were verified. All exact-owned Auth/profile, business, audit, command, job and Storage fixtures were removed; mirror mode, original revisions and schedules restored. [Hosted journey](implementation-evidence/staging-transfers-sdk.json).

The **enabled Airtable workflow and legacy import-history projection remain separate work**; the Airtable request currently reports disabled/unconfigured and must not be counted as implemented. General business-event mail, provider integrations and final mixed-load/full-persona acceptance are also separate gates. This document does not certify the largest allowed file or production capacity from the 201-row hosted journey.
