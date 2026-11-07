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

## Admin and monorepo acceptance

From the repository root with Node 26:

```sh
npm run check:ui
npm run check:mobile
npm run export:mobile
tools/canto-sync/.venv/bin/python tools/canto-sync/test_sync.py
tools/canto-sync/.venv/bin/python tools/canto-sync/tests/test_backup.py
tools/canto-sync/.venv/bin/python tools/canto-sync/test_masters_database.py
tools/canto-sync/.venv/bin/python tools/canto-sync/test_admin_guards.py
```

The database tests always roll their data changes back. PostgreSQL sequence allocation in CRUD tests is nontransactional; a final verified refresh resets snapshot sequences to the source. Run these only in staging with no refresh active.

For actual browser/REST acceptance, start `npm run dev`, create the isolated staging fixture with `acceptance_fixture.py`, and run these from the repository root:

```sh
node apps/admin/tests/canto-sign-in.mjs
node apps/admin/tests/canto-services.mjs
node apps/admin/tests/canto-behavior.mjs
node apps/admin/tests/canto-dialogs.mjs
node apps/admin/tests/canto-forms.mjs
```

These tests create identifiable staging master fixtures and retain credentials/results only in ignored `tools/canto-sync/private`. They never use production or create mail messages. `CHROME_PATH` may select an installed Chrome binary. Run the dashboard refresh with explicit replacement confirmation to restore imported staging data after tests, then run `acceptance_fixture.py --cleanup`. Browser tests cover the actual existing form serializers, images, relations, stale updates, all 22 dialogs, visible form/CSV submission, and persistent refresh history. The history test requires at least one successful dashboard refresh.

`node apps/admin/tests/canto-batches.mjs` verifies concurrent batch writes and stale-record rejection. The visible CSV test imports six rows.
