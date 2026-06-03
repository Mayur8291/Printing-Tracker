# Scott Dashboard

**Scott Dashboard** is the operations hub for Scott's printing and production workflow. It started as a printing order tracker and has grown into a full dashboard: orders, billing, dispatch, team chat, contacts, shared links, analytics, and admin controls  all in one place.

Built with **React + Vite** on the frontend and **Supabase** (PostgreSQL, Auth, Storage, Realtime) on the backend.

---

## Features overview

### Printing & production

| Area | What it does |
|------|----------------|
| **Printing Orders** | Create and manage job cards: customer, coordinator, sizes, colors, mockups, payment/delivery, production flags, **order cost** and **printing cost**. Active vs complete lists, search, coordinator filter, CSV export (admin). |
| **Printing department** | Priority queue sorted by delivery date and order time. |
| **Production tracker** | Jobs marked as production orders, with handover-to-printing dates. |
| **Mockup Studio** | In-app mockup creation from the Printing Orders tab. |
| **Repeat Order** | Save **order templates** (customer, product, colors, sizes, costs, reference images, production handover). Reuse with one click  tweak qty/date and save. Card grid shows template reference images. |
| **Status workflow** | `new` ? printing stages ? complete; activity log per order; optional **status-change tones** (per user, creator-only). |
| **Pagination** | Configurable orders per page on list tabs (saved per tab in the browser). |

### Billing & dispatch

| Area | What it does |
|------|----------------|
| **Billing** | All orders in a date range; upload/replace invoices (permission-gated). |
| **Dispatch** | Pending vs processed verification: sizes, product name, colors, issue types; pass/fail highlighting. |

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
| **Shared Links** | Admin-managed links to SharePoint, Excel/Sheets, and other URLs; users open in a new tab. |
| **Monthly archive** | Download monthly ZIP (orders, mockups, designs, Excel details); optional cloud purge (admin). |

### Access control & admin

- **Roles:** `admin` and `viewer` (plus profile-based permissions).
- **Sidebar tab permissions:** Per user, which tabs they can **view** and which they can **edit** (e.g. sales can view Billing but not edit).
- **Field-level order permissions:** Fine control over what viewers can change on an order.
- **Admin panel:** Create users, reset passwords, manage viewers, status-tone toggle, tab permissions.
- **Responsive UI:** Desktop sticky sidebar; mobile hamburger drawer for navigation.

### Placeholder tabs (coming soon)

- Ready Stock Order  
- Asset Management  
- Audit  

---

## Tech stack

- **Frontend:** React 18, Vite 5, Recharts  
- **Backend:** Supabase (Postgres, RLS, Auth, Storage, Realtime, Edge Functions)  
- **Exports:** ExcelJS, JSZip (archive / export flows)

---

## Project structure (high level)

```
src/
  App.jsx                 # Main app, routing, auth, orders, admin
  *TabPanel.jsx           # Billing, Dispatch, Contact Book, Shared Links, etc.
  CoordinatorReportPanel.jsx
  ProductRevenuePanel.jsx
  orderPagination.jsx     # Shared list pagination
  dashboardSidebarPermissions.js
supabase/
  schema.sql              # Full schema reference
  migrations/             # Incremental DB changes
  functions/              # Edge functions (e.g. admin-create-user)
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

Requires **Node.js 20+**.

### 2. Environment variables

**Staging + production:** see **[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)** (branches, Netlify, Supabase).

For local dev, use **staging** keys only:

```bash
cp .env.development.example .env.development
# Edit with your staging Supabase URL and anon key
```

```env
VITE_SUPABASE_URL=https://your-staging-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-staging-anon-key
```

### 3. Database

**Option A  fresh project:** Run `supabase/schema.sql` in the Supabase SQL editor.

**Option B  migrations (recommended):** Link the project and push:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Use `supabase db push --include-all` if the remote has migrations not present locally.

### 4. Storage buckets

Schema/migrations create buckets such as: approved designs, payment screenshots, order invoices, contact-book photos, team chat files, order customer assets, order-template images. Ensure storage policies applied (included in schema/migrations).

### 5. Auth users

Create users in **Supabase Auth**, then set roles:

```sql
-- Promote to admin (or use admin_emails table per schema)
update public.profiles
set role = 'admin'
where id = 'USER_UUID_HERE';
```

Deploy the create-user edge function when using in-app user creation:

```bash
npm run deploy:admin-create-user
```

### 6. Run locally

```bash
npm run dev
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
| Home | `home` | Dashboard home |
| Printing Orders | `printing` | Main order list + reports sub-tabs |
| Printing department | `printing_department` | Priority queue |
| Billing | `billing` | Invoices |
| Dispatch | `dispatch` | Verification |
| Ready Stock Order | `regular` | Placeholder |
| Production tracker | `production_tracker` | Production jobs |
| **Shared Links** | `shared_links` | Above Contact Book |
| Contact Book | `contact_book` | |
| Asset Management | `asset_management` | Placeholder |
| Audit | `audit` | Placeholder |
| Chat | `chat` | Team chat |

Tab visibility and edit rights are configurable per viewer in the admin panel.

---

## Order data (high level)

- Order / delivery dates, customer, owner, coordinator  
- Product, colors, size breakdown, qty, printing metres  
- **Order cost** and **printing cost** (for revenue reports)  
- Payment method, delivery method, payment proof uploads  
- Mockups / approved designs / customer assets  
- Production order flag and expected handover to printing  
- Dispatch verification fields, invoice URL (billing)  
- Status, remarks, activity log  

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server (`.env.development` ? staging) |
| `npm run dev:staging` | Dev server with Vite `staging` mode (`.env.staging`) |
| `npm run build` | Production build ? `dist/` |
| `npm run preview` | Preview production build |
| `npm run deploy:admin-create-user` | Deploy Supabase edge function |
| `npm run icons:transparent` | Regenerate transparent app icon assets |

---

## Notes

- **Repository folder name** may still be `Printing Live Tracker`; the product name is **Scott Dashboard**.  
- **package.json** `name` is still `printing-live-tracker` for compatibility; rename locally if you prefer alignment with the new branding.  
- Apply new migrations after pulling: `supabase db push`.  
- Status tones require a user gesture in the browser once (autoplay policy); users can disable tones in the admin user settings.

---

## License

Private / internal use unless otherwise specified by the project owner.
