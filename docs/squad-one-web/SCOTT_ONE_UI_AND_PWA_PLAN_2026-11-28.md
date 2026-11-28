# Squad One web → Scott One UI + installable PWA · implementation plan

Prepared 28 November 2026. Plan only — nothing below has been implemented yet.

**Goal.** On a phone, opening a Squad One staff persona (`/squad/*`) should feel like opening the native Scott One app: home-screen icon, no browser chrome, branded launch, native header + floating dock, sheets instead of dialogs, warm SC1 surfaces, native icon family, fast cold start and graceful offline. The native customer/dealer app is the **design language source** only.

**Persona scope (revised 28 Nov).** Customer (3) and Dealer (10) are **out of scope** — they already have the native app, and their web screens are left exactly as they are. Work starts with **Sales Coordinator (1)**, then the remaining staff personas in the order in §4. The rest of the dashboard is not the target.

---

## 0. What exists today (verified)

| Area | Current state | Where |
| --- | --- | --- |
| **UI kit** | Scott One UI foundation v0.1: `tokens.json/css` (scoped `.sc1`), `styles.css`, `components.jsx` (Surface, Button, IconButton, Field, SearchField, ChoiceGroup, Checkbox, Switch, Tabs, Card, Badge, Notice, EmptyState, Skeleton, Avatar, PersonRow, OrderCard, ProductCard, OptionCard, ProgressSteps, Accordion, Dock, Sheet), `Icon.jsx` (26 native icons), AUDIT, verify script. **Untracked** files. | `~/.codex/worktrees/persona-ui-vercel/Printing-Tracker/apps/admin/src/scott-one-ui/` + `scott-one-ui-kit.html` |
| **Latest Squad web code** | Branch `codex/persona-ui-vercel-20261127` @ `31b9e12b` (Flutter-matched persona nav, order board, review screens). | Same Codex worktree |
| **This checkout** | Branch `codex/customer-dealer-native` @ `bc8226b3`, older Squad web code + many uncommitted changes (and the React Native app that the kit was derived from). | `SC1/Printing-Tracker` |
| **Squad shell** | `SquadShell.jsx` = shadcn `Sidebar` + 68px topbar + theme toggle + env switcher; `PersonaChrome.jsx` = flat bottom tab bar (Flutter SVG masks) + right `Sheet` drawer; `squad.css` = shadcn HSL tokens, 10px radii, tables. | `apps/admin/src/squad/` |
| **Personas** | 11 roles from `persona-ia.json`: Admin 0, Sales Coord 1, Prod Coord 2, **Customer 3**, Factory Mgr 4, Dispatch 7, Inspector 8, Cutting Master 9, **Dealer 10**, Job Worker 11, Assistant/Team 12. | `navigation/persona-ia.json`, `registry.js` |
| **UI primitives used by Squad** | shadcn `@/components/ui/*` (button, dialog ×10 files, sheet, tabs, select, input, table…) + `squad-*` classes. ~4.8k lines across `src/squad/**/*.jsx`. | |
| **PWA** | `manifest.webmanifest` = “Printing Live Tracker”, `start_url: /`, black background, red `#b91c1c` theme, one `brand-logo.png` used for 192 & 512 (no maskable). `sw.js` deletes all caches and network-forwards navigations only — **no offline, no app shell, no update UX**. `index.html` titled “Dashboard”, apple title “Print Tracker”. SW is skipped on localhost. | `apps/admin/public/`, `index.html`, `src/main.jsx` |
| **Hosting** | Vercel; `/squad/:path*` and `/account/:path*` rewrite to `/index.html`; HTML `max-age=0`, `/assets/*` immutable. | `vercel.json` |
| **Native assets available** | `icon.png`, `splash-icon.png`, adaptive foreground/monochrome, `round_logo.svg`, `splash-mark.png`, `launcher-source.png`. | `apps/mobile/assets/`, `assets/brand/` |

---

## 1. Decisions to confirm before coding

