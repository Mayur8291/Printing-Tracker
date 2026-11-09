# Point detail query review (migration 124)

The first hosted operations journey stopped before factory allocation controls appeared. The browser received `canceling statement due to statement timeout` from `v1_order_item_get`; it was not a missing picker. Read-only staging profiling identified the existing product RLS subplan building 1,518 visible item-product entries to fetch one product, while independent item reads rebuilt the full order scope. A sampled existing item took approximately 206 ms for its row, 354 ms for its child query and 2.6 seconds for its complete detail. The failed fixture item had already been cleaned, so these measurements do not claim to reproduce its exact eight-second query.

Migration `20261108192922_squad_order_item_point_reads.sql` adds private, exact-item row/product readers guarded by the existing `can_item` predicate. Only `sa_executor` can execute them. It uses those readers in item and cutting/dispatch details, selects only the requested child relation instead of planning nine unrelated UNION branches, and resolves work-product media through indexed item references. Child relation RLS, public projections, financial field visibility, cursor binding, role checks and list policies remain in place. No statement timeout is raised.

The new `web-operations-detail.test.py` checks equality with existing item RLS across 22 actor/relationship combinations, inaccessible items, disabled-catalogue work-media behavior, and denial to `sa_app`, `anon`, `authenticated` and `service_role`. Existing detail tests retain section/actor/version cursor checks and money visibility.

A fresh local chain rebuild through 124 passed. A synthetic workload approximating staging cardinality (45,000 orders, 90,000 items, 216,000 size rows and 1,800 shared products) measured:

| Read | Local elapsed |
| --- | ---: |
| Dense production coordinator item detail | 37 ms |
| Sparse factory/inspector/cutter/worker detail | 15–21 ms |
| Each of nine detail sections | 17–49 ms |
| Cutting / dispatch detail | 3 ms |
| Related order detail | 13 ms |
| Foreign factory denial | 1 ms |

These are local regression measurements, not a hosted latency guarantee. A separate 100,000-row stress profile reduced full detail from approximately 162 to 56 ms and child reads from 52 to 10 ms. Tests passed: 5 new point-read cases, 27 existing detail cases, 44 production execution cases and 33 media-grant cases. The release integrator must rerun the real hosted operations journey after applying 124.
