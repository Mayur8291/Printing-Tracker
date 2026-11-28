# SCOT1 native-to-web audit

Audited 28 November 2026. Source of truth for this task: the current React Native working files at `/Users/kundan9595gmail.com/Desktop/Development/SC1/Printing-Tracker/apps/mobile`.

The release worktree used for the web task contains an older mobile scaffold. It was **not** used as the design reference. The original checkout includes uncommitted mobile work; source hashes in `source-manifest.json` pin the actual files read rather than suggesting that a Git revision captures those changes. No native source files were modified.

The manifest indexes 184 UI-bearing TSX modules plus theme, policy and brand provenance/assets. Indexing records exported components, style presence and file hashes. It is a structural inventory, not a claim of manually exercising every screen. Detailed visual review focused on shared primitives, commerce, orders, home/catalogue, account/authentication, customers, addresses, document controls and the configurator. Existing local home-header and order-detail captures were inspected as supplementary evidence; they were not treated as proof of a current installed release.

## Product and persona boundary

`src/features/policy/persona.ts` defines native roles **3 (customer)** and **10 (dealer)**. The current shell gives the customer home/categories/orders/cart and the dealer home/categories/placed orders/my orders/customers. Account is a separate header destination. The shell's visible dock filters destinations; not every destination appears as a separate dock item.

Other roles receive a staff-web handoff. Admin, Sales Coordinator, Production Coordinator, Factory Manager, Dispatch Incharge, Inspector, Cutting Master, Job Worker and Assistant Worker/Team therefore do not have corresponding full native operational screens to copy. The kit can unify their visual treatment, but desktop operational density, tables and navigation require a later web design pass. Distributor identity can appear on orders; this does not establish a native distributor persona.

## Design anatomy and source mapping

All paths below are relative to the source mobile directory.

