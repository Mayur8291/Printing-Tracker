# Commerce / people implementation evidence

Status: implemented locally; real browser staging journeys authored and awaiting parent harness execution. Component fixtures are contract checks, not proof of hosted behavior. No release or production mutation was performed by this lane.

## Owned shared flows

| Area | Implemented UI | Key preserved rules |
|---|---|---|
| People | Scoped directory, role/status/search + advanced filters, create/edit, onboarding review, relationships, commercial and dealer rules, capability management, factory/team creation, coordinator requests/reassignment | Tailor/Subtailor remain managed subjects with no login; parent product permission gates children; exact relationship selectors; role-specific commands; stable command retry IDs and versions |
| Addresses | Shared customer/dealer profile, People detail and checkout address book | Used order addresses only change primary status; create/edit/remove scoped to owner; quote invalidated after address save |
| Account closure | Customer-only reauthentication and explicit confirmation | Real recent password AMR/session, exact own account only, atomic source soft-delete/mapping block, Auth session/refresh revocation, uncertain retry receipt; no arbitrary target ID |
| Catalogue | Custom/base products, RMP, saved designs, bounded filters and campaign destination | Customer context governs price/availability; PC reference browsing does not claim configuration or RMP access |
| Configuration | Parts/add-ons/colors, exact linked sizes, custom colors, sample/bulk quantities, reusable designs, rename, branding/artwork, composed SVG preview | Canonical sizes are not RMP sizes; missing canonical mapping resolved through fenced command; server calculates prices; authorized grants only; SVG preview shared UI implementation |
| Stock availability | Customer/SC linked dealer and Dealer own-product availability | Customer display percentage calculated by server; no physical ledger exposed or frontend inventory calculation |
| Quotes / placement | Custom, RMP, mixed, SC price override, readonly costing, address selection, all split-order acknowledgements | Configure-only custom quote rights do not imply RMP quote/order rights; accepted quote/version, 1-based line settings, decimal amounts, source tax rules |
| Orders | Cursor list, advanced filters, bounded detail children, priority/due/payment/cancel/delete/complete/destination actions, feedback | Precise actor differences; pending provider work not represented as completed; destination is enum string; operational DTOs do not invent commercial amounts |
| Amendments | Explicit preserve/full-replacement strategy, complete source prefill, quantity edits, preserved/changed/new markings, removed-line count, final quote | Original custom preset/canonical sizes/sample plan/comments/design versions retained; size type resolved by exact unique historical name; missing legacy SKU receipt cannot be inferred; prior paid amount preserved by default |
| Manual payment | Source bank instructions, production QR/contact, local acknowledgement | Staging has no active payment/contact link or QR; no invented payment-state write |

## Source-discovered backend gaps closed

- `20261108180809_squad_customer_self_closure.sql`: own customer closure, real password freshness, session revocation and durable retry.
- `20261108181835_squad_commerce_display_context.sql`: minimal authorized dealer/SC contact and stock names; canonical size namespace.
- `20261108183714_squad_order_amendment_context.sql`: original item `size_type` NAME projection. Source items do not store a size type ID; tests explicitly preserve this distinction.

All three are frozen for root review/release. Other agents' session/configuration, preview and detail changes are consumed through shared contracts.

## Tests and acceptance boundaries

- `web-commerce-model.test.mjs`: 8 model cases.
- `web-commerce-amendment.test.mjs`: 6 complete-prefill / unsafe-reconstruction cases.
- `web-commerce-browser.mjs`: 12 actual rendered component contract cases.
- `web-commerce-closure-browser.mjs`: 4 closure interaction/retry cases.
- `test_self_closure.py`: 17 isolated SQL cases, plus existing accounts/people regressions.
- `test_commerce_display_context.py`: 6 isolated SQL cases, plus stock24 regression.
- `test_web_amendment_context.py`: 6 isolated SQL cases, including source size name, foreign scope, existing owned design chain and foreign design rejection.
- Shared/mobile typecheck passes.

Real hosted acceptance is authored in `web-commerce-hosted-journey.mjs`:

- `runJourney(ctx)`: Customer address; SC review/relationships; Customer custom + RMP placement; SC deposit/priority; SC mixed placement; commercial scope read oracles.
- `createCustomOrder(ctx,options)`: shared real UI helper for Operations lane.
- `runAmendmentJourney(ctx)`: separate SC order,100 deposit, quantity2→3, original product/size type/sizes/notes retained, final1575 quote, previous payment preserved.

