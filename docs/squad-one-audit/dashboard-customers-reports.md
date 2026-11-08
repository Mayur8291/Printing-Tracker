# Scott dashboard Customers and Reports migration

Customers and all seven Reports use the shared Masters Supabase target and signed-in dashboard session. Source selection covers the directory, forms, price types, geography, details, report filters, summaries, performance KPIs and CSV. The migration is staging first. Selecting Supabase does not transfer business ownership: mirror mode keeps customer writes disabled unless the exact disposable administrator is in an expiring staging rehearsal.

## Data contract

`dashboard-customers-reports-contract.json` freezes every visible and exported report field and visible summary/card mapping from the actual UI registry. Database acceptance checks that every field has a projection. Historical source gaps remain null with an explanation in the report; an unavailable amount or stock value must not become zero.

| View | Row and calculation basis | Important source differences |
| --- | --- | --- |
| Customers | Nondeleted role 3 people, including distributor price types; complete versioned addresses and links | Role 10 dealers are separate people. Status means account enabled/disabled. Approval and onboarding remain separate. Customer type follows the selected price type. |
| Custom Orders | One item; stored quantity, item charges and tax; size quantities and current product master rates | Historical manufacturing cost snapshots are absent. `total_of`, `total_sn`, `total_stitching_cost`, `total_add_on_cost`, `fabric_used_kgs`, `fabric_cost`, `total_trims_cost`, `total_material_cost`, `total_cost` and `cogs` stay null. Current master rates are not represented as historical costs. |
| RMP Orders | One item containing its SKU/size mappings; gross = stored subtotal + item branding + validated tax | Exact decimal arithmetic replaces historical integer truncation. Ambiguous or incomplete SKU mappings are null and identified explicitly. |
| Tailor Reports | One marked item, including marks without an assigned tailor; completed size quantities across marks | Rates come from current base product/add-on masters. Missing rates and unpersisted payment status remain null. |
| Order Tracking | One order across its items; item subtotal, joined classes and explicit order state | Orders with multiple classes are not multiplied. An unpersisted Uniware failure reason stays null. |
| RMP Sales | Overview: one RMP order. Brand/class/coordinator tabs: shared domain sales aggregates | Overview subtotal and aggregate subtotal use the same stored facts. Customer Type Sales cards aggregate the complete filtered result before pagination and retain unknown values. Export retains columns hidden in the table. |
| Customer Performance | Independent A and B periods; all role 3 customers, including those without purchases | Growth is `(B-A)/A`; zero baseline gives null percentage. Last purchase uses lifetime order history. Unique customer KPIs use the same period boundaries. |
| Total Inventory | One active SKU; fresh complete warehouse availability and preceding 90 days of completed demand | Missing/stale/partial stock is unknown. Ambiguous or unmapped demand is unknown. Known zero demand gives zero DRR and null days of cover. |

Dates use Asia/Kolkata calendar boundaries and an exclusive end date. Current calendar periods stop after today in IST, with the actual cutoff shown in the report. Each period mode uses its own calendar boundaries; incomplete dates render an inline error without an RPC. Interactive periods are bounded to 366 days; item history remains fully pageable. Monetary JSON/CSV values remain decimal strings. CSV escaping preserves commas, quotes and newlines and neutralizes spreadsheet formulas in text cells.

## Authorization and writes

`canto_api.dashboard` is the only authenticated dashboard entry point. It verifies the live platform administrator and session, then opens a transaction-local private context. Private helpers are not available to anonymous, staff or Squad application callers. The dashboard principal retains its real Auth UUID; it is not mapped to a synthetic Squad administrator.

Customer save composes the existing person, address, links, commercial rules, review and account commands in one transaction. Version conflicts return `PT409`. A stable parent retry key and deterministic child keys make lost-response retries safe. Omitted fields are preserved; supported nullable fields can be cleared; required relationships, such as coordinator assignment, reject invalid clearing atomically. Existing addresses are retained when editing the primary address. Historical dependencies still prevent unsafe archival.

