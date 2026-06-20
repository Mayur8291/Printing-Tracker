# Scott Dashboard

**Scott Dashboard** is the operations hub for Scott's printing and production workflow. It started as a printing order tracker and has grown into a full dashboard: orders, billing, dispatch, inward/outward logistics, team chat, contacts, shared links, analytics, and admin controls — all in one place.

Built with **React + Vite** on the frontend and **Supabase** (PostgreSQL, Auth, Storage, Realtime, Edge Functions) on the backend. Hosted on **Netlify** with separate **staging** and **production** environments.

---

## Recent updates

| Area | What's new |
|------|------------|
| **Job sheet (Production tracker)** | Dedicated **Create Job sheet** form — separate from printing orders. Auto order ID from **0900+**, auto order date, sales incharge, customer, size type, rate/qty, **XXS–8XL** size grid + additional sizes, product/brand/color/fabric, branding, GSM, atta, comments, delivery date. |
| **Sales incharges** | Admin → **Owners, coordinators & sales incharges** — add names used in the job sheet dropdown. |
| **Inward entries (GRN)** | Dispatch tab → create/list **inward entries** with GRN, package photo, size breakdown, preview card. |
| **Staging / production** | Git `develop` → staging Supabase + Netlify branch deploy; `main` → live. See [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md). |
| **One-click release** | Admin → **Test & deploy** (staging/local only) → **Release staging → production** merges `develop` → `main`, runs prod migrations, deploys edge functions. See [docs/RELEASE_AUTOMATION.md](docs/RELEASE_AUTOMATION.md). |
| **Admin user management** | Create/edit viewers: sidebar tab view/edit permissions, job role, employee ID, active/inactive, coordinator defaults, assignment notifications. |
| **Safety guards** | Red banner if local dev points at **production** Supabase; **Test & deploy** tab hidden on the live production site. |
| **Database repair** | Migration `20260613140000_repair_master_directory_tables.sql` recreates owners/coordinators/sales_incharges if missing. |

After pulling, apply new migrations:

```bash
supabase link --project-ref YOUR_STAGING_REF
supabase db push
```

---

## Features overview

### Printing & production

| Area | What it does |
|------|----------------|
| **Printing Orders** | Create and manage job cards: customer, coordinator, sizes, colors, mockups, payment/delivery, production flags, **order cost** and **printing cost**. Active vs complete lists, search, coordinator filter, CSV export (admin). |
| **Printing department** | Priority queue sorted by delivery date and order time. |
| **Production tracker** | Production job sheets (`is_production_order`). **Create Job sheet** button opens the dedicated form (not the printing order form). |
| **Mockup Studio** | In-app mockup creation from the Printing Orders tab. |
| **Repeat Order** | Save **order templates** (customer, product, colors, sizes, costs, reference images, production handover). Reuse with one click — tweak qty/date and save. |
| **Status workflow** | `new` → printing stages → complete; activity log per order; optional **status-change tones** (per user, creator-only). |
| **Pagination** | Configurable orders per page on list tabs (saved per tab in the browser). |

#### Job sheet fields (Production tracker → Create Job sheet)

| Field | Notes |
|-------|--------|
| Order ID | Auto-generated, continues from **0900** (4-digit) |
| Order date | Auto — today |
| Sales incharge | Dropdown; manage in Admin |
| Customer name | Text |
| Size type | Alpha / Numeric / Free size / Custom |
| Rate per piece | Optional decimal |
| Total quantity | Manual or sum of size boxes |
| Sizes | **XXS** through **8XL** + **Additional sizes** |
| Product name, Brand, Color, Fabric type | Text |
| Branding | Yes/No + branding type when Yes |
| GSM, Atta | Text / Yes–No |
| Comments | Textarea |
| Delivery required on | Date (stored as order due date) |

### Billing & dispatch

| Area | What it does |
|------|----------------|
| **Billing** | All orders in a date range; upload/replace invoices (permission-gated). |
| **Dispatch** | Pending vs processed verification: sizes, product name, colors, issue types; pass/fail highlighting. Default sub-tab: **Printing orders** (not Inward). |
| **Inward entries** | GRN inward log with package photo, size breakdown, list + floating preview; create from Dispatch. |
| **Outward challans** | Create/list outward challans with barcode, transport, packaging photo (Dispatch tab). |

### Reports (admin, Printing Orders tab)

