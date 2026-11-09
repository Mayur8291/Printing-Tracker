# Squad One web planning traceability

Start with [the detailed implementation plan](../SQUAD_ONE_WEB_IMPLEMENTATION_PLAN.md).

Current release state: **100% of the fixed internal web implementation/release criteria is accepted**. The [live application](https://scottdashboard.vercel.app) serves tested source `93f8f66`; its default Supabase environment remains **staging**, and normal business writes remain mirror-gated. Both application backends match at **141 migrations**; the managed `pg_net` patch difference remains separate. Live verification covers 11 persona logins / 102 read routes / 34 core checks, 16 Tracker checks and all 46 generated code assets. Exact cleanup passed, including the recovered staging incident. See the [final handoff](final-web-handoff.md) for all 14 actor outcomes, scoped 115-row evidence, rollback and remaining ownership/provider/data/platform/human-UAT gates. No production cutover or data refresh is inferred.

- `workflow-web-coverage.csv`: all 115 original workflow IDs, with exact original actor/conditional scope, proposed web entry, shared component, delivery wave, source references, backend-contract reference and required browser acceptance.
- `persona-web-coverage.csv`: all 13 stored roles, their original workflow lists and proposed login/managed-subject treatment.
- `source-discovered-web-gaps.csv`: required source variations not adequately covered by the earlier backend-oriented mapping. Currently WEB-GAP-01 is customer self-service account closure; existing administrator deletion cannot be reused.
- `source-view-web-traceability.csv`: all 317 pinned Flutter view-related source files with content fingerprints and shared-component mappings. Explicit review states prevent treating a module mapping as complete per-control or hosted acceptance. Regenerate with `python3 docs/squad-one-web/build_view_traceability.py`.
- `coverage-validation.json`: inventory validation, not a runtime pass rate.

All web acceptance starts as planned. Route mappings and component names are proposals. Existing workflow contracts, authority and evidence remain in `../squad-one-audit`; the new CSVs do not grant permissions or authorize a cutover.

Regenerate these planning artifacts from the repository root:

```sh
python3 docs/squad-one-web/build_web_plan_matrix.py
```

The renderer preserves original actor columns and fails if any original workflow/module mapping is missing. Keep human/test execution results in a separate release ledger so regeneration cannot overwrite real acceptance evidence.