Account reconciliation and warehouse synchronization remain durable jobs with visible pending/error state. Completing the local save is not evidence that those external effects succeeded. Mirror mode never executes those business jobs. The unrelated warehouse/Uniware reconciliation release remains separate.

## Queries and exports

Filtering and sorting precede pagination. Counts and summaries cover the complete filtered result within the request snapshot. Pages carry a generation/edit revision; a changed revision rejects continuation. Queries do not reuse rows across users or environments. Multi-request downloads stop if the source or login changes, even when revisions happen to match.

Simultaneous identical reads share only their pending request, keyed by target, user, session token and request arguments. Settled results are immediately discarded. Customer mutations invalidate pending sharing before and after the write, so a refresh cannot attach to a read started before that mutation. Transient errors remain visible and Retry starts a new request.

Default report pages use bounded projections. Full-history RMP search and sorting select matching IDs before building returned rows; SKU predicates use the complete mapping when required, including boolean substring searches. Search uses the same boolean and timestamp representations as the returned JSON. Exact RMP count/totals have a private five-minute cache keyed by generation/edit revision and filters. Rows and authorization are always live. Reported timings distinguish cold work from this warm summary cache.

Small exports are bounded to 10,000 rows. Larger exports use actor-owned, idempotent, expiring jobs. The existing Edge worker captures at most 500 rows per lease, pins the revision, and exposes nothing until the complete result is captured. A source change between batches fails the export rather than mixing snapshots. Completed exports remain immutable for a day. Bounds are 250,000 rows, 256 MiB and ten requests per actor per hour. Browser CSV creation consumes batches into Blob parts, without keeping a second full row-object dataset.

Read-only export jobs work while Scott owns business writes. Their claim/execute path does not relax the business worker fence or increment the business edit revision. Existing scheduled cleanup removes expired exports. The UI retains the export request key across reloads and clears terminal or expired jobs before retrying.

## Advisor review

The raw security advisor report has 199 notices, versus 195 at the preceding backend release. Four new notices are reviewed explicitly in `implementation-evidence/staging-dashboard-security.json`: the three pure SQL invoker scalars retain inlining without a function-level search path setting, and the authenticated dispatcher is intentionally a guarded SECURITY DEFINER entry point. It has a fixed `pg_catalog` path and a restricted role without RLS bypass. The connector groups the raw notices into five categories; that category count is not the number of findings.

## Verification and release gates

- Local database tests cover real grants/RLS, live/revoked sessions, atomic rollback, retry keys, stale versions, archive dependencies, addresses, full-result summaries, all report fields, unknown values, export leases/batches/expiry/cleanup and the mirror write fence.
- Adapter tests cover all report routes, source isolation, period conversion, session/revision behavior, CSV precision and escaping, and resumed exports.
- `test_hosted_dashboard_reports.py` applies the migration inside a rolled-back staging transaction, profiles all views, checks source counts at the same watermark, and exercises deep pages/search/sorting. Evidence records cold/warm measurements and the summary cache explicitly.
- `test_hosted_dashboard_acceptance.py` uses disposable real Auth identities, real PostgREST, the browser and the deployed Edge worker. It blocks Scott/proxy/production requests, verifies all report screens, customer changes, CSV, large exports, authorization and revocation. Its private recovery checkpoint owns only its fixtures. Cleanup restores source hashes and acknowledges only its audited monotonic revision delta; it never rewinds the edit revision.
- The UI gate/build, complete Squad database suite, worker regression tests, migration isolation review and Supabase advisors are release checks. Evidence belongs in `implementation-evidence/staging-dashboard-*.json`.

Production promotion is a separate authorized release after staging acceptance. Keep the previous source option available for reads while validating production. After native business writes begin, a return to Scott requires explicit ownership reconciliation; a UI source switch alone is not a write rollback.

