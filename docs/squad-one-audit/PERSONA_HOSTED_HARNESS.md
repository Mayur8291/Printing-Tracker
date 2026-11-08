# Hosted persona acceptance harness

The prepared harness exercises all 11 login personas through real staging GoTrue and the same shared SDK intended for web/mobile. Its scope is login, reads, role/record/field authorization, session refresh and logout. It does not replace the complete business mutation journeys in the release matrix.

`tools/squad/test_hosted_personas.py` defaults to a read-only preflight. `--execute` creates a small committed synthetic graph, runs `test_personas_hosted_sdk.mjs`, then removes that exact graph in `finally`. The release integrator must review the frozen artifact before execution. The integrator completed the reviewed hosted run on 2026-11-08 through migration `20261108100638`: all 11 login roles passed, and exact-owned Auth/session/source fixtures were removed.

The fixture creates 11 distinct source accounts and copies each randomly generated bcrypt hash unchanged into its own Supabase Auth identity. It covers role IDs 0, 1, 2, 3, 4, 7, 8, 9, 10, 11 and 12. Tailor and Sub Tailor remain managed source subjects without Auth identities. Two factories, two orders and their customer/assignment relationships establish positive and negative scopes. The Production Coordinator sees the direct custom order and is explicitly denied the dealer-linked order. Customer, dealer and factory roles have their own corresponding scope and field-redaction checks.

All hosted execution is fixed to staging. The harness holds the existing refresh/release advisory fence, requires a clean idle mirror and keeps cutover and test writes disabled. There are no provider requests, worker activations, emails or business command writes. It checks rejected passwords, raw table/service-RPC denial, mirror write denial, user-metadata authority rejection, real Auth token refresh and revoked-session rejection.

Recovery uses a mode-0600 checkpoint in the ignored `tools/squad/private` directory. The checkpoint contains only the exact planned IDs, labels, environment and generation; passwords and tokens are never written there. Cleanup verifies ownership and relationships, refuses changed generations/revisions or collisions, revokes sessions, and removes only the fixture's Auth and source records. Eleven blocked immutable identity reservations remain, together with ordinary Auth audit records and sequence gaps. The reserved source-ID range is below PostgreSQL `integer` limits, and source sequence values are not advanced by explicit fixture IDs.

Local fixture verification comprises seven rollback-only tests: complete creation/cleanup including repeated recovery, source collision, generation/revision mismatch, foreign child reference, all 11 order scopes, tampered checkpoint and managed-subject projection. The read-only hosted preflight and reviewed real hosted login journey both passed. The successful execution artifact at `implementation-evidence/staging-personas-sdk.json` records the exact migration prefix, per-persona checks and cleanup assertions. Across the initial assertion-failure run and the successful rerun, 22 blocked immutable identity reservations remain; no active fixture accounts remain.

Managed-subject projection is viewer-specific. The Factory Manager receives an explicit `email: null` and may see its staff's phone; Dispatch Incharge and Inspector receive neither contact field. Tests distinguish field absence from JSON null for all three viewers and reject password, internal identity and managed-email marker leakage. A first integrator-run hosted attempt exposed an overly broad null assertion; cleanup completed, and the assertion was corrected without changing the API.

Commands from the repository root:

```sh
# Read-only hosted preflight
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_personas.py

# Integrator-reviewed committed staging acceptance
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_personas.py --execute

# Exact checkpoint recovery after an interrupted execution
tools/canto-sync/.venv/bin/python tools/squad/test_hosted_personas.py --recover
```