| Report | What it does |
|--------|----------------|
| **Coordinator report** | Orders by coordinator over day/week/month/range; pie/line charts; **revenue, printing cost, and net** per coordinator. |
| **Product revenue** | Revenue and cost **by product name**; top performers, bar chart, sortable table. |

### Team & resources

| Area | What it does |
|------|----------------|
| **Team Chat** | Realtime messages with optional file attachments. |
| **Contact Book** | Directory with photos, departments, search/filter (admin manages entries). |
| **Shared Links** | Admin-managed links to SharePoint, Excel/Sheets, and other URLs. |
| **Monthly archive** | Download monthly ZIP (orders, mockups, designs, Excel details); optional cloud purge (admin). |
| **Global search** | Search orders and related records from the header. |

### Access control & admin

- **Roles:** `admin` and `viewer` (plus profile-based permissions).
- **Sidebar tab permissions:** Per user — which tabs they can **view** and **edit**.
- **Field-level order permissions:** Fine control over what viewers can change on an order.
- **Admin panel:**
  - Create users, reset passwords, delete users (edge functions).
  - Edit viewers: tab permissions, order field permissions, job role, employee ID, active flag.
  - **Owners, coordinators & sales incharges** master lists.
  - **Test & deploy** (staging/local builds only): local dev link, hosted staging, view live site, **Release staging → production**.
- **Assignment notifications:** Toast when a coordinator is assigned on order create.
- **Responsive UI:** Desktop sticky sidebar; mobile hamburger drawer.

### Placeholder tabs (coming soon)

- Ready Stock Order  
- Asset Management  
- Audit  

---

## Environments & release workflow

| Layer | Production | Staging |
|-------|------------|---------|
| Git branch | `main` | `develop` |
| Netlify | Production URL | Branch deploy (`develop--…`) |
| Supabase | `levwrmvqdntngeasrtnb` | Separate staging project |
| Local dev | **Do not use for daily work** | `.env.development` or `.env.staging` |

**Daily flow:**

1. Work on `develop` + staging Supabase locally (`npm run dev`).
2. **Commit and push** to `origin develop` — staging Netlify rebuilds from GitHub (not from your laptop alone).
3. Test on staging URL or local dev.
4. Admin → **Release staging → production** (or merge `develop` → `main` manually).

Full setup: **[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)** · Release button setup: **[docs/RELEASE_AUTOMATION.md](docs/RELEASE_AUTOMATION.md)** · First staging DB: **[supabase/README-staging.md](supabase/README-staging.md)**

---

## Tech stack

- **Frontend:** React 18, Vite 5, Recharts  
- **Backend:** Supabase (Postgres, RLS, Auth, Storage, Realtime, Edge Functions)  
- **CI / deploy:** GitHub Actions (`promote-to-production.yml`), Netlify  
- **Exports:** ExcelJS, JSZip (archive / export flows)

---

## Project structure (high level)

```
src/
  App.jsx                      # Main app, auth, orders, admin, modals
  CreateJobSheetForm.jsx       # Production job sheet create form
  CreateInwardEntryModal.jsx   # GRN inward entry form
  AdminDeployPanel.jsx         # Test & deploy / release to production
  jobSheetUtils.js             # Job sheet sizes, order ID sequence
  inwardEntryUtils.js          # Inward entry helpers
  *TabPanel.jsx                # Billing, Dispatch, Contact Book, etc.
  dashboardSidebarConfig.js    # Sidebar tab definitions
  deployEnvironmentUtils.js    # Staging vs production detection
supabase/
  schema.sql                   # Full schema reference
  migrations/                  # Incremental DB changes (apply with db push)
  functions/                   # admin-create-user, admin-promote-production, …
docs/
  ENVIRONMENTS.md
  RELEASE_AUTOMATION.md
.github/workflows/
  promote-to-production.yml    # Automated develop → main release
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

Requires **Node.js 20+**.

### 2. Environment variables

**Staging + production:** see **[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)**.

For local dev, use **staging** keys only:

```bash
cp .env.development.example .env.development
# Edit with your staging Supabase URL and anon key
```

Optional explicit staging mode:

```bash
cp .env.staging.example .env.staging
```

| File | Used by |
|------|---------|
| `.env.development` | `npm run dev` |
| `.env.staging` | `npm run dev:staging` |
| Netlify env vars | Hosted builds (`VITE_APP_ENV=production` on live site) |

Both local dev commands use the **staging Supabase project** by design. Never put production keys in `.env.development`.

### 3. Database

**Option A — fresh project:** Run `supabase/schema.sql` in the Supabase SQL editor.

**Option B — migrations (recommended):**

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

If master tables are missing (owners / coordinators / sales incharges), run:

`supabase/migrations/20260613140000_repair_master_directory_tables.sql`

**First-time staging:** see [supabase/README-staging.md](supabase/README-staging.md) — often requires `schema.sql` + migration repair, not bare `db push` on an empty DB.

### 4. Storage buckets

Schema/migrations create buckets for: approved designs, payment screenshots, order invoices, contact-book photos, team chat files, order customer assets, order-template images, inward package photos, outward challan photos. Ensure storage policies are applied (included in schema/migrations).

### 5. Auth users

Create users in **Supabase Auth**, then set roles:

```sql
update public.profiles
set role = 'admin'
where id = 'USER_UUID_HERE';
```

Or add email to `admin_emails` per schema.

Deploy edge functions for in-app user management and production release:

```bash
npx supabase functions deploy admin-create-user
npx supabase functions deploy admin-delete-user
npx supabase functions deploy admin-reset-password
npx supabase functions deploy admin-promote-production
```

### 6. Run locally

```bash
npm run dev          # Vite development mode → .env.development
npm run dev:staging  # Vite staging mode → .env.staging (same staging DB if keys match)
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

