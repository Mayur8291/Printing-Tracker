# Migration tooling provenance

The source migration packages under SC1 remain unchanged. `legacy_remap.py` was copied from `sa_snapshot_portable_20261020T1017Z/remap.py`; its `Remapper` constructor was extended with explicit expected column/default counts. All identifier mapping, constrained SQL AST transformations, inverse-normalization checks, COPY grammar checks and sequence grammar checks are retained. Its historical standalone command is not used by this workflow.

The source-schema inventories reviewed on 2026-11-07 have 86 tables, 84 sequences, 86 primary keys, 150 foreign keys and 164 additional indexes in each environment. Production has 848 columns/206 literal defaults. Active staging_v2 has 850 columns/207 literal defaults, including `orders.dashboard_reservation_id` and `orders.order_source`. Each complete normalized AST has a separate pinned SHA-256 in `baselines/`. An unreviewed schema change stops the refresh before destination mutation.

Supabase connections use the documented Management API `/cli/login-role` short-lived login, `/config/database/pooler` discovery and session-mode port 5432. This avoids resetting or retaining the project's owner database password. The API endpoint is beta; if it changes, the command fails rather than falling back to unverified credentials or insecure TLS.

The Supabase CA certificate SHA-256 is checked before connection:
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

Source SSH host keys were compared against `/etc/ssh/ssh_host_ed25519_key.pub` read in each authenticated DigitalOcean browser console. Key installation was specifically approved in this chat. The single source public key is restricted to one fixed read-only database dump command per host. No software, database changes or application restart was required on either source server.