| # | Decision | Recommendation (default if no answer) |
| --- | --- | --- |
| D1 | **Base branch.** The kit and newest Squad code live in the Codex worktree; this checkout is older and dirty. | New branch `feat/scott-one-pwa` cut from `codex/persona-ui-vercel-20261127`, first commit = the untracked kit as-is. Don't touch the dirty `customer-dealer-native` checkout. |
| D2 | **Installed app identity.** | Name “Scott One”, short name “Scott One”, icon = native `icon.png` / adaptive foreground + maskable variant, theme/background `#F4F3EF`. Dashboard keeps “Print Tracker”. |
| D3 | **Separate install for Squad vs dashboard.** | Yes: a dedicated `squad.html` entry + `squad.webmanifest` with `scope: /squad/`, `start_url: /squad/home?source=pwa`. One shared service worker at `/`. |
| D4 | **Dark mode in Squad on phones.** Kit is light-only by design. | Squad uses SC1 light on all viewports; hide the theme toggle inside Squad. Dashboard dark mode untouched. |
| D5 | **Offline scope.** | App shell + last-viewed screens readable offline (stale banner); **no offline writes** (orders, payments, stock stay server-authoritative). |
| D6 | **Staff personas on desktop.** | Sidebar stays for ≥1024px, restyled with SC1 tokens (15rem rail per kit). Mobile = dock for every in-scope persona. |
| D7 | **Customer & Dealer on web.** | Untouched. A single `sc1Enabled(identity)` gate (role ∉ {3, 10}) decides whether the new shell, theme bridge and SC1 skin apply; roles 3/10 keep today's `SquadShell`/`PersonaChrome`. Same gate drives a per-persona rollout flag (§5), so personas are switched on one at a time. |
| D8 | **Rollout switch.** | `squad.sc1Personas` setting (env default + `?sc1=1/0` override, like the existing `?persona=` flag). Starts as `[1]`; each persona is added when its pass is approved. |

---

## 2. Architecture

### 2.1 Theme layering (no global restyle)

