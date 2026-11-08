# Airtable import implementation

The Airtable path is an optional, explicitly enabled administrative import into the existing snapshot schema. It uses the same Masters validation, mutations, relation writer, media writer and price-statistics logic as interactive administration. It does not modify `public`, change Auth roles, send data to DigitalOcean, or activate an external integration.

The implementation is local until the parent release process reviews and deploys migrations `20261108084219`, `20261108085147`, `20261108085403` and the failure-recovery follow-up `20261108093011`. Both hosted environments must remain disabled until environment-specific provider configuration and a real isolated-provider acceptance run are verified. Local test results do not establish live Airtable credentials or provider acceptance.

## Public and worker contracts

- `v1_import_request('airtable', {}, command_key)` captures and validates; it does not apply business changes.
- `v1_import_status(id)` returns the existing transfer projection, row errors, the current phase, per-resource captured counts and proposed retirement counts. Its cursor pages through immutable row identities rather than returning a large capture.
- `v1_import_request('airtable', {action:'apply', id, version}, command_key)` applies the validated capture. The supplied version must match and every row/media attachment must be valid.
- `v1_import_request('airtable', {action:'cancel', id, version}, command_key)` cancels remaining work. Already committed batches remain visible; the response/report distinguishes partial work. A private statistics continuation converges derived price minima after cancellation or failure.
- Service-only `squad_airtable_work(id, lease_token, action, input)` handles bounded `input`, `capture`, `media`, `validate`, `apply`, `yield`, `retry` and `fail` actions. Every continuation is generation- and lease-bound. Lost capture/checkpoint responses replay safely; changing an already captured page is a conflict.

The retry budget measures consecutive failures: actual capture, media, validation or application progress resets it, while preparing input or replaying an existing receipt does not. Five failures without progress still stop the job. Deterministic data, integrity and capacity errors become sanitized terminal results immediately. Serialization conflicts, deadlocks and uncertain SQL outcomes remain recoverable. Failed or abandoned partial imports retain their committed data and schedule only derived price-statistics repair; they do not silently resume the remaining import writes.

The worker returns `phase='capture'|'media'|'validate'|'apply'`. Matching and retirement planning are internal validation steps. Scalar writes, relation writes, retirement and statistics are internal apply steps. `airtable.statistics` uses the same handler and returns `phase='apply', step='statistics_repair'`; it only recomputes recorded classes and cannot perform imported CRUD.

Current live platform administrators and current legacy role-0 administrators can request Airtable imports. Other personas cannot. A legacy administrator is never promoted to a Printing Tracker staff profile. A narrowly scoped private capability authorizes one exact Masters action/payload within a leased Airtable row. No browser or service-role caller can insert that capability directly.

## Source coverage

There are **22 remote Airtable tables** and one derived category resource. The source repository has 23 `fetch_*` files because `fetch_all_data_service` is the orchestrator, not another table. The source-backed mapping is `supabase/functions/squad-jobs/airtable-contracts.json`; the database stores the same contract. SQL tests check they agree.

| Remote resource | Identity and notable behavior |
| --- | --- |
| Promotions | Airtable ID; verified thumbnail and human-readable downloaded size; absent thumbnail is detached. |
| Asset info | Airtable ID; exact legacy camel-case geometry fields and private asset. |
| Colors | Airtable ID; only source-0 rows without a creator may be imported or retired. |
| Authorized brands | Airtable ID; ready-stock base. |
| Profit margins | Airtable ID; existing range and branding-price rules. |
| Size types | Airtable ID. |
| Base product types | Airtable ID; ordering and image. |
| Base products | Airtable ID, then constrained source-0 name fallback; scalar references first, category/fabric/part/size-type relations second. |
| Add-ons | Airtable ID, then constrained source-0 add-on-name fallback; selector enum, colors and base-product relations. |
| Parts | Airtable ID, then constrained source-0 name fallback; colors/add-on relations. |
| Fabrics | Airtable ID; existing fabric-type enum, colors and image. |
| Custom sizes | Airtable ID and required/optional size-type rules from Masters. |
| Ready-made categories | Airtable ID; ordering and image. |
| Ready-made brands | Airtable ID; authorized-brand reference and category relations. |
| Ready-made sizes | Airtable ID; normalized size-type enum and case-insensitive canonical-size positions, with captured versions. |
| Ready-made colors | Airtable ID and legacy code. |
| Ready-made classes | Airtable ID; color reference, five original images and five large thumbnails. Embedded-video string remains its existing allowlisted field. |
| Ready-made SKUs | Airtable ID; class/brand/category/size references and tax fields. |
| Ready-made price types | Airtable ID; legacy price-for fallback and existing zone-by-name lookup. No zone is invented. |
| Ready-made prices | Airtable ID; existing SKU-price link maintenance; affected class minima are recomputed in bounded batches. |
| Base-product asset links | Original four-reference compound identity; this table has no Airtable ID. All four links are required by both the Rails schema and Masters contract. |
| Promotional banners | Airtable ID; product selectors and verified image. |
| **Derived categories** | Case-insensitive names from base-product category labels. Existing categories are reused; new ones use the shared Masters command under the private capability. Categories are not retired. |