### Completed acceptance — 8 November 2026

The final run passed 2,126 database tests (including 53 dashboard tests), 26 adapter tests, 371 Edge tests, the UI build, source reconciliation and 18 hosted browser/API/worker checks. Every report and RMP tab worked with Scott/proxy/production requests blocked; zero unexpected API failures or browser exceptions occurred. The 13,201-row export completed without duplicates in 500-row batches, resumed in the browser and used 8,629,372 bytes of measured additional JS heap. Revoked sessions were rejected before JWT expiry. Cleanup restored source content, removed all three fixture Auth accounts, restored schedules and retained audited monotonic revisions.

Warm default HTTP p95 was 1,042 ms; the slowest cold default was 3,244 ms. Full-history searches/sorts take several seconds and are reported separately. Earlier browser timeouts led to reuse of identical pending requests; the final full browser run and focused HTTP probe passed. These measurements are staging evidence, not a production latency guarantee. See `implementation-evidence/staging-dashboard-verification.json` for the complete gate results, known warnings and source limitations.

Both backend environments are at migration 113, with the coordinated refresh release pinned to `codex/backend-parity-20261108-113`. No source ownership cutover was made by this work.

The frontend is deployed at <https://scottdashboard.vercel.app> from commit `34f2073` on `develop` (Vercel production deployment `7639459441`). The public alias serves the new `index-Dvz8lOpT.js` bundle. Its compiled UI passed 16 additional checks against disposable staging fixtures, including an edited customer CSV, all reports, retries and session revocation, with production/Scott requests blocked. Final cleanup restored the source and removed the fixtures. The 55-request warm sample measured p95 1,584 ms. An earlier 22-request sample measured 2,010 ms and missed the 2-second target; that run is retained in `staging-dashboard-deployed-latency-miss.json`. No application or backend changes were made between those deployed samples.

Vercel currently treats `develop` as production for this project, despite older Netlify documentation describing it as staging. Publish reviewed Git revisions deliberately; the frozen backend refresh branch is separate and must not move.

## Commands

```sh
SQUAD_TEST_DATABASE=squad_test_dashboard SQUAD_TEST_MIGRATION_THROUGH=20261108154028 tools/canto-sync/.venv/bin/python tools/squad/local_db.py rebuild
SQUAD_TEST_DATABASE=squad_test_dashboard tools/canto-sync/.venv/bin/python -m unittest discover -s tools/squad
node --test tools/squad/test_dashboard_adapter.mjs
npm run check:ui
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_dashboard_reports.py
tools/canto-sync/.venv/bin/python tools/squad/deploy_quiescent.py --through 20261108154028
tools/canto-sync/.venv/bin/python tools/squad/deploy_quiescent.py --through 20261108154028 --apply
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_dashboard_acceptance.py
```

The hosted browser command expects the admin Vite server at `http://127.0.0.1:5173` (`npm run dev:staging`) and Chrome; set `CHROME_PATH` if Chrome is installed elsewhere. Synthetic diagnostics and progress are written to `/tmp/dashboard-browser-progress.log`; credentials remain in memory.

The optional `--rpc-probe` runs repeated real authenticated no-match search/CSV-size requests separately and writes `staging-dashboard-http-probe.json`. It is diagnostic evidence, not a substitute for the full browser/worker acceptance run.

Use `--ui-url https://scottdashboard.vercel.app` for the compiled deployment checks. This still targets staging fixtures and blocks production APIs. Module-level large-export memory checks remain in the local-Vite run; the deployed run exercises actual customer/report Export buttons. Evidence is written to `staging-dashboard-deployed-browser.json`.

If a hosted fixture run is interrupted, inspect its exact private checkpoint and run the acceptance script with `--recover`. Never remove a foreign checkpoint or overwrite its scope. Preserve audit/command records and restore the recorded schedule states.