1. Import `scott-one-ui/index.js` CSS once inside `SquadApp` (lazy chunk → dashboard bundle unaffected). Everything below applies only when `sc1Enabled(identity)` is true (D7) — Customer/Dealer render the current shell with no `.sc1` class, so none of the scoped CSS reaches them.
2. Root becomes `<div class="squad-app sc1" data-sc1-skin="…">`. Skin per route: commerce (catalogue, orders, cart), account (profile, people, addresses, notifications), studio (configurator), core (staff operations), auth (login/account flows).
3. **Scoped shadcn bridge** `squad/sc1-bridge.css`: inside `.squad-app.sc1` only, map shadcn HSL variables to SC1 (`--background` → canvas, `--card` → paper, `--primary` → `#C8191F`, `--foreground` → ink, `--muted-foreground` → text-secondary, `--border` → line, `--ring` → primary, `--radius` → 0.875rem) and set the system font stack. This instantly re-skins every untouched shadcn control in Squad without touching the dashboard. (The kit's warning is about *global* aliasing; this is scoped.)
4. Replace `squad.css` values with SC1 tokens (radii 14/16/22/28/40, spacing 4–32, type roles) — keep class names so feature files don't churn.
5. Then convert screen-by-screen to kit components where the pattern matches (section 4).

### 2.2 Mobile app shell (≤767px; tablets 768–1023 use same shell with 2-column content)

New `squad/shell/` replacing the phone branch of `SquadShell`:

- **`AppHeader`** — native PersonaShell geometry: 76px home header with red SC1 wordmark (27/34/700, `assets/mark.png` mask) on tab roots; 56px compact header with **compact back chevron + title** on pushed screens (per native back-button standard); right side = notifications bell (with count) + account avatar → Account sheet. Sticky, `padding-top: env(safe-area-inset-top)`, canvas background, hairline border on scroll only.
- **`Dock`** (kit) — floating translucent pill, radius 40, 64px items, 12px labels, `env(safe-area-inset-bottom)`, max 5 items. Tabs come from existing `tabsFor(identity)`; icons from kit `Icon` where a native glyph exists (home, categories, orders, customers, account, bag), else Flutter `squad-icons` masks restyled to 1.8-stroke weight. Badge counts via `count`.
- **Drawer → Account sheet.** Replace the right `Sheet` with a kit `Sheet` (bottom on phones) styled like native `AccountUI` (avatar 76, r22 cards, 64px rows): profile, drawer items, “More”, environment switcher (admins only), sign out.
- **Navigation model**: `tab-root` / `pushed` / `modal` presentation per route (add `presentation` to registry). Back on pushed screens uses `history.back()` with fallback to tab root. Per-tab **scroll restoration** and last-visited sub-route memory, so switching tabs feels like native tab stacks.
- **Transitions**: View Transitions API (`document.startViewTransition`) — push = slide-in from right 180ms, tab switch = cross-fade 120ms; disabled under `prefers-reduced-motion` and when unsupported.
- **Write/test notices** become a slim pill under the header instead of a full-width bar.
- **FAB** (`squad-fab`) repositioned above the dock (`bottom: calc(dock + 16px + safe-area)`), red, 56px.
- Desktop ≥1024: keep `SidebarProvider` but SC1-styled; no dock.

### 2.3 Native-feel CSS/behaviour checklist (all scoped to `.squad-app`)

- `height: 100dvh`, body `overscroll-behavior: none`, inner scroller `overscroll-behavior-y: contain`.
- `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` (kills 300ms/double-tap zoom), `user-select: none` on chrome only (not content).
- Inputs ≥16px (kit already) → no iOS focus zoom; `viewport-fit=cover` already present; never set `maximum-scale`.
- `:hover` styles wrapped in `@media (hover: hover)`; `:active` pressed states (scale .98 / soft fill) for touch feedback.
- Skeletons (kit `Skeleton`) for every first load instead of spinners; keep previous data during refetch.
- Dialogs → bottom sheets on phones (kit `Sheet` already switches at 560px). Migrate the 10 Squad files using shadcn `dialog` via a `SquadDialogContent` adapter so call sites barely change.
- Keyboard: pinned footers lift above the on-screen keyboard (`visualViewport` resize listener → CSS var).
- Pull-to-refresh on list tab roots (orders, customers, products, tasks): custom gesture that triggers the existing React Query `refetch`; disabled when not at scroll top.
- Optional: `navigator.vibrate(10)` on Android for confirm actions (no-op on iOS).

---

## 3. Progressive Web App

### 3.1 Entry & manifest

- `apps/admin/squad.html` — copy of `index.html` with: title “Scott One”, `theme-color #F4F3EF`, `apple-mobile-web-app-title "Scott One"`, `apple-mobile-web-app-status-bar-style "default"` (light canvas), `apple-touch-icon` 180px, iOS `apple-touch-startup-image` set (generated per device size, `media` queries), `<link rel="manifest" href="/squad.webmanifest">`. Same `src/main.jsx` bootstrap.
- Vite `build.rollupOptions.input = { main: index.html, squad: squad.html }`.
- `vercel.json`: rewrite `/squad/:path*` → `/squad.html` (keep `/account/:path*` → index). Add `Cache-Control: no-cache` for `/sw.js` and `/*.webmanifest`, `Service-Worker-Allowed: /` for sw.
- `public/squad.webmanifest`:
  `id: "/squad/"`, `name/short_name: "Scott One"`, `start_url: "/squad/home?source=pwa"`, `scope: "/squad/"`, `display: "standalone"`, `display_override: ["standalone"]`, `orientation: "portrait"`, `background_color/theme_color: "#F4F3EF"`, icons 192/512 `any` + 192/512 `maskable` (safe-zone padded), `shortcuts` (Orders, Products, Notifications — filtered client-side by role is not possible in manifest, so pick routes every persona can reach or omit), `screenshots` (narrow, for Android richer install UI).
- Root dashboard manifest left as is (optionally fix its icon sizes later).

### 3.2 Icons & splash (script, committed outputs)

`scripts/generate-pwa-assets.mjs` (uses existing `jimp` dev dep): from `apps/mobile/assets/brand/launcher-source.png` / `adaptive-foreground-candidate.png` produce `public/pwa/icon-192.png`, `icon-512.png`, `maskable-192/512.png`, `apple-touch-icon-180.png`, favicon, and iOS startup images (red mark centered on `#F4F3EF`, matching native `splash-icon.png`) for current iPhone/iPad sizes. Record provenance in `public/pwa/PROVENANCE.md`.

### 3.3 Service worker (replace `public/sw.js`)

Hand-written, versioned SW (no new dependency; or `vite-plugin-pwa`/Workbox if preferred — decision at implementation, default hand-written + build-time precache manifest injected by a tiny Vite plugin):

| Request | Strategy |
| --- | --- |
| Navigations under `/squad/` | Network-first (3s timeout) → cached `squad.html` → `offline.html` |
| Other navigations (dashboard) | Network-only (preserves today's “always fresh order list” behaviour) |
| `/assets/*` hashed JS/CSS | Precache Squad shell chunks at install; cache-first for the rest |
| Icons, fonts, `/squad-icons`, `/pwa` | Cache-first |
| Supabase Storage / product & banner images | Stale-while-revalidate, LRU cap (~200 entries / 60 MB), opaque responses excluded |
| Supabase REST/RPC/Auth/Realtime, `/api/*` | **Never cached** by SW (auth tokens, write-state, prices) |

- **Update flow**: new SW waits; app shows a kit `Notice` toast “A new version of Scott One is ready — Reload”; on tap → `postMessage('SKIP_WAITING')` → reload on `controllerchange`. Check for updates on focus/visibility change and every 30 min while open.
- Migration from old SW: same `/sw.js` URL so it upgrades in place; activation clears only legacy cache names.
- Keep localhost unregister logic but allow `?sw=1` to test the SW in dev/preview.

### 3.4 Data offline/resilience (read-only)

- Persist React Query cache for Squad (`@tanstack/query-sync-storage-persister` or IndexedDB) for last-viewed lists/details, 24h max age, keyed by user id + environment; cleared on sign-out.
- `navigator.onLine` + fetch failures → kit `Notice` “You're offline — showing saved data from 10:42” and disable write actions.
- `offline.html` branded fallback for cold starts with no cache.

### 3.5 Install experience

- `useInstallPrompt` hook: captures `beforeinstallprompt` (Android/Chrome/Edge); detects iOS Safari non-standalone and shows a one-time bottom sheet with Share → “Add to Home Screen” illustration. Show after first meaningful action (e.g. second visit or after login), dismiss memory 14 days; never inside standalone mode.
- Detect standalone (`matchMedia('(display-mode: standalone)')` / `navigator.standalone`) → add `data-standalone` on root to tweak header padding and hide any “open in app” hints.
- Auth persistence check: Supabase session must survive iOS standalone launches (separate storage container from Safari on iOS → users log in once inside the installed app; document this in onboarding copy).

### 3.6 Later / optional

Web push (Supabase/FCM web) for order and assignment notifications, app badging (`navigator.setAppBadge`), share target for catalogue images. Out of scope for v1 unless requested.

---

## 4. Persona-by-persona UI conversion

Order: **Sales Coordinator first**, then personas in order of how many SC screens they reuse (each later pass gets cheaper). Customer (3) and Dealer (10) are excluded. None of these roles has a native screen to copy, so the native app supplies the *vocabulary* (header, dock, cards, sheets, type, colour) and the existing Flutter staff screens supply *layout and content*.

Rules for every screen: keep data hooks, permissions (`canVisit`, capabilities), server search and pagination untouched — components are presentational only. Every screen ships loading / empty / error / denied / offline states with kit components. Tables become card lists below 1024px; tables stay on desktop.

### 4.1 Sales Coordinator (role 1) — the reference persona

Dock (5): **Orders · Customers · Distributor · Products · To Do's**. Account sheet: Milestone, Tasks Roles & Goals, Catalogues, Promotional Assets, then Reports, Notifications, My account, Sign out.

| # | Screen | Files | Treatment |
| --- | --- | --- | --- |
| SC-1 | Shell for role 1 | `SquadShell`, `PersonaChrome`, `SquadApp`, new `squad/shell/*` | Header with wordmark on tab roots, compact back on pushed screens, bell + avatar; floating `Dock` with the 5 tabs (labels fit at 320px: “Sales Co-ord.” style short labels, icon-only fallback < 340px); account `Sheet` replaces the right drawer |
| SC-2 | Orders board | `orders/OrderBoard`, `orderBoardModel`, `components/parity/parts` (`OrderCounters`, `OrderCard`) | Title 28/700; counters → horizontally scrolling metric chips (tap = drill-down); one row `SearchField` + filter `IconButton` → filter `Sheet` with `ChoiceGroup`; status chips; kit `OrderCard` (customer + distributor names wrap) in a single column on phones |
| SC-3 | Filtered orders & order detail | `filteredOrders/FilteredOrdersPage`, `orders/OrdersPage`, `orders/CommerceUI`, `PaymentInstructions`, `RatingsPanel` | Pushed screen with back; ink hero summary card r22, `ProgressSteps` for status, product `Accordion`s with size insets, payment `Badge`, pinned action footer for SC actions |
| SC-4 | Customers list & customer detail | `customers/CustomersPage`, `CustomerOrders`, `customerDirectoryModel`, `useDirectoryPosition`, `people/AddressBook`, `components/AccountContacts`, `ContactActions` | `SearchField`; `PersonRow` (initials avatar 44/r16, business name 17, relationship meta); detail = account-skin cards (contacts with call/WhatsApp `IconButton`s, addresses, recent orders as `OrderCard`); FAB “Add customer” above dock |
| SC-5 | Distributors | `CustomersPage` (distributors mode), `DistributorCustomers` | Same pattern as SC-4; distributor → its customers as a pushed list |
| SC-6 | Products | `catalogue/CataloguePage`, `ProductGallery`, `CatalogueFilters`, `ProductShareDialog`, `ProductReferenceImages` | Search 52/r13 + filter sheet; category covers (cover), `ProductCard` grid 2-up (contain); product detail as pushed screen with image gallery and share as bottom sheet |
| SC-7 | To Do's | `work/WorkPage`, `WorkSelectors` | Task cards r16, segmented `ChoiceGroup` (Open/Done), `Checkbox` rows, add-task `Sheet` with `Field`s |
| SC-8 | Milestone / targets | `work/TargetsPage` | Metric cards + `ProgressSteps`/progress bars, period `ChoiceGroup` |
| SC-9 | Tasks, Roles & Goals | `work/WorkPage` (goals) | Same as SC-7 |
| SC-10 | Catalogues | `documents/DocumentsPage`, `PdfShareDialog`, `TermsAttachmentField`, `cataloguePreferences` | Document rows, `Switch` rows, segmented controls; share/download in a sheet |
| SC-11 | Promotional assets | `promotions/PromotionsPage`, `components/Media` | Media grid (cover thumbnails), viewer as full-screen sheet, share action |
| SC-12 | Reports, Notifications, My account | `reports/ReportsPage`, `ReportExport`, `notifications/NotificationsPage`, `profile/ProfilePage` | Reports: metric cards + export sheet; inbox cards r22; account skin profile (avatar 76, 64px rows) |

**SC exit gate:** every row above reviewed on a phone (390 & 360 wide) and installed PWA, signed off by you, then role 1 stays on and the next persona starts.

### 4.2 Remaining personas (new work per persona only; shared screens already done)

| Order | Persona | Dock | Already covered by SC pass | New screens to convert |
| --- | --- | --- | --- | --- |
| 2 | **Admin (0)** | Customers · Sales Co-ord. · Prod. Co-ord. · Products · To Do's | Customers, Products, To Do's, Catalogues, Promotions, Reports | `coordinators/CoordinatorsPage` (sales/production lists, `coordinatorModel`), `coordinators/AdminExtras` (Personas, Force complete), `customers/ChangeScPage`, `people/CoordinatorRequests`, `administration/*` (sync products, settings, integrations, transfers, operations — desktop-heavy; phone = card lists + sheets) |
| 3 | **Production Coordinator (2)** | Orders · Customers · Factory · Sales Co-ord. · To Do's | Orders, Customers, Sales Co-ord. list, To Do's | Factory list (`coordinators` factory mode), production views reached from orders (`production/ProductionPage`, `OperationsUI`) |
| 4 | **Factory Manager (4)** | Orders · Tailors · Delivery · To Do's | Orders, To Do's | `factory/FactoryTabs` (Tailors, Delivery, `QueueStats`, `EfficiencyGauge`), `production/TailorWorkPanel` |
| 5 | **Job Worker (11)** | Orders · Products · To Do's | Orders, Products, To Do's | `jobWork/JobWorkPage`, “Your Efficiency” gauge in account sheet |
| 6 | **Assistant Worker / Team (12)** | Products · To Do's | All | Shell only (2-tab dock) |
| 7 | **Dispatch Incharge (7)** | Orders(→ production) · Tailors | Tailors | `production/ProductionPage` dispatch quantities/destinations, stock reconciliation if reachable |
| 8 | **Inspector (8)** | Job Sheets · Tailors | Tailors, production views | Job sheet inspection progress (`ProductionPage` inspector mode) |
| 9 | **Cutting Master (9)** | Orders(→ production) | Production views | Partial cutting entry forms (sheet + `Field`s, pinned save) |

Each persona = its own PR, enabled by adding the role to `squad.sc1Personas` after review.

---

## 5. Sequencing & deliverables

1. **Branch + kit commit** (D1). Verify kit build and `generate.mjs --check`.
2. **Foundation PR**: import kit in Squad behind `sc1Enabled` (D7/D8), `sc1-bridge.css`, SC1 values in scoped `squad.css`, hide dark toggle for enabled personas. Role 1 only. Before/after screenshots at 390px for every SC tab; screenshots of a Customer and Dealer account proving they're unchanged.
3. **Shell PR** (SC-1): header, dock, account sheet, presentation model, transitions, scroll restoration, sheet adapter for dialogs.
4. **PWA PR** (§3): `squad.html`, manifest, assets script + outputs, new SW + update toast, offline page, install prompt (shown only to enabled personas), `vercel.json`, React Query persistence.
5. **Sales Coordinator screen PRs** (SC-2 … SC-12), grouped: Orders (2–3) → Customers & Distributors (4–5) → Products (6) → Work (7–9) → Content (10–11) → Account & reports (12). SC exit gate.
6. **Persona PRs** in §4.2 order: Admin → Production Coordinator → Factory Manager → Job Worker → Assistant/Team → Dispatch → Inspector → Cutting Master.
7. **Cleanup**: remove dead `squad-*` styles and the old bottom bar for enabled personas, drop `?sc1=0`/`?persona=0` fallbacks once every staff persona is approved. Customer/Dealer code paths stay.

Each step is independently deployable to staging (`develop` → staging Supabase/Vercel preview) and reversible by removing the role from `squad.sc1Personas`.

---

## 6. Verification

- **Automated**: existing `node --test` model tests (extend `personaNav.test.mjs` for `sc1Enabled`); kit `verify.mjs`; new Puppeteer script `scripts/verify-squad-mobile.mjs` signing in with staging test accounts per enabled persona, capturing 390×844 and 360×800 screenshots of every tab root, the account sheet and one pushed screen; asserts no horizontal overflow, dock + header present, 44px targets, no shadcn default colours leaking. Also asserts Customer/Dealer DOM has no `.sc1` root.
- **PWA**: Lighthouse/DevTools installability (manifest valid, SW controls `/squad/`, maskable icon), offline reload of `/squad/orders`, update-toast flow across two builds.
- **iOS**: iOS Simulator Safari → Add to Home Screen → launch as Sales Coordinator: standalone, splash, status bar, safe areas, keyboard + pinned footers, session persistence, portrait lock.
- **Android**: Chrome install prompt, maskable icon shape, system back vs in-app back.
- **Visual consistency**: side-by-side with the native app's shared vocabulary (header, dock, order card, sheets, account rows) — not screen parity, since staff screens have no native twin.
- **Regression**: dashboard (`/`) unchanged — screenshot diff of 3 dashboard tabs; dashboard navigations still network-only; Customer and Dealer web screens unchanged.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Shared files (`SquadApp`, `OrderBoard`, `CustomersPage`) also serve Customer/Dealer | Branch on `sc1Enabled` inside the component; regression screenshots for roles 3/10 in every PR. |
| Parallel Codex work on the same Squad files / dirty checkouts | Own branch from the worktree tip; small PRs; rebase often. |
| SW caching stale business data or auth | Never cache Supabase/API; HTML network-first; versioned caches; kill-switch: deploy SW that unregisters itself. |
| iOS standalone storage separate from Safari → re-login | Expected; mention in install sheet. |
| shadcn components with hard-coded Tailwind colors bypass the bridge | Grep for `bg-slate`/`text-gray`/hex in `src/squad`, fix during each screen PR. |
| Dock with 5 long labels (Sales Co-ord., Prod. Co-ord., Distributor) at 320px | 12px labels, wrap to icon-only under 340px with `aria-label`. |
| Bundle size on cold start | Kit CSS + shell in Squad chunk; precache; lazy feature routes already in place. |

---

## Progress log

**28 Nov — branch, foundation and shell (SC-1), on `feat/scott-one-pwa` from `ff6f7047`.**
Done: `sc1Enabled` gate (role 1 by default, `VITE_SQUAD_SC1_PERSONAS`, `?sc1=1/0`; 3 and 10 never), scoped theme and shadcn bridge, phone header with Back, floating dock, account sheet, light-only, scroll restore on Back, phone bottom-sheet styling for `SquadDialogContent`.
Checked with stubbed data at 320, 375 and 1280 wide. Not checked: real staging data or login, a physical phone, dialog bottom sheets (writes were off).
Deferred: page transitions, notification count, pull-to-refresh, tablet (768–1023) dock (tablets keep the sidebar).

**28 Nov — Sales Coordinator Orders (SC-2, SC-3).** `features/orders/Sc1Orders.jsx`: order cards, title + search + filter sheet (type, sort; date range on filtered list), status chips, ink detail card with progress, item cards, action grid. Enabled personas only. Checked with stubbed data at 375 and 1280 wide; payment/edit dialogs not opened (writes off). Item detail still uses the table and select.

**28 Nov — Sales Coordinator Customers and Distributors (SC-4, SC-5).** `features/customers/Sc1Customers.jsx`: list cards, title + search + filter sheet, profile hero with contact actions, order cards on profiles, linked-customer cards. Fixed: the Distributor tab (`/squad/distributors`) listed customers; it now lists distributors for every role that has it. For enabled personas the + button adds an account and "Train Customer" is a labelled button. Checked with stubbed data at 375 wide; nothing was saved. Address book, relationship and access panels, add/edit forms and profile order filters keep their old layouts (theme only).

**28 Nov — Sales Coordinator Products (SC-6).** `features/catalogue/Sc1Catalogue.jsx`: title + search + filter sheet, compact "order for" row, type chips, two-up product tiles, share-select mode, sticky selection button, ready-made variant cards with quantity stepper. Checked with stubbed data at 375 wide (no real images). The custom product studio, saved-design configurator, quote review/checkout and product image gallery keep their old layouts (theme only).

**28 Nov — Sales Coordinator To Do's, Roles & goals, Milestone (SC-7 to SC-9).** `features/work/Sc1Work.jsx`: title + search + filter sheet, status chips, task cards with a round complete control (still confirms first), target cards with completion bar, 2x2 progress metrics, + button where the role can create and changes are allowed. Checked with stubbed data at 375 wide; nothing was saved. Task/goal/target forms and assignee/order pickers keep their old layout inside bottom sheets.

**28 Nov — Sales Coordinator content and account (SC-10 to SC-12).** `shell/Sc1Page.jsx`: notification cards, profile header + sign out, promotional assets title/chips/filter sheet, report tab rail, Catalogues title. All Squad tables render as one card per row on phones for enabled personas (`data-label` on `DataTable` cells). Catalogue create/detail forms, report period/filter forms and profile form keep their old layout. Checked with stubbed data at 375 wide.

**28 Nov — PWA (§3).** `squad.html` + `squad.webmanifest` (scope `/squad/`), icons and iOS splash from `square-icon-candidate.png` (the plan's `icon.png`/`splash-icon.png` are Expo placeholders), hand-written `sw.js` (app files only; no API, auth or business data; dashboard navigations untouched), `offline.html`, update/offline/install UI for enabled personas, installed-app sign-in, writes refused while offline, `vercel.json` rewrite to `squad.html`.
Checked on a local production build: worker active, files cached, update waits then switches, offline relaunch reaches the sign-in screen.
**Differs from §3.4:** business data is not persisted on the device, so a cold offline launch cannot show earlier orders; it needs a decision plus session-handling changes.
Not checked: install and launch on a real iPhone/Android, Lighthouse, a Vercel preview. Netlify config has no `/squad` rewrite (none existed before).
