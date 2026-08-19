# Scott API integration

The **Scott API** sidebar section (Customers · Reports · Masters) is a port of the standalone
ScottOne dashboard into this app. It talks to the Scott International REST API
(`https://leaderboard.sagarfab.com`, staging `http://64.227.186.227`) through a Supabase Edge
Function, so Scott credentials never reach the browser.

```
Browser ──supabase.functions.invoke('scott-dashboard-masters')──▶ Edge Function ──▶ Scott Rails API
```

## Access model

**Scott tabs are admin-only.** The edge function authorizes callers with
`profiles.role === 'admin'` OR an `admin_emails` match and 403s everyone else — the same gate the
original ScottOne used. The three tab ids (`scott_customers`, `scott_reports`, `scott_masters`) are
listed in `DASHBOARD_ADMIN_ONLY_TAB_IDS` (`src/dashboardSidebarConfig.js`), which hides them from
non-admins and omits them from the per-viewer permission grid — otherwise viewers would see tabs
that only render "Forbidden". Relax the UI gate only if you relax the edge function's gate too.

## Deploy

Staging first, always (see `.cursor/rules/staging-first-supabase.mdc`).

```bash
npx supabase link --project-ref scvojtvgnkmbupvyslmb
npx supabase functions deploy scott-dashboard-masters --project-ref scvojtvgnkmbupvyslmb
```

### Required secrets

Set on the Supabase project (Edge Functions → Secrets, or `npx supabase secrets set`):

| Secret | Required | Notes |
|---|---|---|
| `SCOTT_AUTH_EMAIL` | yes | Service account. **`admin@scottinternational.com`** — note *intern-a-tional*; the `scottinternation.com` variant returns *Invalid credentials*. |
| `SCOTT_AUTH_PASSWORD` | yes | Never commit. Secrets are write-only; they cannot be read back. |
| `SCOTT_STAGING_AUTH_EMAIL` | no | Falls back to `SCOTT_AUTH_EMAIL`. |
| `SCOTT_STAGING_AUTH_PASSWORD` | no | If unset, staging uses the default credentials. |
| `SCOTT_STAGING_HOSTS` | no | Comma-separated. Default `64.227.186.227`. |
| `SCOTT_API_BASE_URL_ALLOWLIST` | no | Defaults to the two hosts above. |
| `SCOTT_API_BASE_URL` | no | Fallback when the client sends a non-allowlisted base URL. |

The function is registered in `supabase/config.toml` with `verify_jwt = true`. It is **not** in
`.github/workflows/promote-to-production.yml`, so a production release needs a manual deploy —
the same known gap as `dashboard-stock-api` and `tenor-gif-search`.

### Verifying a deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://<ref>.supabase.co/functions/v1/scott-dashboard-masters" \
  -H "Content-Type: application/json" -d '{"resource":"colors","method":"GET"}'
```

Expect `401` with no auth, `401` with only the anon key ("missing sub claim"), and `200` on an
OPTIONS preflight. A real call needs a signed-in admin's JWT.

## Layout

```
supabase/functions/scott-dashboard-masters/index.ts   the proxy (auth gate, routing, multipart)
src/scott/
  scottClient.js scottPagination.js scottRuntime.js   transport, pagy, env switch
  scottImage.js scottSettingsService.js
  data/          masterConfigs*.js mastersService.js  22 masters
                 customers*.js customerTypes.js       customers + performance
                 reports/                             7 reports
  list/          filterEngine tableSort quickFilters useScottList
  bulk/          save, CSV import, bulk delete, rmp_prices upload + grid UI
  ui/            shared table/dialog/filters/pagination/toasts/env badge
  masters/ customers/ reports/                        per-domain screens
  Scott*TabPanel.jsx                                  the three tabs
```

## Protocol invariants (do not "fix" these)

- Writes are **multipart form-data**; JSON bodies are ignored upstream. Nested objects are
  flattened Rails-style (`addresses[0][city_id]`).
- The upstream `Authorization` header is the **raw Scott JWT — no `Bearer` prefix**.
- The edge function always answers **HTTP 200** with `{ok, upstreamStatus, upstreamUrl, body}`.
  Clients check three layers: transport error, `ok === false`, and HTTP-200 bodies carrying
  `success: false | 'false'`.
- Routing: default `/api/dashboard/v1/{resource}`; `profit_margins`/`promotions`/`size_types` on
  `/api/v1/` **except** their `bulk_delete`; base product types LIST is `POST
  /api/v1/products/base_product_types`; `ready_made_products` (and its `inventory_reports` alias)
  are always POST with query merged into the form body, default action `get_inventory`; `settings`
  is a forced `PATCH .../settings/airtable_sync`; a dashboard-namespace 404 retries once on `/api/v1/`.
- Pagination uses `page`/`items`; responses carry a Rails Pagy object whose totals are sometimes
  **inexact lower bounds** — the UI treats them as such (Next is driven by `hasNextPage`, not by
  arithmetic on `total`).
- Server-side querying is minimal (`page`, `items`, `search`, plus a few entity params). **All other
  filtering and all sorting are client-side**: activating either flips the list into full-dataset
  mode via fetch-all.
- Several entities update via **read-merge-write PATCH**. Never send a partial body there.
- Soft deletes use `is_deleted`; recreating a name that is soft-deleted may reactivate the old row.

## Known upstream quirks (preserved deliberately)

- `CANCELLED` displays as `Failed` in Order Tracking.
- Some responses report success as the string `'false'`.
- Fabrics "delete" is a PATCH (soft delete).
- `OD-P-…` order ids arrive truncated in some rows; enrichment by order id compensates.
- RMP Sales Overview's "Total Orders" tile reads the **list pagination total**, not the stats
  aggregate — they can disagree when Pagy totals are inexact.

## Intentional divergences from the original

| Original | Here | Why |
|---|---|---|
| `react-data-grid` bulk grid | Hand-built on shadcn `Table` | No new npm dependencies allowed |
| DEV fake-data mocks on empty/error | Real empty/error states | Mocks mask integration failures |
| Customer-performance debug ring buffer | Not ported | Dev-only affordance |
| Vercel image-proxy function | Client-side URL rewrite only | This app is on Netlify; the route is **not built** — see below |
| Inert paste handler; "Unsupported import type" throw | Implemented correctly | Reproducing a bug is not fidelity |

### Outstanding: image proxy

`src/scott/scottImage.js` rewrites mixed-content image URLs to `SCOTT_IMAGE_PROXY_PATH`
(`/api/scott-image-proxy`), but **no Netlify function serves that path**. Production Scott is
https, so this only affects the `http://` staging host viewed from an https deploy. To finish it,
add `netlify/functions/scott-image-proxy.js` plus a `[[redirects]]` entry in `netlify.toml`,
allowlisting only the two Scott hosts.

## Gotchas when working on this

- **`node_modules` is committed in this repo, including Vite's `.vite` dep cache.** Switching
  branches can restore a cache built against different packages, producing errors like
  *"supabase.auth.signInWithPassword is not a function"*. Fix: `rm -rf node_modules/.vite` and
  restart the dev server.
- `scripts/check-ui-gate.mjs` only reads the **first binding** of a mixed
  `import Default, { Named }` statement and will report the second as a missing import. Use
  separate import statements or all-named imports.
- There is **no React error boundary**: a missing import blanks the whole app. Run
  `npm run check:ui` before calling any UI change done.