Parent harness owns disposable identities, exact fixture manifest, command journaling, write fences, paused provider workers and cleanup. No existing real customers, provider messages, or production data are part of these journeys. Uniware live acceptance remains the user's explicitly deferred dependency.

## Important explicit limitations

- Legacy RMP rows without accepted SKU receipts require an intentional complete replacement. The UI does not claim sizes identify the original SKUs.
- Unavailable historical design media, ambiguous/missing original size type and truncated source notes stop automatic prefill; the existing order stays intact.
- Hosted business journey success, generation refresh behavior and production rollout remain pending parent acceptance, not marked complete by local fixtures.

## Current acceptance closure map (local checkpoint, 9 November 2026)

The older counts above describe the initial slice. The current component suite has **28 passing cases**, model suite21, and the latest grouped source regressions95. `docs/squad-one-web/evidence/commerce-source-controls-local.json` records the exact scope. Frozen additive controls126/127/128/132/134/137 include reference-image comments, managed-customer account status, indexed sort, managed photo/contact/context, completed priority and worker-context intersection. This is built/local-tested evidence; it does not advance the weighted20% commerce acceptance milestone by itself.

| Acceptance requirement | Actual adapter / evidence | Remaining gate |
|---|---|---|
| Customer custom/RMP and SC mixed placement, exact tax/price, money redaction and foreign customer denial | Existing `commerce` module | Parent's successful combined run and exact cleanup receipt |
| Dealer custom purchase and customer demand/receipt/fulfillment | Operations module consumes shared browser placement helper | Parent's connected operations acceptance; provider execution stays separate |
| Dealer own RMP and mixed purchase | `commerce-controls` uses existing exact-owned Dealer/address;3 RMP pieces=252 and2custom+3RMP=1302; typed children, queued integration, PC money redaction and foreign Customer denial | Parent hosted run and cleanup; no provider completion claim |
| Actual small-fixture keyset continuation | `commerce-controls` authenticated SDK reads with limit1 compared with same scoped bounded30-row reference; every ID unique and exact observed count reported | Hosted proof; separately labelled from browser sort and local10k benchmark, no bulk hosted insert or SLA claim |
| Source-preserving quantity amendment with existing deposit | Explicit `amendment` module | Real hosted run; current fixture supports custom preservation only, legacy RMP reconstruction remains intentionally blocked |
| SC commercial override, exact downstream total | Optional `commerce-controls` module: unit500→450;2 pieces; tax-inclusive945 | Real hosted run |
| Lost successful response and retry without duplicate application | `browser-lost-response.mjs` loses only an actual HTTP2xx response after commit; UI repeats unchanged intent and durable version stays fixed | Local actual HTTP+Chrome mechanism passed; hosted module must pass against real RPC |
| Due date/destination and selected-customer order sort | `commerce-controls`: exact persisted browser timestamp/mode; People→Orders fixed customer predicate with server due sort | Hosted request/result proof; large-list keyset performance remains separate SQL benchmark evidence |
| Manual payment acknowledgement | `commerce-controls`: no version/payment change; no staging external action or QR | Hosted read-before/read-after proof; never make a real payment as part of acceptance |
| Reasoned Admin exception closure, completed SC priority, Customer feedback create/edit and source choice chips | `commerce-controls`, new isolated custom order and exact rating recipient | Hosted proof; actual manufacturing-derived completion is independently tested in Operations |
| Custom cancellation | `commerce-controls`, second isolated custom order, SC and owning Customer see CANCELLED | Hosted proof; RMP/mixed cancellation retains queued provider semantics and cannot be claimed fulfilled without Uniware |
| SC contact on order; managed People photo and contextual controls |28 component cases plus independent styled People review; shared existing scoped person/media contracts | Hosted managed photo/relationship variants remain in People/media acceptance, not silently counted as commerce completion |
| Configurator artwork, brandings, preset references/comments/mockup and RMP gallery/share | Existing read-only artwork acceptance plus dedicated `catalogue-media` harness and UI-agent tests | Current authorized-media mutation/download acceptance and real source variation coverage |