The original base-product-asset fetcher logs a missing add-on but still calls `save!`. Its model does not declare optional associations, and the Rails schema has `null:false` on add-on, part, asset-info and base-product IDs. Missing links therefore invalidate the new capture instead of silently inserting an impossible record.

## Capture and mutation boundaries

1. Capture every page of all 22 resources before any business mutation. Page digests and offset histories detect changed retries, duplicate records and offset loops.
2. Copy and verify attachments before validation. A refreshed expiring URL is accepted only for the same captured attachment ID, original filename, original byte length and MIME type. Captured business attributes are never replaced during the media refresh.
3. Resolve identities and freeze versions. Exact Airtable ID wins. Only base products, parts and add-ons use legacy name fallback, and only source-0 rows whose old Airtable ID is null or absent from the complete capture qualify. Source-1 rows are never adopted, overwritten or retired.
4. Validate through `master_request(validate_create/validate_update)` without business DML or business-sequence consumption. Private negative IDs represent captured new references only during validation. Duplicate unique values and missing references invalidate the entire import.
5. Preview the proposed row and retirement counts, then explicitly apply. Scalar records precede relations, so linked cycles do not require duplicate CRUD implementations.
6. Retire only captured, pre-existing source-0 candidates missing from the complete capture. Newly created rows and rows changed after the capture began are excluded from retirement planning. Every planned update and retirement uses the captured `updated_at`; later conflicts stop the import and remain visible.
7. Recompute affected class price minima after mutations. A failed, cancelled or expired partial import schedules the same bounded derived-only repair, even when Airtable is subsequently disabled or the requesting account is revoked. It never resumes the cancelled import.

Airtable's paginated API does **not** provide a point-in-time snapshot token. The report explicitly marks `source_consistency='paginated_unversioned'`. Complete pagination, immutable local checkpoints and destination versions cannot prove that the upstream base did not change while pages were fetched. A coordinated quiet source window is necessary when exact point-in-time correspondence matters. This limitation is not reported as verified consistency.

Application is transactional **per bounded batch**, not across a potentially 200,000-row import. An error may leave earlier successful upserts committed. The transfer records this partial outcome, performs no further imported CRUD, and repairs derived statistics. A fresh validated capture is required after application/version conflicts; it is not blindly replayed.

## Bounds, media and retention

- At most one active Airtable import across actors, including a validated capture waiting for explicit apply.
- At most 200,000 captured logical rows overall, 150,000 rows per remote resource and 256MiB of normalized capture JSON. These limits intentionally exceed the CSV import's 20,000-row ceiling; staging already contains 91,541 ready-made prices.
- Provider pages: at most 100 rows. Database matching, validation and scalar/relation/retirement application: at most 100 rows per action. Retirement enumeration: 500 existing records per action. Statistics: at most 10 captured class IDs per action.
- At most two media objects per worker media action, with a **25MiB per-attachment** limit. The separate general app-upload ceiling does not apply to this import.
- Media manifests require a private `canto-media` content-addressed path, SHA-256, positive bounded integer bytes and an approved MIME type. Supported verified formats are PNG, JPEG, GIF, WebP, SVG, PDF, MP4 and WebM. Large thumbnails must be PNG/JPEG/WebP. Original metadata must match; thumbnail bytes/MIME may differ from the original by design.
- Missing or changed media is a row error; it cannot be replaced from another environment or bypassed during application.
- Capture expires after the existing three-day transfer lease. Bounded cleanup removes raw attributes, relationships, source URLs and filenames while retaining transfer/row error and result identities. Canonical verified content-addressed objects remain subject to the existing media-retention policy; this import does not delete shared immutable objects.