| Native source | Observed vocabulary | Foundation representation |
| --- | --- | --- |
| `src/ui/theme.ts` | Warm canvas, core ink/muted, two distinct reds, 4–32 spacing, radius 16/14/48; six type roles | Exact primitive palette, spacing, six core type styles |
| `src/ui/index.tsx`, `BackButton.tsx` | 48px buttons, 52px fields, visible labels, text read-only values, resource states | Button, Field, IconButton, EmptyState, Notice |
| `src/ui/Icon.tsx` | 26 custom SVG symbols; 24 grid, stroke 1.8, rounded joins/caps | Direct SVG geometry port; decorative icons hidden from screen readers |
| `src/ui/GlassSurface.tsx` | Radius40; translucent light/brand fills; white highlight; shadow y5/r16/opacity.14 | Dock light material; no invented native blur |
| `src/ui/Shimmer.tsx` | `#EAECF0`, 1250ms sweep, reduced-motion and app-state handling | Skeleton; web limited-pass animation and reduced motion |
| `src/ui/Sheet.tsx`, `src/features/cart/ShoppingSheet.tsx` | Sheet radius28, handle36×4, title/close, scrolling body, anchored footer, scrim | Native web dialog with responsive sheet geometry |
| `src/shell/PersonaShell.tsx` | Wordmark27/34/700; home header76; action48; dock items64; label12; translucent active surface | Wordmark token, native icon family, Dock, native-role documentation |
| `src/features/home/BrandHomeScreen.tsx` | Search52/r13, gutter12, brand avatars56, category mosaic gap4, title20 | Home gutter token; catalogue/image/layout guidance; not a cloned Home screen |
| `src/features/catalogue/CatalogueScreen.tsx` | Product cards r16/p8, square imagery r10, contained products; category covers r18 | ProductCard, image rules, shared search/filter primitives |
| `src/features/catalogue/CategoryBrandsScreen.tsx` | Collection rail, search48/r16, product r12/p6, cover imagery, selection24, dark selection tray | Shared primitives; collection cover imagery is an observed exception to the kit’s default contain rule. Bulk-selection behavior stays in its feature |
| `src/features/orders/OrdersScreen.tsx` | Title28; gutter18; search50/r14; chips44/r22; card r22/p16; status11; inset dates r12 | Page type, search, ChoiceGroup, OrderCard, Badge |
| `src/features/orders/OrderDetailScreen.tsx` | Ink hero r22/p18; inverted metadata; amount23; subtle divider; product cards | Inverse Card, amount role, detail-sheet demonstration |
| `src/features/orders/OrderProgressCard.tsx` | Card r22/p20, title18, progression markers28, thin connectors, small progress strip | General ProgressSteps and progress guidance; not a pixel-identical timeline port |
| `src/features/orders/OrderProductCard.tsx` | Product identity, count/size inset, subtotal, disclosure | ProductCard/Accordion/size breakdown composition |
| `src/features/cart/PurchaseChrome.tsx` | Paper `#FFFEFB`; ink `#181A1B`; muted `#6F716D`; soft `#ECEBE5`; red action52/r16; dark progress18 | Commerce skin, purchase Button, ProgressSteps, inverse summary |
| `src/features/cart/*QuantityScreen.tsx` | Size rows, quantity fields, quote/stock messaging, totals | Field/Notice/summary primitives; quantity business logic remains in app |
| `src/features/people/CustomersScreen.tsx` | White r16 cards, initials44/r16, red tint, business name17, relationship metadata | Avatar, PersonRow, core Card, name-first order adaptation |
| `src/features/addresses/AddressScreen.tsx` | White address r22/p20, default indicator, editable fields, searchable location selection | Account Card, Field/select, SearchField, Sheet; server picker behavior not cloned |
| `src/features/account/AccountUI.tsx` | Separate ink `#191C1B`, line `#E2E1DB`, muted `#6D716D`; r22/p18 cards, row64; avatar76 | Account skin, account Card, profile Avatar, person/disclosure rows |
| `src/features/account/AuthUI.tsx` | White canvas; ink `#202124`; muted `#687078`; headline28/34/800; field60/r14; action54; max440 | Auth skin, auth type/size tokens, labelled Field, Button, bounded column |
| `src/features/configurator/StudioUI.tsx` | White canvas; r14/p16 cards; soft `#F7F6F4`; underline tabs; r12 choices, red selected border; 22px selection indicator | Studio skin, Tabs, OptionCard, Card; responsive examples |
| `src/features/configurator/ParityUI.tsx` | Earlier denser r8 selection tiles and specialized garment icons | Indexed legacy source; not promoted as the default next-web direction |
| `src/features/documents/CatalogueUI.tsx` | Secondary actions44, switch row52, segmented controls44, restrained secondary type | Switch, ChoiceGroup segmented, IconButton |
| `src/features/notifications/InboxScreen.tsx` | Cards r22/p18; title17, body16/24, readable state/error text | Account-style cards and Notice; no invented notification backend |
| `src/features/feedback/FeedbackScreen.tsx` | Success disc60, green wash, title25, saved response inset | Success Notice and EmptyState vocabulary; rating and response workflow deferred |
| `src/features/stock/DealerStockScreen.tsx` | Shared core palette, r16 bordered stock cards, title26 | Core card/type vocabulary; no web stock feature rebuilt |

## Full UI inventory by family

The manifest lists each indexed source module and its exported symbols. Related screens share the components above rather than needing one duplicate kit component per screen.

| Family | Indexed modules | Coverage and remaining specialized work |
| --- | ---: | --- |
| Shared UI / shell / app | 17 | Primitives, icons, sheets, skeleton, navigation, keyboard/layout helpers; native safe areas translate to CSS env insets where relevant |
| Account, account closure, profile | 12 | Forms, avatar, account cards, confirmation/notices. Camera/photo crop and closure workflows remain product features |
| Home / catalogue | 14 | Search, category/product tiles, hierarchy, imagery. Brand rails, editorial carousel and grouped search need route composition |
| Cart / dealer checkout / payment | 20 | Progress, fields, size rows, totals, notices, actions. Quotes, payment proofs and payment terms remain application-owned |
| Orders / order item / linked orders | 11 | Order identity, facts, party names, status, detail disclosure and progress. Full mixed-order timelines and bulk preparation remain route work |
| Configurator / presets | 41 | Tabs, options, swatches, inputs and footers. 3D/garment canvas, reference crop, upload, fonts, printing zones and dimensional controls are specialized tools |
| People / addresses | 10 | Person rows, initials, read-only identity, forms, location selection pattern |
| Documents / product share / promotions | 11 | Document rows, segmented choices, switches, progress/status. PDF rendering/sharing contracts remain intact |
| Fulfillment / delivery & dispatch history | 12 | Shared cards, quantity rows, warnings, confirmation and progress. Dispatch/cancellation permissions not modeled |
| Feedback / support / inbox | 12 | Notices, state cards, readable responses; rating, chat/composer and attachments need feature-specific integration |
| Commerce recovery / recovery / updates / launch / policy / stock / coordinator / workspace | 15 | Resource/error states, read-only handoff and updates; launch animation and operational dashboards outside core kit |
| Platform UI | 9 | Indexed connectivity, image, error-boundary helpers; use semantic states rather than duplicating platform infrastructure |