The optional module is selected as `SQUAD_WEB_JOURNEYS=commerce-controls` or included in a reviewed combined list. Default modules are unchanged. It does not edit fixture plans or release SQL. Its order, preset, quote and rating IDs are recorded through the normal ownership journal; every mutation uses the UI's already-journaled UUID. The intentionally lost response is not a fabricated API result. The parent still verifies the command/audit revision count, exact source graph cleanup, retained audits and unaffected external activity.

Still do not claim coverage for all persona/type combinations solely from one successful Customer/SC journey: the Dealer RMP/mixed adapter must also pass, and provider-dependent edit/cancel retains its separate deferred disposition. Likewise a UI list that returns one scoped fixture is not a hosted pagination/performance benchmark. Parent owns final workflow/role ledger and milestone scoring.

## Browser API performance collection

The shared hosted browser harness now passively collects `api_timings` per numeric persona, known SDK RPC/fixed Edge path, HTTP status and outcome. Timings end only at the browser's complete response-body event. HTTP errors are separate from successes; failed, cancelled and unfinished requests receive counts without successful latency samples. The report gives nearest-rank p50/p95/max, observed/captured/dropped counts and explicit partial status. It retains at most5000 observations and128 concurrent requests. Contract paths are an allowlist; Auth token routes, Storage URLs, query strings, headers, payloads and credentials are excluded.

These are **mixed cold/warm** observations: cache state, reused connections and Edge warmth are uncontrolled. They include network/gateway/server/interception time and are neither isolated SQL timings nor render completion. Each contract's sample count must accompany any percentile claim. A successful small-fixture journey does not establish a large-volume SLA. `browser-contract-timings.test.mjs` passes with real HTTP/Chrome delayed body,403, aborted and truncated responses, plus bound/privacy/nearest-rank checks. Root must execute the hosted journey before any hosted latency result exists.

## Final bounded commercial rerun checklist (prefix139)

Select `commerce-controls,amendment,read-performance` on one fresh disposable business fixture. These modules use the planned canonical catalogue/customer/address graph and create their own order IDs; they do not depend on the main `commerce` module or production/stock modules. Keep workers paused and preserve the ordinary command journal and exact cleanup. This is the affected commercial subset, not a reason to repeat guest or manufacturing acceptance.

- **Controls:** SC override450 × quantity2 produces945 including fixture tax. The lost-success priority retry must reuse the entire command payload/key/version and leave exactly one durable version advance. Due/destination checks read back entered values; payment instructions acknowledge locally without changing order/version or enabling staging QR/contact. Admin reasoned completion permits retained completed-priority control and Customer→SC feedback create/edit; separate custom cancellation remains provider-free.
- **Dealer purchases:** Pure RMP quantity3 totals252, mixed quantity5 totals1302; each has one owned order and correct custom/RMP child types, and remains provider queued. PC must receive `not_found` for pure RMP. For mixed work, PC may see the source-authorized selling total1302, but must not receive `paid_amount` or `payment_status`. Foreign Customer access remains denied. This distinction is covered by `test_web_dealer_commercial_scope.py`; the failed earlier hosted assertion was stale, not a permission defect.
- **Continuation:** The explicit SDK-only page-size1 due-sort walk is bounded to31 pages/30 owned rows, rejects repeated cursors/duplicates, and matches the same bounded list. It is separately labelled from the actual browser sort control; it is not a hosted large-volume claim.
- **Amendment:** New SC custom order starts with one item/two pieces, actual notes, original product and canonical size context. Deposit100 survives quantity2→3 amendment, final total1575, same product/size type/size IDs/item and order notes; one item/one quantity row remains. The outcome is applied for this non-provider custom order. No legacy RMP reconstruction or pending-provider mutation is inferred.
- **Read performance:** Exactly24 observed browser reads: first observation plus five repeats each for own identity, own profile, own pending orders(limit30) and exact fixture catalogue search(limit18, one matching row). Capture complete-body durations and actual row/status validation. Report repeated-route p95 against2000ms without claiming controlled database/Edge warmth, render timing, enterprise load or a universal SLA. Any measured miss remains visible.
- **Closure:** Parent verifies accepted module results, no unexpected browser/network errors, exact source restoration, retained audit and restored schedules. An unsuccessful later module preserves earlier partial proof but does not promote the complete20%-weight commerce milestone.

The shared navigation helper currently retains its existing behavior during the parent's active freeze. Exact-route diagnostics introduced in the Operations adapter are a separate browser-harness improvement; no unproven claim that they fix the earlier delayed route is made here.
