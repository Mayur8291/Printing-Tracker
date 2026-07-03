# Debugging

## Job sheet appears in Printing orders list

### Symptom
Job sheet shows in **Printing orders** with printing columns/format; should only be in **Production tracker**.

### Root cause
Job sheet saved with default `order_kind = printing`. Printing tab did not exclude production tracker job sheets.

### Fix
Apply `20260703200000_add_order_kind_job_sheet.sql` (sets `order_kind = job_sheet` on save + backfill). Reload app — job sheets only in Production tracker.

## Job sheet history empty or only generic events

### Symptom
**Job sheet history** modal opens but shows no entries for old job sheets, or only status/qty changes — not payment, gender, size type, etc.

### Root cause
History reads `order_activity_log`. Job-sheet-specific events are written by `log_order_activity()` only after migration `20260703190000_job_sheet_activity_log.sql` is applied. Events are not backfilled for past edits.

### Investigation
1. Open job sheet → **Job sheet history**.
2. Supabase: `SELECT event_type, message, created_at FROM order_activity_log WHERE order_id = <id> ORDER BY created_at DESC;`
3. Check migrations: `list_migrations` or `supabase migration list` for `job_sheet_activity_log`.

### Fix
Apply `20260703190000_job_sheet_activity_log.sql` on the linked project. Edit and save a job sheet field to confirm a new row appears (e.g. `job_sheet_payment_updated`).

## Orders table empty after save (loading skeleton, then no rows)

### Symptom
After saving a job or job sheet, a brief loading row appears, then the orders table is empty. Browser console may show `column orders.gender does not exist` (or another missing column). Data may still exist in Supabase SQL editor.

### Root cause
`fetchOrders` in `App.jsx` selects columns that are not yet on the linked Supabase project. Postgres rejects the whole query; the UI only logged the error and left `orders` empty. Optimistic “pending” rows are removed in `finally` after save, so the new job vanishes too.

### Investigation
1. Browser DevTools → Console — look for Supabase/PostgREST errors on `orders` select.
2. Supabase SQL editor: `SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('gender','product_type');`
3. Compare with `fetchOrders` select list in `src/App.jsx` and files under `supabase/migrations/`.

### Fix
Apply the missing migration on the project your `.env` points to (e.g. `20260709120000_add_job_sheet_gender_product_type.sql` for `gender` / `product_type`). Reload the app.

### Example (2026-07-03)
- **Cause:** Migration existed in repo but was not applied to production (`levwrmvqdntngeasrtnb`) or staging (`scvojtvgnkmbupvyslmb`).
- **Fix:** Applied `add_job_sheet_gender_product_type` via Supabase MCP on both projects. Added `ordersLoadError` banner in `App.jsx` when fetch fails.

### Prevention
Run `npm run check:env` before DB work. List fetch omits design URL blobs — if detail panel images empty briefly, wait for detail hydration or hard refresh.

## Dashboard slow after login

### Symptom
Long skeleton on Printing / orders tabs; app feels sluggish right after sign-in.

### Root cause
- `fetchOrders` pulled all rows with heavy columns (`approved_design_url`, `approved_design_images`, archives) for every order.
- `loadGlobalSearchExtras` ran immediately (hundreds of challan rows + contacts).
- Background poll every 25s duplicated realtime subscriptions.

### Fix (2026-07-03)
- List fetch uses `ORDERS_LIST_SELECT`; full assets load on **View order** only.
- Search extras deferred 2.5s after login.
- Poll every 60s when tab visible only.

### Investigation
Network tab → `orders` request payload size before/after. Console for slow Supabase errors.

## Inventory tab slow to open

### Symptom
Inventory shows skeleton a long time before overview or SKU tables appear.

### Root cause
- All SKU pages fetched sequentially before UI (3000+ rows).
- Stock movements (100 rows + joins) loaded on every inventory open.
- SKU drawer waited on global movement list.

### Fix (2026-07-03)
- First **1000 SKUs** load for fast paint; rest load in background.
- Movements deferred until Movements tab or after 2.5s.
- Opening a SKU fetches full row + recent movements for that SKU only.

## Blank white screen on load

### Symptom
Browser shows empty white page. Dev server may still run. Console often has `ReferenceError: X is not defined`.

### Root cause
React crashes during initial render — usually a JSX component used without import, or a syntax error in a root file (`App.jsx`, `main.jsx`).

### Investigation
1. Open browser DevTools → Console. Note the first red error and file/line.
2. Check dev terminal for Vite/Babel JSX parse errors.
3. In the reported file, confirm every `<PascalCase>` tag has an import.
4. Run `npm run build` — some runtime issues still compile.

### Fix
Restore missing import or fix JSX structure. Hard refresh (`Cmd+Shift+R`).

### Example (2026-07-03 — formatJobSheetMoneyDisplay missing import)
- **Symptom:** View order in Production tracker → blank screen; console: `ReferenceError: formatJobSheetMoneyDisplay is not defined` at `OrderDetailPanel.jsx`.
- **Fix:** Restore `import { formatJobSheetMoneyDisplay } from "./jobSheetPaymentUtils";` in `OrderDetailPanel.jsx`.

### Example (2026-07-03 — duplicate hooks + Select crash)
- **Symptom:** View order on production job sheet → blank screen.
- **Cause 1:** Duplicate `useState` / `useEffect` left in `OrderDetailPanel.jsx` after a partial edit — React hooks count changed between renders → crash.
- **Cause 2:** `JobSheetOrderPaymentSection` passed `value={undefined}` to shadcn `Select` when payment mode or delivery city was empty — controlled/uncontrolled Select crash.
- **Fix:** Remove duplicate hooks; use sentinel `__none__` Select values; ensure status dropdown options always include the order’s current status.
- **Verify:** `npm run check:ui` then hard refresh and open View order on a job sheet.

### Example (2026-07-03 — jobSheet before init)
- **Cause:** `OrderDetailPanel` used `jobSheet` in `showJobSheetPaymentProof` before `const jobSheet = isJobSheetOrder(order)` — `ReferenceError: Cannot access 'jobSheet' before initialization`. View order in Production tracker crashed entire app.
- **Fix:** Declare `jobSheet` before any use. Run `npm run check:ui` before finishing.

### Example (2026-06-25)
- **Cause:** `CreateOrderModal` import removed from `App.jsx` while adding shadcn `Dialog` for View Order.
- **Fix:** `import CreateOrderModal from "./components/orders/CreateOrderModal";`

### Prevention (required before finishing UI work)

Run **`npm run check:ui`** (build + JSX import scan). See `.cursor/rules/blank-screen-gate.mdc` and `.cursor/rules/shadcn-ui-only.mdc`.