Counts refer to static UI-bearing modules, not screens or polished component counts. The source manifest is authoritative if a family is regrouped here.

## Fidelity decisions

### Preserved directly

- Exact shared and flow palette values, source gutters, primary radius families and six shared typography definitions.
- Native system font approach. No font asset or `fontFamily` override was found in the audited mobile source.
- Icon paths, 24-unit coordinate system, 1.8 stroke, rounded caps and joins.
- Red primary purchase/auth actions; dark order filters and summary/progress surfaces.
- Distinct commerce, account, auth and studio treatments instead of collapsing them into one monochrome theme.

### Deliberate web adaptations

Native imagery varies: the main catalogue contains products, while the category-collection view uses cover. The web kit deliberately defaults to contain so garment details remain visible; review editorial/category crop behavior separately.

| Adaptation | Why |
| --- | --- |
| `textSecondary = #656963` in commerce/account | Original muted text is 4.44:1 / 4.47:1 on warm canvas, and 4.13:1 / 4.15:1 on soft fill. The web alias exceeds 4.5:1. Original muted values remain available |
| Interactive boundary `#858780` | Native pale borders remain decorative. The web control boundary exceeds 3:1 on all source light canvases |
| Explicit focus ring and semantic inputs | Keyboard use, browser forms, radios, tab panels, labels and focus return are web responsibilities |
| Minimum44 target on compact order chevrons | Native visible circle36 expands to a usable web target |
| Order party and related party | User-requested identity prominence from the web orders work; not claimed as original native order-card content |
| Auth labels remain above fields | Keeps a shared, explicit HTML label/error layout. Native fields place compact labels inside the shell; password reveal uses a text Show/Hide action on web |
| Responsive layouts and centered large-screen modal | Native phone geometry does not define a desktop grid or desktop modal placement |
| Rem dimensions and explicit leading for extra type roles | Allows browser text zoom and avoids implicit native font-metric assumptions; original shared six roles retain their exact leading |
| General progress stepper | Shares dark material and warm markers; order timeline vertical structure must be composed per feature |
| Two shimmer passes | Limits decorative motion. Reduced-motion mode is static |
| Documentation display typography | The large guide headline is presentation for the resource, not a new application heading token |

### Not invented or implemented here

- Full dark mode, a new logo, custom fonts, a new brand palette, or novel motion language.
- Native equivalents for staff dashboards and tables.
- A production role switcher, permissions model, search API, pricing engine, payment flow or document generation.
- Native gesture physics, haptics, photo capture, reference crop, 3D preview and platform-specific camera or sharing UX.
- A full visual regression match to a current installed native binary. Source fidelity and historical captures are evidence; a live device review remains a later validation step.

## Assets

`assets/mark.png` is a byte-for-byte copy of `assets/brand/adaptive-monochrome-candidate.png`, which the current native PersonaShell uses. The preview applies a red CSS mask with the same approximate 61.44/36 crop ratio. It is existing candidate artwork, not a newly approved brand master.

`assets/round-logo.svg` is the unmodified Flutter-derived source asset documented in the native `PROVENANCE.md`; its native SHA-256 is in the manifest. It is retained as reference, not used to substitute the current home mark.

The preview's garment drawing is a simple inline SVG placeholder authored for this resource. It is explicitly labelled illustrative and represents no actual SKU. No real customer photos, order records or credentials are included.

## Review gate before application-wide adoption

Review the actual native app on iOS and Android alongside one converted web route. Validate long business names, large text, empty/missing/denied/error distinctions, pending and completed orders, payment labels, destructive confirmation, field errors and slow/offline states. Include keyboard and screen-reader checks. Preserve existing persona permissions and backend authority. Then expand the approved pattern to the next flow.
