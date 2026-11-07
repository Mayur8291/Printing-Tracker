# Squad One implementation and verification

Source contract: `docs/SQUAD_ONE_BACKEND_PLAN.md` and `docs/squad-one-audit/ACCEPTANCE.md`.
Progress: `docs/SQUAD_ONE_EXECUTION.md`. This is an incremental implementation, not a declaration that the full audit matrix is complete.

The local harness uses the installed PostgreSQL 17 binaries, only on localhost port 55441, with source **structure** and synthetic records. It never downloads a customer-data dump. Its files are ignored under `tools/squad/private/`. Rebuilding destroys only the hard-coded local `squad_test` database.

```sh
tools/canto-sync/.venv/bin/python tools/squad/local_db.py rebuild
tools/canto-sync/.venv/bin/python -m unittest discover -s tools/squad -p 'test_*.py' -v
```

The staging deployment script uses the existing Keychain/Management connection helper. By default it executes all new Squad migrations in a transaction and rolls them back. `--apply` records immutable migration text and updates reviewed staging refresh fingerprints, after checking Printing Tracker isolation. Production is not a supported target.

```sh
tools/canto-sync/.venv/bin/python tools/squad/deploy.py
tools/canto-sync/.venv/bin/python tools/squad/deploy.py --apply
```

API contract conventions:

- Supabase Auth issues `sa_app` sessions. Ordinary staff sessions do not authorize Canto RPCs.
- Call `canto_api.v1_*` through `@canto/shared/squad`. Private schemas and imported tables remain inaccessible to clients.
- Bigint entity IDs are decimal strings in JSON responses. Versions are opaque `generation:revision` strings.
- Commands require an immutable UUID idempotency key. Reuse it with exactly the same payload after an uncertain response. A different operation/payload with the same key is rejected.
- Lists use a bounded cursor and return at most 100 records. Filters and actor scopes must be applied before the page boundary.
- `40001` means reload the entity; `42501` means forbidden; `28000` means the live session/account is no longer eligible; `55000` means temporarily unavailable/read-only; `22023` means invalid input.
- A source mirror is read-only. Disposable staging writes require an explicit operator setting; their revisions prevent unconfirmed refresh replacement. Cutover ownership enables normal writes and disables old-source refresh.
- A successful refresh increments the generation atomically and discards undelivered events from replaced mirror writes. It does not replay imported business side effects.

Local SQL tests do not substitute for hosted GoTrue/Data API tests, provider contract tests, or measured staging performance. Report each separately.