### 7. Production build

```bash
npm run build
npm run preview   # optional local preview of dist/
```

---

## Sidebar navigation

| Tab | ID | Notes |
|-----|-----|--------|
| Home | `home` | Dashboard home, status counts |
| Printing Orders | `printing` | Main order list + reports sub-tabs |
| Printing department | `printing_department` | Priority queue |
| Billing | `billing` | Invoices |
| Dispatch | `dispatch` | Verification, inward/outward |
| Ready Stock Order | `regular` | Placeholder |
| Production tracker | `production_tracker` | Job sheets + **Create Job sheet** |
| Shared Links | `shared_links` | |
| Contact Book | `contact_book` | |
| Chat | `chat` | Team chat |
| Asset Management | `asset_management` | Placeholder |
| Audit | `audit` | Placeholder |
| Admin Panel | `admin` | Users, masters, Test & deploy (staging/local only) |

Tab visibility and edit rights are configurable per viewer in the admin panel.

---

## Order data (high level)

**Printing orders**

- Order / delivery dates, customer, owner, coordinator  
- Product, colors, size breakdown (XS–3XL + extras), qty, printing metres  
- Order cost and printing cost  
- Payment method, delivery method, payment proof uploads  
- Mockups / approved designs / customer assets  
- Status, remarks, activity log  

**Production job sheets** (additional fields)

- Sales incharge, size type, rate per piece, brand, fabric type  
- Branding / branding type, GSM, atta  
- Size breakdown XXS–8XL + extras  
- `is_production_order = true`; appears on Production tracker  

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server — loads `.env.development` (staging Supabase) |
| `npm run dev:staging` | Dev server — Vite `staging` mode, loads `.env.staging` |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run deploy:admin-create-user` | Deploy `admin-create-user` edge function |
| `npm run icons:transparent` | Regenerate transparent app icon assets |

---

## Edge functions

| Function | Purpose |
|----------|---------|
| `admin-create-user` | Create auth user + profile from Admin panel; if Auth already has the email but `profiles` is missing, links the profile instead of failing |
| `admin-delete-user` | Remove user |
| `admin-reset-password` | Send password reset |
| `admin-promote-production` | Trigger GitHub Action to release staging → production |

---

## Notes

- **Repository:** [Mayur8291/Printing-Tracker](https://github.com/Mayur8291/Printing-Tracker) on GitHub; local folder may still be named *Scott Dashboard* or *Printing Live Tracker*.  
- **package.json** `name` is `printing-live-tracker` for compatibility.  
- Apply new migrations after pulling: `supabase db push` on staging first, then release to production.  
- The release button only promotes commits already pushed to **`origin develop`** — local-only changes are not deployed.  
- Status tones require a user gesture in the browser once (autoplay policy); users can disable tones in admin user settings.  
- If you see a banner about missing Supabase tables, run the repair migration above — often only `sales_incharges` is missing, not owners/coordinators.

---

## License

Private / internal use unless otherwise specified by the project owner.
