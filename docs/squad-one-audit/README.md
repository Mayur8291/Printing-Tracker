# Squad One audit artifacts

Start with [the backend plan](../SQUAD_ONE_BACKEND_PLAN.md), then use [the searchable table](matrix.html), [full matrix and contracts](FUNCTIONALITY_MATRIX.md) or [CSV](functionality-matrix.csv).

`capabilities.py` is the curated source of truth for the **plan**, not runtime access-control code. `build_plan.py` renders the matrix, persona/master summaries and source dispositions. Reuse counts include feature-conditional actors; guests, trusted jobs and Printing Tracker admins do not count as legacy personas. Planned permissions are distinguished from literal old UI rules and are not evidence of deployed grants.

| File | Purpose |
|---|---|
| `personas.csv` | All 13 stored roles, dashboard availability, workflow IDs and conditional grants |
| `master-capabilities.csv` | Unique shared modules, use counts and canonical tables |
| `functionality-matrix.csv` | Unique workflow rows, personas/reuse count, proposed APIs, input/result, invariants and pinned source links |
| `api-catalog.csv` | Unique proposed RPC names linked to workflow contracts; Edge/native/worker contracts remain in the matrix |
| `source-files.csv` | 1,458 source fingerprints and classification; support files are not claimed independent features |
| `flutter-views.csv` | View/view-model/tab file coverage, including explicit unused-screen retirement |
| `flutter-services.csv` | Flutter service declarations including client-only helpers |
| `legacy-routes.csv` | Static verb/path declarations, implemented-handler evidence and module mapping; duplicates retained for traceability |
| `controller-methods.csv` | Public and private methods; not all are callable endpoints |
| `legacy-role-rules.csv` | Literal hardcoded Flutter role lists; comments excluded |
| `legacy-tables.csv` / `snapshot-tables.csv` | Stale schema versus imported column inventory; no row data |
| `branch-differences.csv` | Older Flutter main and alternate Rails develop discrepancies |
| `migration-history.csv` / `alternate-branch-methods.csv` | Schema provenance and alternate WMS branch method coverage |
| `notification-events.csv` | All 115 legacy strategy types, event-family proposal and recipient resolver evidence |
| `background-jobs.csv` / `side-effects.csv` | Concrete jobs/framework base and callback/enqueue/mail/push sites |
| `ACCEPTANCE.md` | Required implementation tests and per-persona journeys; not tests already passed |
| `coverage.json` | Counts and zero unclassified inventory entries; not a runtime parity score |
| `validation.json` | Latest artifact/link/filter validation results; explicitly records unperformed visual/runtime checks |

Reproduce from the sibling `../Canto/scott-flutter` and `../Canto/scott-international-backend` repositories containing the pinned commits:

```sh
python3 docs/squad-one-audit/build_inventory.py
python3 docs/squad-one-audit/build_plan.py
python3 docs/squad-one-audit/validate_audit.py
```

The first script uses `git show` and never checks out, executes or changes either legacy app. The second regenerates dispositions and rendered artifacts. The live snapshot column CSV is a separately captured, read-only inventory, not re-fetched by these commands. Rerun the schema query only if the imported structure changes.

Static route enumeration does not boot Rails. It expands the DSL used in the pinned route file, includes redundant PATCH/PUT/resource declarations and marks missing controller methods. Sidekiq's third-party UI and wildcard CORS preflight are infrastructure, not new mobile API capabilities. Native packaging/assets and deployed binary provenance are outside this backend source scope.

GitHub evidence links include immutable commits; repository access may still be required. The same paths exist in the local clones. No source credential values, private dumps, actual notification tokens or customer records are included.
