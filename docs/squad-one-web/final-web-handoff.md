# Squad One web release handoff

The web application is live at [scottdashboard.vercel.app](https://scottdashboard.vercel.app). **All fixed internal implementation and release criteria are complete (100%).** The tested source is `93f8f66a48885edcd6150853189fe4c7529639fa`.

**Environment and writes:** the Vercel deployment lane is Production, but the verified default Supabase environment remains **staging**. Both application backends match at **141 migrations**. Normal business writes remain mirror-gated; this release did not activate native production ownership or refresh data. Controlled staging rehearsals tested the command flows separately.

The [115-row ledger](release-execution-ledger.csv) records implementation and scoped evidence: **113 retained rows, two explicit exclusions, 100 rows with hosted browser workflow evidence**. Final deployed checks verify **11 persona logins, 102 authorized read routes and 34 keyboard/core checks**, plus **16 Tracker checks**. A read check is not a replay of every command or role variation.

| Actor | Accepted scoped behavior | Final deployed read outcome |
|---|---|---|
| Admin | Customer/staff/grants, responsibilities/targets, moderation, report controls, reasoned exception completion, stock repair and operator read states passed scoped staging journeys. | Login; 15 routes; 4 core checks |
| Sales Coordinator | Customer routing; custom/RMP/mixed configuration, quotes, price override, deposit, amendment, cancellation and feedback; preset rename/reopen and ownership denials. | Login; 12 routes; 3 core checks |
| Production Coordinator | Factory and staff management; factory/worker assignment, criteria/cost, progress and assigned-factory feedback; payment information withheld. | Login; 13 routes; 3 core checks |
| Customer | Existing session/own scope; registration, confirmation, recovery/invitation and closure branches; custom/RMP ordering, coordinator request, catalogue/reference/branding/profile media and exact downloads. | Login; 7 routes; 3 core checks |
| Factory Manager | Cutter and tailor/subtailor allocation, criteria, inspection/pickup rollups, workforce create/edit/archive with retained history, work/earnings/leaderboard and weekly PDF. | Login; 9 routes; 3 core checks |
| Cutting Master | Assigned sizes/sample, partial cutting, completion/history and scoped operational projection within the connected chain. | Login; 5 routes; 3 core checks |
| Inspector | Current-item queue, coupled completion/pickup, attribution and inspection history retained after workforce archive. | Login; 6 routes; 3 core checks |
| Dispatch Incharge | Destination/partial dispatch, remaining/completed quantities and exact delivery-challan generation/download. | Login; 7 routes; 3 core checks |
| Dealer | Own RMP/mixed purchases, demand/receipt, FIFO partial dispatch, procurement re-quote/backorder linkage and residual stock; denied Admin reconciliation authority. | Login; 9 routes; 3 core checks |
| Job Worker | Assigned work, due commitment/reason and six stages; independent browse/configure/PDF/promotions grants, no-grants and live revocation states. | Login; 11 routes; 3 core checks |
| Assistant Worker / Team | Personal and order-linked tasks, assigned responsibilities, independent product/PDF/promotion grants and revocation; no invented order-placement rights. | Login; 8 routes; 3 core checks |
| Tailor subject | Managed allocation/completion/pickup, work/earnings/leaderboard attribution and historical visibility through authorized operator sessions. No standalone login. | Managed subject; no separate login |
| SubTailor subject | Parent/team relationship, allocation/completion and retained attribution through managed create/edit/archive and report flows. No standalone login. | Managed subject; no separate login |
| Tracker staff/admin | Existing separate staff gateway: live Admin 10 / Viewer 6 read checks passed. Prior one-Color create/edit/archive and mirror transfer controls accepted separately; live smoke did not execute CRUD, refresh or realtime. | Admin 10 / Viewer 6 checks |

The [machine-readable handoff](final-web-handoff.json) binds every actor to exact evidence, release/backend hashes, cleanup and rollback. The [persona receipt](evidence/release-141-93f8f66-personas.json) combines eight complete roles from the first run with three complete roles from the same-build follow-up. The original failures are preserved; neither run is relabeled as a single all-persona pass.

All **46 generated JavaScript/CSS assets** match the accepted local build. Six anonymous/deep-link cases passed. Live Tracker Admin/Viewer reads passed with 65 successful responses and exact two-account cleanup; automatic presence/stale-order writes were blocked. The protected immutable Vercel URL prevented direct inspection, so deployment-to-commit provenance uses the verified GitHub integration while public asset bytes are independently bound.

Firefox and WebKit staging matrices passed. Native Safari passed Customer login, reload, date validation/reset, normal exact-byte download and logout; the final dialog focus correction separately passed native pointer, keyboard and Close paths. These are scoped browser/accessibility checks, not WCAG certification or mobile-app acceptance.

The bounded staging API sample passed its 2,000 ms target with observed repeated p95 around 171–190 ms across 24 requests. It is a small uncontrolled-warm sample, not a field or concurrent-load SLA. The [staging incident receipt](evidence/staging-recovery-141.json) records the later unhealthy-service interruption, one restart, exact cleanup and successful follow-up. Post-test Auth, REST and database checks were healthy; the root cause was not isolated and capacity follow-up remains separate.

**External conditions remain explicit:** Uniware is user-deferred; missing staging source media stays reported with no production fallback; native import/worker execution and production ownership require their separate release gates. The managed `pg_net` patch difference remains outside application parity. Human UAT and real production-user acceptance have not been claimed complete.

Both persona fixture cleanups restored their exact source/staff/schedule state with zero business commands or revision changes. Prior command rehearsals retain their own cleanup/audit receipts. Rollback uses the [previous frontend revision](evidence/release-141-93f8f66-rollback.json); it must not reverse compatible backend migrations or restore a snapshot. This final documentation is a separate feature-branch commit and does not change the tested live source.
