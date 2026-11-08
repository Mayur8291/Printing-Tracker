# Persona financial projections and historical policy review

Migration `20261108090719_squad_persona_finance_parity.sql` is frozen for review. Fourteen new tests pass; the combined new journey, order-detail, tailor-earnings, work-report and sales-report suites pass **130 tests** locally. This lane made no hosted or production change.

## Confirmed projection gap and correction

The user-approved Flutter source is local `origin/develop`, immutable commit `5d55d9461af18b94a867dce07dee7c4b76f1e51f`. The checkout itself is `main`; review used `git show origin/develop:...`, without switching or modifying the legacy app.

- `lib/app/global_constants.dart:136–148` includes ProductionCoordinator in `allowedToSeePrice` and `allowedToSeeTotalOrderValue`.
- `lib/app/utils.dart:424–429` implements that explicit role list.
- `lib/ui/widgets/order_widget.dart:178–203`, `sc_order_widget.dart:195–208`, and `fabric_detail_widget.dart:250–292` use that selling-price policy.
- `lib/ui/widgets/job_worker_price_dialog.dart:116–139` shows the current product unit selling price when a worker rate is assigned.
- `lib/app/global_constants.dart:230–235` defines a separate payment-visibility list which excludes ProductionCoordinator.

The initial Supabase projections incorrectly omitted PC selling amounts along with payment fields. The new migration separates those concerns. A private immutable shared predicate supplies selling visibility to order, item, accepted-variant and dashboard projections. PC receives the already-scoped selling amounts needed for the original workflow. Payment status and paid amounts remain limited to the previous Admin/SC/Customer/Dealer set. Worker cost visibility, quote/edit/payment write authority, factory relationships and every row policy stay unchanged. Existing source-authorized dealer behavior remains intact.

Tests call the actual public RPCs. They verify PC selling totals on list/detail/dashboard and accepted variants; payment redaction; continued denial of PC payment recording, quoting and pure-RMP orders; customer/SC payments; factory/inspector/dispatch/cutter redaction; worker-only agreed costs; foreign customer and Team denial; and private-helper denial.

## Complete custom-production journey

The new end-to-end SQL test creates an actual customer preset, accepted quote and order, then switches through the real authenticated personas:

1. SC records a deposit; accepted selling totals remain authoritative.
2. PC assigns the factory and checks criteria while seeing selling amounts without payment details.
3. FM assigns the cutter; CM records two cutting movements.
4. FM allocates the six actual pieces between a tailor and subtailor.
5. Inspector completes both assignments; DI dispatches twice, verifying partial and final completion.
6. Customer rates the SC, SC rates the assigned PC, and PC rates the assigned factory manager.

The test verifies unchanged gross and paid amounts, exact `6/6/6/6/6` required/cut/assigned/completed/dispatched balances, correct recipient relationships and final completion. Separate worker-rate tests prove that changing agreed production cost does not reprice the customer order. This is local actual-RPC evidence; it does not substitute for the final hosted persona acceptance run.

## Historical timestamp and finance boundaries

No historical timestamp conversion or financial formula was changed. The pinned Rails source `config/application.rb:31–33` sets application time zone `Kolkata` and `config.active_record.default_timezone = :local`. Rails documents `:local` as choosing `Time.local`, separately from application zone conversion. Thus static application configuration alone does not establish the deployed process/OS time zone or prove how imported timezone-less database columns were stored. See [Rails default_timezone documentation](https://guides.rubyonrails.org/configuring.html#config-active-record-default-timezone).

Current new SQL writes/API timestamps use explicit UTC, and business report windows use Asia/Kolkata calendar boundaries with exclusive end times. The existing historical report comparison assumes imported naive timestamps are UTC. That historical assumption is an explicit acceptance gate, already recorded in the execution journal; it must not be silently converted by 5½ hours based only on the Rails setting.

Required source evidence before closing that gate is environment-specific: deployed process `TZ`/`Time.now.utc_offset`, actual ActiveRecord timezone configuration, representative raw timestamp values compared with the old API's serialized timestamps, and records around business-day/week boundaries. Staging evidence cannot stand in for production evidence. The restricted export-only SSH command does not provide arbitrary server-shell introspection. If source storage proves mixed or changes over time, retain the original values and design an explicit provenance-aware conversion; do not bulk-shift historical records.

The existing tailor earnings implementation correctly states its inspected legacy basis: assignment week, current completed quantity, current base OF/SN plus all linked base add-on OF/SN rates. Current rates applied to a historical assignment week are not a historical payroll snapshot. Existing tests confirm Saturday–Friday Kolkata boundaries, exclusive next Saturday, parent/subtailor attribution, current-rate behavior and fail-closed invalid rates/quantities. Finance validation of the legacy schedule and historical rate treatment remains a release acceptance requirement. This review does not declare the hardcoded tax schedule legally current or add a payment execution system.
