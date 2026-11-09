# Squad One web planning traceability

Start with [the detailed implementation plan](../SQUAD_ONE_WEB_IMPLEMENTATION_PLAN.md).

Current release state: staging and production now have **141 matching migrations and verified application artifacts**, including all four checked Edge bundles ([production release](evidence/production-release-141.json), [Edge release](evidence/production-edge-release-141.json), [application parity](evidence/application-parity-141.json)). All86production source tables and public structure were preserved, and schedules restored. Strict platform parity remains false only for the documented `pg_net` patch difference; managed maintenance is separate. Endpoint and refresh catalog checks pass; no data refresh or cutover ran. [Progress](implementation-progress.json) remains **96% accepted**: native core controls and the focused dialog correction are accepted; final frontend deployment checks remain. Earlier release evidence is retained as history.

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
