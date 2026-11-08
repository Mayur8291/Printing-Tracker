# Outbound Airtable reporting

Implemented in `20261108085643_squad_airtable_reports.sql` and `squad-jobs/airtable-reports.ts`. This is the optional reporting mirror in INTEGRATE.05. Source data remains in Supabase. The inbound master import is a separate workflow.

## Source coverage

The approved local Rails develop snapshot contains four report services in `app/services/airtable/reports`. The exact 82 source field names are preserved in `squad-jobs/airtable-reports-contracts.json` and checked by tests:

| Source service | Projection | Fields | Source data |
| --- | --- | ---: | --- |
| `create_user_service.rb` | customer | 21 | Customer identity, coordinator/dealer, approval, zone, price group, GST and primary address |
| `create_or_update_order_report_service.rb` | custom_order | 29 | Order/item, product and add-on costs, factory, quantities, delivery, latest customer rating |
| `create_or_update_rmp_order_report_service.rb` | rmp_order | 27 | Order/item, SKU/class/color/size, delivery, customer, price/tax totals and rating |
| `fetch_order_report_service.rb` | tailor_pick | 5 | Selected completed quantity, size breakup, picking time, tailor and parent item report |

Order placement, editing, status, production/dispatch, rating and relevant customer/profile/address/relationship events enqueue reports. Order/item fanout uses pages of 50 and a fixed initial maximum ID. A backorder parent with `placement_command_key` does not duplicate its already emitted `orders.placed` child. Manual refresh is available for order, item, customer and tailor-pick IDs, at most 100 unique IDs per request. Staff-only events do not create customer report failures.

Report projections preserve phone strings and persisted monetary cents. The old RMP service truncated several monetary fields with Ruby `to_i`; the new report intentionally preserves their decimal values. Timestamp strings are explicit UTC. Positive RMP size quantities only are reported. Soft-deleted orders and moderated ratings are excluded. Imported `airtable_id` values and legacy destination IDs are never adopted as write targets.

The Rails feature flag sometimes fails open and was not consistently applied to reporting callers. The new report feature defaults off at both database and worker configuration levels, consistent with optional reporting after cutover. Enabling it requires deliberate configuration.

## Worker and API contracts

Existing `squad-jobs` handler: `airtable_report`; factory `airtableReportWorker(rpc, reportsFromEnvironment(get))`. No new Edge function is needed. Service-only RPCs are `squad_airtable_report_prepare(uuid,uuid)` and `squad_airtable_report_finish(uuid,uuid,jsonb)`.

Authenticated administrator/platform RPCs are `v1_airtable_reports_status()`, `v1_airtable_reports_configure(enabled,expected_version,idempotency_key)` and `v1_airtable_reports_request(family,ids,idempotency_key)`. They preserve command idempotency, optimistic settings versions and mirror/generation gates. Clients supply entity IDs, never provider URLs, credentials, table IDs or arbitrary fields.

Prepare returns a frozen projection with environment, kind, entity ID, stable key, revision, fields and optional parent key. Enumeration and terminal states return without provider HTTP. Finish records confirmed provider evidence or a durable retry, rejection or reconciliation state. Evidence must match the exact frozen key, revision and fields. Current actor access is checked before each attempt. A warehouse callback can only report its exact source order under the current worker lease and warehouse configuration, without impersonating a user.

## Isolated provider configuration

Configure a separate reporting base for each environment, with four distinct tables. Both `Squad Key` and `Squad Revision` must be writable single-line text fields in each table. All source fields must exist. `Jobsheet Number` in the tailor table must be a record-link field targeting the actual parent table; incompatible custom/RMP link schemas fail explicitly rather than silently linking the wrong record. A single legacy tailor table may need an explicit schema adjustment to support the required parent families before activation.

Required worker secrets/settings:

```
SQUAD_AIRTABLE_REPORTS_ENABLED=true
SQUAD_AIRTABLE_REPORTS_ENVIRONMENT=staging|production
SQUAD_AIRTABLE_REPORTS_ISOLATED_ENVIRONMENT=<same environment>
SQUAD_AIRTABLE_REPORTS_BASE=<isolated app ID>
SQUAD_AIRTABLE_REPORTS_TOKEN=<private PAT>
SQUAD_AIRTABLE_REPORTS_CUSTOMER_TABLE=<table ID>
SQUAD_AIRTABLE_REPORTS_CUSTOM_TABLE=<table ID>
SQUAD_AIRTABLE_REPORTS_RMP_TABLE=<table ID>
SQUAD_AIRTABLE_REPORTS_TAILOR_TABLE=<table ID>
```

The configured `SUPABASE_URL` must match the known environment. The PAT needs records read/write and base-schema read for the isolated base. Missing or mismatched configuration fails closed. No legacy/shared production base is a default. No provider writes or hosted acceptance were performed in this lane; isolated credentials and table schema remain activation prerequisites.

## Delivery, safety and limits

The only provider origin is `https://api.airtable.com`. Redirects are refused. Metadata verifies merge fields and source columns, cached for 60 seconds. One database-controlled active report intent at a time and 250 ms request spacing bound the base request rate. Each attempt has a 35-second overall deadline, a 10-second request deadline and a 2 MiB response limit. Projections have a 128 KiB database limit. Queued enumeration remains paginated.

Stable keys are `environment:kind:legacy_id`; revisions are generation plus outbox sequence. A read precedes every write. An exact existing projection completes without another write. Otherwise `performUpsert` merges on `Squad Key`, with typecasting disabled, followed by a read-back check. Duplicate merge keys, wrong parent links or mismatched evidence require repair. Confirmed receipts survive a later configuration disable. An exhausted or abandoned uncertain provider attempt fences newer writes for the same entity until reconciled.

Provider timeouts after mutation starts are explicitly uncertain. Retries read first, retain the original frozen projection and never claim exactly-once HTTP delivery. Airtable has no general compare-and-swap contract here: these are eventual report mirrors, requiring a dedicated base with this integration as its writer. External concurrent edits or arbitrarily delayed provider requests are not covered by a false transactional guarantee. Five attempts are bounded; 429 retries wait at least 30 seconds. Administrative job retry after repairing configuration/data reads the stable key again.

The provider behavior follows Airtable's [update-multiple-records contract](https://airtable.com/developers/web/api/update-multiple-records), [base-schema API](https://airtable.com/developers/web/api/get-base-schema) and [rate limits](https://airtable.com/developers/web/api/rate-limits): zero merge matches create, one updates, multiple matches fail; the base limit is five requests per second and 429 requires a 30-second pause.

## Verification

Local synthetic SQL: 24 focused report tests and 242 passing tests across reports, business mail, documents, notifications, accounts and account flows. Edge: 15 focused report tests; the complete current jobs suite passed 178 tests. Tests cover all four field mappings, decimals, idempotency, frozen retry, duplicate/conflicting provider records, lost accepted response/read-back, partial responses, bounded streams, current authority/reassignment, current-generation leases, exact-order system capability, queue serialization, dead-letter fencing, mirror mode, configuration defaults and bounded fanout. No test sends real email or writes to Airtable.

A 25-call synthetic customer-projection prepare measurement was median 1.95 ms, p95 2.84 ms, maximum 4.22 ms locally. This measures database projection overhead only; it is not a hosted/provider latency or production load claim.