## Verification evidence

`tools/squad/test_airtable.py` exercises the complete 22-resource plus derived-category graph, scalar/relation ordering, validation without sequence consumption, actual shared Masters audits/source values, legacy and staff administrator boundaries, source-1 protection, name-recreation collision handling, optimistic updates/retirements, canonical-size versions, complete media registration/attachment, changed attachment identities, thumbnail metadata differences, malformed manifests, capture replay, lease recovery, global serialization, cancellation and bounded cleanup.

A representative 1,000-price import validates and applies through the real shared dispatcher. The final affected SQL regression set passed **177 checks**, including **40 Airtable tests**, in **21.704 seconds**. The maximum measured 100-row SQL batch in that run was **616.8ms**; a separate run measured 1.095s. This includes cancellation/revocation statistics repair and contention rescheduling. These are local measurements, not hosted latency or a 91,541-row production benchmark. Shared-machine load caused one earlier 2.78s spike, which was not reproduced in the final regression run. The release record must include any hosted acceptance result separately.

The failure-recovery follow-up passed a fresh chronological rebuild through `20261108093011` and **194 affected SQL checks** in **27.532 seconds**, including **13 additional recovery cases**. Its 1,000-price maximum SQL batch was **614.9ms**. These checks cover repeated progress between provider retries, replay budgeting, immediate sanitized failure, transient SQL errors, abandoned leases and partial-import statistics repair. Test sequence restarts are transactional so they do not affect later suites.

## Edge configuration and continuation

The existing `squad-jobs` deployment handles imports; no extra deployment is created. Configuration requires `SQUAD_AIRTABLE_ENABLED=true`, `SQUAD_AIRTABLE_ENVIRONMENT`, and `SQUAD_AIRTABLE_ISOLATED_ENVIRONMENT`, with both environment values matching the trusted Supabase project URL. Each of the custom and ready-stock sources has a separate `SQUAD_AIRTABLE_CUSTOM_BASE` / `SQUAD_AIRTABLE_CUSTOM_TOKEN` and `SQUAD_AIRTABLE_READY_STOCK_BASE` / `SQUAD_AIRTABLE_READY_STOCK_TOKEN`. Missing or mismatched configuration fails closed. These are deployment secrets, never client arguments or database-returned tokens.

The provider uses the fixed Airtable API origin, the 22 audited table IDs, 100-row pages, a 250ms minimum request-start interval per base, bounded response streams, and explicit network deadlines. HTTP429 persists a minimum30-second retry. Attachment downloads use only approved Airtable attachment hosts, carry no API credentials, and reject redirects. Expired links are refreshed by exact record and attachment identity. Immutable Storage conflicts require byte/hash/MIME verification before reuse. [Airtable rate limits](https://support.airtable.com/articles/7735693959-managing-api-call-limits-in-airtable), [expiring attachment URLs](https://support.airtable.com/articles/9671148410-airtable-attachment-url-behavior).

One lease advances up to80 checkpoints within a35-second work budget, then yields durably. The shared5-second demand pump resumes ready work without an idle HTTP request. Provider pacing remains active even when SQL checkpoints are fast; continuation is not restricted to one page per minute. The job consumer claims immediately before executing each job, so a slow provider does not spend the next job's attempts without starting it.

The Edge tests cover exact mappings/defaults, offset loops, malformed records, URL restrictions, rate limits, aborted queue waiters, expiring attachments, immutable upload verification, lost SQL-checkpoint responses, and bounded continuation. Real isolated-provider acceptance is still required before enabling the optional integration.
