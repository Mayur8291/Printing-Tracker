# Document service — iteration 26

Status: implemented and tested on staging. Three shared RPCs (`v1_document_request`, `v1_documents_list`, `v1_document_get`), one new route in the existing `squad-account` Edge (`documents/download`), and render/mail handlers in the existing `squad-jobs` Edge. No additional deployment or external compute service.

## Source behavior and variations

| Document | Authority | Preserved behavior / explicit corrections |
|---|---|---|
| Catalogue | Existing `documents` capability, including team feature 3.2; current brand scope | Category–brand–class grouping, include/exclude selection, parent category, shared customer price engine, fixed/percentage markup, company/bank/address/remarks/terms, stock flag, download/email and three-day expiry. Decimal prices stay decimal. Internal cost values formerly appended to names are omitted. Unknown warehouse stock is explicitly unavailable. |
| Delivery challan | Factory manager, dispatch incharge, dealer; current item scope and matching dispatch | Product/base-product names and verified image; customer/GST/destination, size quantities and proportional taxes. Quantities come from the selected dispatch's records, correcting the old template's use of later cumulative dispatch totals. Missing/invalid quantity links fail for reconciliation. Immutable destination receipt is preferred; imported records without one explicitly identify the current-order fallback. Amounts reflect capture-time item values, not a reconstructed historical invoice. |
| Weekly tailor work/payment | Admin, production coordinator, factory manager within current factory | Saturday-start Kolkata assignment week, optional subtailor team, current completed quantities, current base plus all linked add-on OF/SN rates. Shared earnings engine runs once; no repeated page-total queries. Invalid rates/history remain reconciliation-required, never zero wage. |

Evidence sources: Rails `catalogue_controller.rb`, `GenerateCataloguePdfService`, `catalogue/pdf3`, `CreateDispatchedQuantitiesStatsService`, `dispatch_incharges/delivery_chalan`, `GenerateTailorsPaymentPdf`, `TailorWeeklyStatsService`, `ClearOldCataloguesService`, plus approved local Flutter `develop` catalogue service. The old nested exclusion request has been replaced by explicit include/exclude arrays. Imported catalogue history remains available via `legacy:true`, preserving owner/status/media references; it is not regenerated or emailed during refresh.

## Execution and security

Requests use the existing idempotency, audit, write/refresh fence and outbox. Private `sa_domain.documents` stores the immutable render input, hash, compact authority scope, progress and output metadata. This is operational state, not another business-schema copy. Capture occurs on the first worker preparation; edits after capture do not reprice a retry. Current account, role, capability, brand/item scope and source generation are checked on preparation, publication, email preparation and every download grant. Existing 120-second signed downloads can remain usable until their TTL expires.

Rendering uses pinned pdf-lib/fontkit and licensed embedded Noto Sans/Devanagari fonts; no HTML/browser execution or arbitrary URL fetching. Fonts are checksum-pinned with an OFL license and reproducible generator. Verified `canto-media` inventory objects are read only from fixed canonical paths and checked against their content hash. Missing old-server images render an explicit placeholder; staging never borrows production media. Unsupported fonts/media fail visibly instead of silently corrupting names.

The worker renders up to 100 text rows, or ten rows for an image-bearing catalogue, per durable step. Only one render can be claimed per invocation. Parts use deterministic private paths; an upload retry verifies existing bytes rather than overwriting them. Final assembly retains all pages and reattaches terms, since copying PDF pages alone loses attachments. Leases, checkpoints and generation checks survive restarts. A demand-driven five-second Cron tick invokes work only when eligible document jobs exist; the existing minute pump remains. Both are paused in mirror mode. [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart).

Private `squad-documents` has no client table or broad Storage grants. The account Edge first forwards the caller JWT to the scoped grant RPC, then signs only the returned fixed-bucket document path. Missing/foreign/expired documents and unauthenticated callers are denied. No request accepts recipient email, Storage path, worker actor ID or arbitrary URL.

Email resolves the current Auth email, uses TLS and the staging recipient allowlist, and has an independent delivery state. PDFs up to 10 MB are attached; larger outputs send a notice directing the user to authenticated document history. The future UI must supply that history/download view. Stable Message-ID and durable bounded retries provide at-least-once delivery; SMTP ambiguity can still duplicate a message. Provider acceptance is not proof of inbox receipt. Failed email does not remove a valid download.

Cleanup deletes completed parts, expired catalogue outputs and abandoned terminal outputs after a delay. Current-generation operational PDFs are retained. Source refresh invalidates old-generation documents and pending mail, and makes their generated files eligible for cleanup. Cleanup acknowledgments follow successful Storage deletion; queues advance past already processed records. Imported files in `canto-media` are never deleted by this cleanup.

Administrators can retry exhausted transient Storage/provider failures during the first 23 hours, while retaining captured input and completed parts. Older jobs require a fresh document request, avoiding a race with 24-hour abandoned-output cleanup. Retrying mail resets only delivery state, not the ready PDF.

## Explicit limits

- Twenty requests per actor per hour; request 64 KB, immutable snapshot 8 MB.
- 20,000 catalogue variant rows / 2,000 product groups; weekly report 2,000 work rows.
- Inventory-selected catalogue/product images at most 1 MB each; PNG inflation at most two megapixels; 24 MB of distinct catalogue input images. Larger or unsupported inputs fail with a visible bounded-work error.
- Up to 200 PDF parts, 48 MB of parts at assembly, 5,000 pages and 64 MB final output. Repeated images across parts can reach the assembly limit earlier than the source-image limit; reduce selection if the job reports `RENDER_LIMIT`.
- Terms attachment at most 5 MB, verified PDF/PNG/JPEG/plain text. The original file is embedded, not concatenated or rewritten. A reader with attachment support is needed.
- Final mobile/web UI, physical-device download behavior, provider stock availability and general business-event mail remain later gates.

## Acceptance

- [Hosted actual SDK journey](implementation-evidence/staging-documents-sdk.json): 101 migrated classes, 35 pages, two parts, one assembled private PDF; checksum/download/denial checks; controlled Mailinator provider acceptance. Staging catalogue images are missing in the source inventory and were reported as unavailable.
- [Hosted image journey](implementation-evidence/staging-documents-images.json): eleven synthetic 1.96-megapixel PNGs, two parts, five pages, real capture/render/assembly/download through deployed Edges; no email. Exact-owned fixture catalogue/media records and files removed. No production media used.
- [Automatic Cron journey](implementation-evidence/staging-documents-cron.json): a real shared-SDK request completed through Vault-backed Supabase Cron and the deployed worker, with no manual worker invocation or email. The resulting private PDF passed the same checksum and download-denial checks.
- [Hosted DB performance](implementation-evidence/staging-documents-performance.json): ten warm measured executions after two warmups. Request 8.956 ms p95, 101-class capture 216.843 ms, list-25 50.413 ms, list-100 193.600 ms, detail 3.766 ms, download grant 2.476 ms. History included 100 own and 2,000 unrelated documents. SQL fixtures and sequence changes rolled back. This is not mixed-load capacity certification.
- PDF samples for all three templates were rasterized and inspected; Unicode layout, product images, page assembly and embedded terms have dedicated checks. Local 2,000-row render and 680-page assembly benchmarks informed the resumable design, but are not hosted maximum-size acceptance.
- Final comprehensive persona/load/refresh/cutover acceptance remains a separate milestone. RPC-count coverage does not imply those gates have passed.
