# Laws of the single source of truth

These are binding for every migration and module in the Scott Ops Platform build
(the "One Source of Truth" roadmap — see `ONE_SOURCE_OF_TRUTH_ROADMAP.md`).
They do **not** apply to, and must never be used to refactor, the **Scott API**
section (see the guard at the bottom).

## The nine laws

1. **One master per entity.** Customers, vendors, SKUs, locations, employees, GST
   entities. Transactions reference master IDs. No free-text party or SKU names on
   any transaction table.
2. **Stock is a ledger, not a number.** Nobody edits a quantity. Every change is an
   append-only movement with a reason and a reference document. On-hand is a sum.
3. **Money is a document.** Invoice, credit note, receipt, bill — never a cell.
   Every rupee on a report traces to a document ID.
4. **Every document has a state machine and an audit row.** Status transitions are
   enforced in the database; every transition writes who, when, from, to.
5. **One owner per location.** A location is owned by the platform or by Uniware,
   never both. Cross-boundary moves are explicit transfer documents.
6. **Sheets export from the platform, never into it** (after cutover). Google Sheets
   survive only as read-only mirrors, not as inputs.
7. **Tally is the statutory ledger.** The platform posts vouchers; nobody types the
   same invoice twice. A daily reconciliation screen shows platform vs Tally.
8. **Every report is a SQL view over the same tables.** One definition of each metric,
   written once in a metric dictionary, with an owner.
9. **Access is enforced in the database (RLS), not the UI.** Each role sees only its
   rows even when calling the API directly.

## The six questions (gate for any new module)

Before anything new is built, it must answer all six — or it is not ready:

1. Which master does it reference or create?
2. Are its quantities movements?
3. Is its money a document?
4. What is its state machine?
5. Which view reports it?
6. Which role sees it?

## Correctness rules

- Anything that moves **stock or money** lives in a database function with row locks
  (`SELECT … FOR UPDATE`) and tests (pgTAP or a Deno suite). Never in client code.
- Documents are immutable once numbered/posted; corrections are reversing documents
  (credit note, debit note, reversing GRN/movement) with a reason.
- Sequences are gapless and unique per entity × GSTIN × document type × financial year.
- Never hard-delete a document; status becomes `cancelled`. GST records survive 6+ years.
- Multi-entity from day one: `entity_id` and `gstin_id` on every document.
- All new backend/DB work goes to **staging first** (`scvojtvgnkmbupvyslmb`). Production
  (`levwrmvqdntngeasrtnb`) only on an explicit production release. See
  `.cursor/rules/staging-first-supabase.mdc`.

## Table prefixes

`core_`, `cat_`, `crm_`, `inv_`, `po_`, `so_`, `jw_`, `bill_`, `ar_`, `ap_`,
`uni_`, `dist_`, `cost_`, `prod_`, `hr_`, `rpt_`.

## Hard guard — Scott API section is out of scope

The **Scott API** area is frozen for this roadmap. Do not modify, refactor, rename,
re-prefix, or "align to the laws" any of:

- Sidebar tabs `scott_customers`, `scott_reports`, `scott_masters` (group "Scott API")
  in `src/dashboardSidebarConfig.js` / `dashboardSidebarPermissions.js`.
- `src/scott/**`
- Edge function `scott-dashboard-masters` and other `scott-*` functions.
- `docs/SCOTT_API.md`, `docs/SCOTT_INTEGRATION_REFERENCE.md`.
- The existing inventory-fetch / 1-day / 2-day delivery integration tables — these are
  the read-only mirror source; new modules read them, never write them.

New platform masters (`core_`, `cat_`, `crm_`) inherit existing SKU codes exactly as
they are today; nothing the Scott API integration maps on is renamed.
