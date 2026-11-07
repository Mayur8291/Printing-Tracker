# Verification

Run offline safety tests from the project root:

```sh
.venv/bin/python -m unittest -v test_sync.py
```

Schema-only fixtures are parsed, never executed in `public`. They contain no table records or credentials.

The explicit staging integration check needs a capture matching the current staging snapshot:

```sh
.venv/bin/python delta_integration_check.py private/staging_<capture-id>
```

It produces exactly one insertion, two updates (including a test-user password hash) and one deletion in local fixtures, applies the real delta transaction and verifies every resulting table, then forces a failure before commit. It verifies all original table contents, sequence state, constraints, public schema and staff accounts after rollback, verifies Auth users and test sessions were restored, and tests advisory-lock exclusion. It never writes to DigitalOcean. The earlier full-copy integration test was retired following the documented capacity incident.

Authentication checks: `auth_test.py`, `auth_edge_tests.py`, `auth_guard_tests.py`, and `auth_session_test.py`. They are staging-only and require the private Mailinator test fixture created through Rails. The state tests restore the test account in a `finally` block. Keep these scripts out of production test workflows. See the root authentication verification JSON files for results.
