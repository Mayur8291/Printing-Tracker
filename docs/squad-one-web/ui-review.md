# Squad One web UI review

## Standard and scope

The existing Printing Tracker interface is the visual baseline: its actual shadcn/Radix components, Scott logo, Articulat typography, neutral light/dark tokens, compact sidebar, bordered cards and restrained spacing. New business screens must use this system; no synthetic production metrics, invented activity or fake customer records belong in the application.

A dedicated UI/UX lane reviews the rendered interface after integration, records specific defects, fixes them and reviews again. Component-fixture checks below establish presentation behavior only. They do not imply real-user authentication, deployed RPC, authorization or end-to-end workflow acceptance.

## Iteration 1 — shell and shared patterns

Implemented `SquadShell` with authorized navigation supplied by the session/route owner, responsive Radix sidebar, active route, real identity labels, environment label, server-derived write-state notice, sign out, appearance control and content skip link. Navigation resets scroll and focuses the content container after route changes. Theme selection uses the existing Printing Tracker preference.

Shared patterns: page header, section card, metric card (unknown values remain unknown), semantic status badge, loading/error/empty/denied state, data table, pagination, accessible field, Radix command dialog and definition list. Table actions use a focusable first-cell button rather than an inaccessible clickable row. Pending dialogs block duplicate submit and dismissal. Tables have a keyboard-accessible horizontal scroll region and optional caption.

Rendered an isolated fixture against the actual Vite transformation and existing application CSS in local Chrome, using empty records and an explicitly named visual-review account. Captured and inspected:

- 1440×1000 desktop light and dark views.
- 390×844 mobile view and opened navigation drawer.
- Account registration at desktop and mobile sizes.

Observed and fixed:

1. Global legacy table selectors forced a 1120px minimum width and blue gradient headers even in dark mode. Shared tables now carry the existing `data-shadcn-table` isolation attribute. Both business implementation lanes were instructed to do the same.
2. Existing shadcn isolation selectors also reset cell alignment and background. Scoped table typography and row/header styling now preserve neutral headers, centered empty states and numeric alignment without changing tracker CSS.
3. Registration form submission was below the viewport on mobile while the global root disables document scrolling. Reported exact inaccessible button coordinates to the application owner for a scrollable account wrapper.
4. Server write state uses `allowed` and `mode`; shell now consumes those fields, displays refresh suspension and bounded test-session expiry, and never offers a write-mode switch.

Component rerun: zero application JavaScript errors; no document horizontal overflow at desktop or mobile widths; mobile drawer opens. Local Vite HMR websocket warnings are specific to the browser test's intercepted document and are not application errors.

Screenshots currently held locally in `/tmp/squad-ui-{desktop,dark,mobile,mobile-nav}.png` and `/tmp/squad-account-{desktop,mobile}.png`; these are review fixtures, not production evidence.

## Pending integrated review

- Actual authenticated home and domain list/detail/form screens.
- Account wrapper fix and registration scrolling verification.
- Mobile and keyboard dialogs, errors, empty states, long names and dense quantity tables.
- Visual review of each new integrated build, including dark mode and existing tracker regression.
- Hosted browser acceptance and representative real-persona data.

## Iteration 2 — feature layouts and account scrolling

Rendered the actual OrdersPage and ProductionPage components inside the shell, with explicit empty-result SDK fixtures and the actual query/session providers. Inspected desktop and 390px mobile screenshots plus dark mode. Search/filter controls, header actions, cards, empty states and pagination fit without document overflow or JavaScript errors. These remain presentation tests; fixtures do not establish database behavior. Both lanes now share the visual primitives rather than maintaining separate page/table/status systems.

With the application owner's permission, changed only account layout in `AccountFlow.jsx` and the SignIn markup in `AppRoot.jsx`. Account forms now own a full-height scroll container; the sign-in links sit in normal flow beneath the login card instead of being absolutely positioned over it. Retested registration at 390×844: scrolling reaches the submit at y=699 and back link at y=751, both fully inside the viewport. No authentication logic changed.

Additional screenshots: `/tmp/squad-orders-{desktop,dark,mobile}.png`, `/tmp/squad-production-{desktop,dark,mobile}.png`, `/tmp/squad-account-mobile-scrolled.png`.

## Iteration 3 — authenticated persona entry and media

Reviewed all 11 actual staging Auth persona desktop screenshots in `evidence/role-*-desktop.png`, plus `customer-mobile.png`. Principal-specific navigation, home copy, scoped metrics and existing visual tokens are consistent. These screenshots were produced by the coordinator's real-Auth harness; its `persona-entry-acceptance.json` owns the authentication evidence. Entry acceptance is not full workflow acceptance.

Corrections from the review:

- Replaced the oversized loading overview with a four-card skeleton matching the final metric layout; this avoids a large layout jump after results arrive.
- Changed mobile home metrics to two columns so the workspace actions are not pushed below four vertically stacked metric cards.
- Found Admin navigation advertising Production/Job work while the domain screens correctly restrict those operational routes to other roles. Reported to the session/navigation owner for reconciliation with the backend contract. Do not broaden domain authority just to make navigation succeed.
- Tested mobile drawer selection: drawer closes and keyboard focus lands on `#squad-main` after navigation.

Implemented shared `MediaViewer`, `MediaField`, `useMediaGrants` and media boundary helpers. They use the real shared SDK/Edge contracts, batch media-grant requests in groups of at most 25, keep grants principal-scoped, and accept signed URLs only from the active environment and approved storage path. Missing source files remain visibly missing. SVG is download-only; no SVG or HTML is injected into the page. PDF/images/video can obtain fresh authorized Open/Download grants. Standalone attachment writes use reserve → signed PUT → verify → finalize with media versions, retained command identities, progress/cancel/retry and reasoned detach. Aggregate forms remain responsible for atomic form-and-file saves.

Verification:

- Three boundary tests pass in `components/mediaModel.test.mjs`: unsafe/cross-environment URLs, filename/type/size constraints and reference identity.
- Browser upload workflow fixture injected a failure in finalize; Retry preserved both reservation and finalize command identities and completed without a second file PUT. No application JavaScript errors. This was an isolated SDK/XHR fixture, not a hosted media write.
- Rendered missing/empty media at desktop/mobile widths in both appearances, with no overflow.
- Actual integrated anonymous app at localhost:5183 loads the revised login layout at desktop and mobile sizes without JavaScript errors or overflow.

Remaining verification: hosted media mutations using controlled fixtures; populated feature detail/command dialogs; full visible-navigation coverage; final deployed responsive/accessibility checks.

## Iteration 4 — source-faithful configurator and document form

Added `ConfiguratorPreview` to the custom-product/preset configuration summary. Geometry is based on Flutter commit `5d55d9461af18b94a867dce07dee7c4b76f1e51f`, `custom_mockup.dart` and `CreateProductViewModel.selectedAddOns()`: base garment first, add-ons sorted by `layer_sort`, then every mirrored add-on in that same order. X/Y offsets multiply the square width; asset height is square width divided by `height_ratio`. A null or `-1` mirror offset creates no mirrored layer. Fabric color paints the base; each add-on uses its own selected color. Part color is not incorrectly substituted for add-on color. White paint is replaced only in paint attributes/styles, leaving paths, IDs and text intact.

Assets and selected colors are resolved through the bounded configurator API with scoped cached pagination. Media grants remain batched and environment-specific. SVG downloads have a five-megabyte streamed limit, timeout, four-file concurrency limit and no redirects; the SVG whitelist rejects active content, external references, foreign namespaces, unsupported styling, entities and excessive complexity. Rendered SVGs use revocable Blob-backed images, never inline document markup. Invalid geometry, absent source files and conflicting asset mappings produce explicit incomplete-preview messages. No old-server URL or other environment is used as fallback. General attachment SVG viewing remains download-only; only the validated configurator pipeline renders SVG artwork.

Verification: six total Node tests pass for preview geometry/order/colors and shared media boundaries. The rendered browser fixture rejects six malicious SVG examples, confirms white recoloring and checks three exact layer positions including the mirrored layer. All three Blob images decode successfully; no application JavaScript errors or page overflow at 1440×1000 or 390×844. Screenshots `evidence/configurator-preview-fixture-{desktop,mobile}.png` are explicitly synthetic geometry/security fixtures, not proof of hosted production artwork or ordering behavior. Real staging source-artwork acceptance remains required.

Reviewed the actual DocumentsPage catalogue-generation form at desktop/mobile widths and dark appearance. The full form scrolls to its final action without clipping or document overflow. Reported its empty catalogue-option list rendering as an unexplained blank border to the operations owner for correction. The test used an empty SDK fixture and does not claim document generation succeeded.

## Iteration 5 — populated administration screens and safety dialogs

Rendered all six Administration tabs using explicit populated SDK fixtures: cities/zones, failed background jobs and attempts, failed deliveries, activity records, warehouse/email schedules, and validated CSV import results with both valid and invalid rows. Reviewed 1440px desktop and 390px mobile layouts, including create-city, retry-job and apply-import dialogs. Tables scroll within their own containers; the page does not overflow horizontally. The mobile create-city dialog occupies x=12..378 and y=142..702 on a 390×844 viewport, keeping every action reachable. No application JavaScript errors.

Corrections: linked the Zone label to its actual select instead of its wrapper, gave mutations explicit action labels, made email-recipient rows responsive, prevented timestamps from becoming narrow columns of single words, exposed CSV instructions as visible helper text and added immediate invalid-file feedback. Transfer column names/upload-path verification remains with the integration owner. No SDK write contract was changed in this UI pass.

Reviewed AccountClosure at mobile width: both inputs have programmatic labels, password is masked, the destructive submit remains disabled before the confirmation phrase, and the entire dialog is readable without horizontal overflow. This was a visual fixture, not a real account closure.

Screenshots for these reviews are `/tmp/squad-admin-*-{desktop,mobile}.png`, `/tmp/squad-admin-{dialog,job-dialog,import-dialog}-mobile.png`, `/tmp/squad-closure-mobile.png`. Remaining release acceptance still includes representative hosted mutations, real staging configurator artwork, final deployed routes and regression checks in the existing Printing Tracker workspace.

## Iteration 6 — collaboration, promotions and reporting overview

Rendered populated Tasks, Goals, Sales Targets, Promotions and Notifications at desktop/mobile widths, including a long unbroken notification reference and task/target dialogs. No application JavaScript errors or page overflow. Task actions now move beneath the note on narrow screens, preserving readable note width. Missing/empty assignee lists have explanatory states. Date-only target columns no longer accidentally receive the table row as a truthy formatter time flag. Notification titles and references wrap safely.

Added the missing paginated promotion-category picker and Campaign banners view. Media references resolve in batches; no raw source links are used. The banner view follows the actual catalogue capability, and links preserve validated decimal destination IDs into the agreed ready-made catalogue route. Production Coordinators are not offered the ready-made action that their existing catalogue flow does not support. The commerce owner handles destination filter integration. Safe external provider links and banner destinations have two passing boundary tests. The rendered banner fixture navigated to `/squad/catalogue?type=ready-made&brand_id=12&category_id=22`. Fixture media deliberately included missing-source states; these screenshots do not establish real hosted artwork availability.

The shared command dialog now keeps its title/actions visible while long form content scrolls. Rechecked mobile city/job/import and task/target dialogs after that change. Responsibility recipient selection is restricted to the backend's eligible roles (Sales Coordinator, Production Coordinator, Job Worker, Team); edits preserve the existing subject and notes are capped at 4,000 characters.

Added a simple accessible order-status breakdown using only the returned pending/completed/cancelled counts, plus a created-date period filter applied to overview and recent orders. The inclusive end date converts to an exclusive next-day boundary in India time. Two date-boundary tests pass, including month/year/leap transitions and invalid/reversed ranges. Browser inspection confirmed the exact November filter payload and clean desktop/mobile layout. No unsupported brand/category analytics were invented.

A read-only check of the local staging snapshot found 522 active artwork rows with valid geometric fields. One of 100 active color records (id 759, `#FFFF0`) has invalid source hex. The preview reports that unsupported selected color; it does not silently invent its replacement. Real current staging artwork acceptance remains outstanding.

## Integrated read-only navigation gate prepared

Added `tools/squad/web-navigation-hosted-journey.mjs` for the coordinator's real staging fixture/session harness. It derives every visible route from each of the 11 actual SDK identities, visits all permitted primary routes plus Administration sections, records route/RPC timings and HTTP failures, and checks unresolved loading, visible errors, transport boundaries, headings, labels, page overflow, mobile navigation/focus and a permitted dialog. Customer dark appearance is also captured. No command is submitted. Real-record screenshots and full results are restricted to ignored `tools/squad/private/` with private directory/file permissions. The module has been syntax-checked and is awaiting the coordinator's staging run; it does not claim runtime acceptance yet.

The preflight caught Stock navigation advertising a dealer ledger to Admin, Customer and Sales Coordinator. Corrected navigation to the Dealer role only. STOCK.01 remains mapped to the dealer ledger and scoped catalogue availability for Customer/SC; Admin reconciliation maps to `/squad/administration/stock`. The planning generator and CSV preserve that distinction. Unsupported direct stock routes remain denied rather than silently broadening ledger access.

Also reviewed the new manual-payment instructions in a populated staging fixture at desktop/mobile widths. The full dialog scrolls to acknowledgement, contains no active external payment action or QR in staging, and has no JavaScript error or page overflow. This is presentation verification; no payment/contact action occurred.

## Collaboration lifecycle gate prepared

Added `tools/squad/web-collaboration-hosted-journey.mjs` for the same parent-owned staging harness. All writes use the rendered forms: Team personal task create/edit/complete/reopen/archive; Admin assignment of a responsibility to the exact fixture Team member followed by that member completing/reopening it; and Admin sales-target create/edit/progress/archive for the exact fixture Sales Coordinator, including the coordinator's read-only view. Every new entity is journaled immediately after the accepted RPC, before checking subsequent rendering. Authenticated SDK reads independently verify persisted ownership, content, states and target totals. The module selects a non-overlapping target period from existing fixture-only targets, and requires existing Team notes/goals grants rather than changing permissions itself. Syntax validation passes; hosted execution remains with the coordinating harness.

This review found that archiving the currently selected sales target retained a stale progress panel. The page now clears that selection after success. A rendered browser regression confirmed the archive command's inputs, dismissed dialog, removed progress panel and no residual error state. Re-rendered populated Tasks, Goals, Targets, Promotions and Notifications at desktop/mobile widths: no JavaScript errors or page overflow. Re-inspected the mobile task dialog and target list; actions remain reachable and wide tables scroll inside their cards. The ten focused media, configurator, date-boundary and promotion routing tests pass. These local fixture checks are separate from hosted lifecycle acceptance.

## First real navigation run and follow-up

The coordinator's first real staging navigation run covered 108 route visits across all 11 personas. It found an unsupported Dealer Reports entry (removed by the coordinator after source review), an Inspector jobsheet RPC timeout (assigned to the operations/backend owner), and a mobile test race affecting the five responsive checks. The mobile screenshots captured the drawer during its 500ms entrance animation. Reproduced that race locally: the immediate profile click failed while the drawer was at x=-288; after its geometry settled at x=0 the same real click succeeded, the drawer closed and focus returned to `main#squad-main`. The harness now waits for open, in-viewport geometry before clicking. This is a harness correction, not a claim that the first run passed. The next real run must also cover Administration subroutes that the earlier mobile exception skipped.

Successful task/responsibility archive from a deep link now returns to the corresponding list, avoiding a misleading archived-record error. A rendered regression confirmed the actual transition handler, clean list destination and absence of stale alerts.

Reviewed the amendment strategy and a 12-size/sample/note local editor on mobile. The preservation/full-replacement decision is explicit, replacement requires acknowledgement, partial source-load failure is explained, and no page overflow or JavaScript errors occurred. The commerce owner adopted the review suggestion to keep the quantity dialog header/footer fixed while its body scrolls. These remain presentation/fixture checks; real amendment acceptance belongs to the commerce journey.

## Real artwork acceptance module prepared

`tools/squad/web-artwork-hosted-journey.mjs` now performs a bounded, read-only search through the actual Customer catalogue for pre-existing non-fixture products with ready, environment-local SVG grants. It opens the real configurator, selects two existing fabric colors, decodes and composites the resulting Blob images, checks nonempty pixels, unchanged SVG paths and source-relative geometry, then captures desktop/mobile and browser pinch-zoom results privately. Where the chosen product provides a ready mirrored add-on, the module selects it through the real form and verifies base/add-on/mirror order and each source offset/height. Real missing-artwork and invalid-color fallbacks are exercised only when encountered; unobserved branches are explicitly recorded. No SVG, response, source row or color is fabricated, and no design/order/media write is issued. The coordinator must execute this before closing the fixture Customer. Syntax passes; hosted results are pending.

Also hardened the integration helpers: RPC waits and navigation timings now require POST to avoid accepting CORS OPTIONS preflight as an actual command response. Administration creation journals the accepted entity before waiting for dialog dismissal, and account closure fields wait for their portal labels before typing.

## Account proof and media follow-up

Corrected guest account proof forms to the actual backend password contract: at least 12 JavaScript string units and no more than 72 UTF-8 bytes. The previous browser minimum was eight. The form now gives an accessible password-policy hint and rejects invalid values before calling the SDK. Invalid/expired proof has actionable wording while preserving the form; an expired invitation directs the user to their inviter. `tools/squad/web-account-entry-browser.mjs` renders the actual component and passed 11-character and 74-byte local rejection, exact 12-character and 72-byte acceptance, failed-proof retention, successful secret-field removal and mobile overflow checks. The mobile proof form was visually reviewed. This is isolated fixture validation, not hosted email/Auth acceptance.

The shared media viewer can now explicitly refresh an expired or failed parent-supplied grant, including compact previews. A generation guard prevents a delayed retry from replacing another record's preview. `tools/squad/web-media-browser.mjs` passed actual failed-image/retry/decode behavior and the stale-response case with no browser errors or horizontal overflow.

Prepared two optional browser adapters for separately proven hosted fixtures. `web-account-entry-adapter.mjs` requires controlled-inbox proof and source/Auth ownership hooks; it does not invoke the unsafe legacy account harness. `web-media-hosted-adapter.mjs` is restricted to the owned Customer profile, validates two distinct manifest PNG hashes, journals each reservation immediately, and exercises upload/verification/attachment/decoded preview, real Chrome download with matching bytes, replacement and detach. Source/Storage cleanup proof and retained audit history remain the coordinating harness's responsibility. Neither adapter has been independently executed against staging, and these flows are not marked accepted yet.

## Account route source disposition and control traceability

The pinned Flutter `AuthService.updatePassword` declaration (`lib/services/auth_service.dart:45`) has no caller anywhere in `lib`. The reachable password flow is `forgot` → `otp` → `reset_password`, using `resetPassword`. The planning AUTH.02 route now names the implemented proof-based `/account/recovery`; it does not claim an authenticated `/account/password` screen. AUTH.03 maps to `/account/register` and `/account/confirm`, AUTH.04 to `/squad/profile`, and account closure to that profile's confirmation. The generator and planning CSV agree; no hosted acceptance status changed.

`source-view-web-traceability.csv` indexes all 317 pinned view-related files, preserving source methods and SHA-256 content fingerprints, workflow families and shared implementation paths. Its review state explicitly distinguishes a component mapping from control review and hosted acceptance. The index does not make the unsupported claim that every method is a reachable UI action. For example, `resetItemTailorsQuantity` only clears temporary draft quantities after save; `setHistoryDate` selects an existing event, and the date tabs choose event records. The web clears saved form values and presents equivalent bounded, timestamped per-size assignment/completion history. No artificial unassign operation or date-range requirement was introduced from helper names.

A concrete missing control was identified in the branding workflow: editing an existing placement. `BrandingEditor` is now shared by custom and ready-made configurations and supports local draft editing or updating the same owned saved design through the existing versioned contract. Attached files, comment and print-area metadata remain associated with that design. Order-linked artwork remains protected by the backend; failure retains the form and original placement. `web-branding-editor-browser.mjs` passed local/no-write, preserved-media/version, protected-artwork error and mobile layout checks. The mobile edit modal was visually reviewed. Actual hosted design mutation is not claimed by this fixture test. A subsequent source-widget check found placement-specific Comment/Guidelines (`add_branding_widget.dart:238`) still needs a field; the item note is a different field. This narrow addition is queued until the coordinator's real navigation/artwork build freeze ends. The old print-area selector is commented out and does not create an additional reachable-control gap.

Source provenance check: the Flutter checkout's working tree is older `eef6bffd`; the authoritative comparison is `git show` / `git grep` at the pinned `5d55d9461af18b94a867dce07dee7c4b76f1e51f` commit. The account/branding/history findings above were rechecked at that pin, and the 317-file index always reads pinned Git content. An additional pinned-only reachable control remains: ready-made multi-product/brand image sharing with Category/Brand/Name/Color captions and optional stock (`rmp_viewmodel.dart:179–239`, plus search and view handlers). Current catalogue selection is for quotes, and promotion sharing is a different workflow. This needs explicit equivalent web file-sharing/download behavior or a reviewed disposition; expiring private source URLs must not be treated as durable public share links.


The pinned sharing utility was traced through to its actual output: `lib/app/utils.dart:714–718` calls `Share.shareXFiles` with files, while its combined caption text argument is commented out. Thus the old Include Stock option does not transmit stock. The authorized web equivalent is files-first sharing, without inventing a functional stock checkbox. An isolated module now prepares fresh scoped first-image grants as decoded raster files, supports at most 20 selections / 10 MB per image / 20 MB total, and separates preparation from a genuine user-click native share. The desktop ZIP fallback contains those files plus a product-name manifest, never signed URLs. Missing images are explicitly excluded. `web-product-share-browser.mjs` passed preparation, ZIP contents, missing-source reporting, bounds, filename sanitization, active-user-gesture file-only share adapter, and mobile layout; integration awaits the current hosted-run freeze.

The first actual artwork run uncovered a shared media identity mismatch before SVG fetching: source descriptors omitted the scalar root pointer, but the resolver returns `pointer: ""`. The client previously keyed missing pointers as null and failed to locate the ready grant. Reference keys now normalize omitted/null/empty root pointers together while preserving distinct array pointers. Unit tests and `web-configurator-preview-browser.mjs` reproduce the actual descriptor/grant shape and pass decoding/composition. Actual source artwork needs the next hosted rerun; the first run is not retroactively declared successful.

## Integrated sharing and placement review

After the hosted-run freeze lifted, integrated ready-made image sharing into catalogue cards and the shared toolbar. Individual checkboxes, page select/deselect and a selected-brand action are bounded to 20 items. Brand lookup reads at most 21 records and refuses an oversized batch with an explicit page/individual-selection instruction. Selections clear when identity, environment or customer context changes. `web-catalogue-share-browser.mjs` renders the actual catalogue and passed checkbox/page behavior, oversized-brand rejection without partial selection, modal file preparation/ZIP, identity-change clearing and mobile overflow checks. The populated mobile catalogue and sharing dialog were visually inspected.

Placement Comment/Guidelines is now editable, remains separate from the item note, and saves through the same owned artwork contract. The quote request projects only the existing allowed pricing fields and the design ID/version, preventing artwork-only comments or file metadata from breaking pricing validation. Local browser editing and the new quote-boundary test pass. Customer overview wording now says “Your orders”; staff retain assigned-scope wording.

The staging production build passes. Nine commerce model cases and all twelve existing commerce browser cases pass. The esbuild-only commerce fixture needed explicit React/ReactDOM aliases to prevent a duplicate peer runtime (`ReactCurrentDispatcher`) during startup; the actual Vite application and the new local Vite fixtures had no such failure. Shared account, media retry, configurator and sharing tests remain distinct from hosted acceptance.

Reviewed the second real-navigation run's Dealer and Team mobile home screens plus Customer dark mode: card widths, typography, focus, contrast, controls and vertical scroll are consistent with the existing design system; no clipping or horizontal overflow. That run's 115 route/persona checks had zero failures and exact fixture cleanup, as accepted by the coordinator. Its artwork failure was tracked separately and requires a new hosted result after the pointer fix.

### Real garment SVG compatibility — local replay after hosted failure

The next real artwork run reached the authorized asset but rejected the source's Figma-generated `mask-type:luminance` declaration. The preview sanitizer now accepts only `mask-type:luminance` or `mask-type:alpha` on mask elements; arbitrary CSS, external references, script, invalid mask values and the same declaration on other elements remain rejected. The retained private source SVG was replayed through the actual browser sanitizer and rasterized in two colors: both decoded, all path geometry and the luminance mask declaration were preserved, 208,207 canvas pixels were painted and 195,670 matched the selected color. The private two-color render was visually reviewed. The existing three-layer/mirrored mobile preview regression and six unsafe SVG cases also pass. This is a local real-source regression, not a claim that hosted artwork acceptance has passed; the parent will rerun the end-to-end artwork journey.

### Hosted artwork/media acceptance and retained catalogue controls

The coordinator's `evidence/artwork-acceptance.json` now records a successful real staging run: the authorized garment SVG decodes in two actual fabric colors, preserves source paths and geometry, and remains correct at mobile width and browser pinch zoom. The private desktop/mobile screenshots were independently reviewed. The bounded source discovery found no ready mirrored add-on; real mirroring is not claimed, and its deterministic local geometry test remains separate. `evidence/media-acceptance.json` records the separately successful own-profile upload, exact-byte download, replacement and detach, with original media preserved and audit history retained. These accepted results predate the new optional crop and product-reference controls below.

Completed the concrete retained catalogue controls found in the pinned-source pass: reference-image add/replace/detach and per-image guidelines; explicit current-preview mockup capture; single-selection add-on group replacement, required color selection and sleeve-length/type dependency; draft fabric/part/placement resets; and a ready-made detail gallery for all images with larger view, download and selected-image sharing. The reference editor binds to an owned saved product. Fingerprint reuse displays a notice and preserves existing files. Mutations refetch shared product versions and restart bound pagination. Truncated legacy guidelines require explicit acknowledgement before replacement, rather than silently dropping the original tail. Incomplete or changing preview layers cannot become a saved mockup.

Added optional crop/rotate to the shared upload field. Pointer drag/resize and labeled keyboard percentage controls support arbitrary aspect ratio. Browser decoding respects EXIF orientation, caps source dimensions at40MP, and exports a clearly labeled still PNG up to4096px. Applying a crop does not upload; the existing explicit verified-upload action remains necessary. Browser pixel tests cover crop coordinates, quarter-turn rotation, EXIF orientation6, invalid bounds and mobile fit. The crop modal was visually reviewed at390px.

Local actual-component tests pass for product reference notes/version, rendered PNG capture, crop-before-upload, exact product attachment target, retaining old images, changed-configuration/read-only fences; add-on group replacement and sleeve filters; selected-image gallery sharing/missing-file state; and prior catalogue sharing/12 commerce workflows. Reference cards use container-responsive columns and were visually reviewed. The shared media retry and branding editor regressions remain green. Latest staging build passes without a new circular-chunk warning. Existing unrelated CSS and large Tracker bundle warnings remain.

The old design-file picker accepts broader office/design/archive/audio formats than preview media. The frontend now preserves its exact42 non-preview extensions solely for `brandings.attachment`, normalizing them to download-only octet-stream with a25MB cap. Raster/SVG/PDF still use their existing verification paths. The viewer never opens or previews opaque files. All42 extensions, uppercase handling, size boundaries, wrong targets and arbitrary extensions are locally tested; backend130 and hosted attachment acceptance are tracked separately. The same narrowly validated Figma mask-type support was also added to server upload verification with Edge regressions.

No new product-reference/gallery/crop flow is marked hosted-passed by these local fixtures. Source control rows record that distinction explicitly. Single-image legacy sharing transmitted raw stock captions, unlike multi-image sharing; the shared web export deliberately contains files and names only, so it does not disclose legacy unscoped stock values.

Independent cross-lane visual review also covered the canonical State/City inputs and the four pinned customer feedback choices at390px (`/tmp/squad-commerce-controls-mobile.png`). The inputs have linked labels, chips wrap without clipping, selected state remains legible, and the textarea has an accessible name. Work assignment/order selection was reviewed again after the coordinator waited for the modal fade; the form fits the narrow viewport and its scrollable body preserves the action footer. These are read-only visual checks during the hosted-run build freeze.

### Targets and remaining shared-source review — 9 November

`tools/squad/web-target-controls-browser.mjs` passes the actual React target form against an explicit local SDK fixture: two-row atomic payload, coordinator identity, next-day suggestion, decimal validation, remove-row, server current/achievement filter, and single-row versioned edit. Desktop 1440px and mobile 390px screenshots were inspected (`/tmp/squad-targets-desktop.png`, `/tmp/squad-targets-batch-desktop.png`, and both mobile modal scroll positions). Labels, input bounds, footer actions and scrolling are sound. This does not claim hosted mutation acceptance.

One pass over the pinned dashboard/drawer, notification routing and promotional groups found no new duplicate module needed. Native bottom tabs map to existing shared web modules. Notification source contains push-click redirects, not read/unread/delete inbox controls. Promotion “Recently Added” is exactly today's upload date; existing exact-date and category filters retain that behavior. Native app-store update screens belong to native packaging, not the web route graph.

A concrete shared-contact gap was reported to commerce: authorized-person WhatsApp buttons in shared customer/coordinator/order headers, and the reachable Customer/Dealer manager selector in CustomAppbar. The dead Customer dashboard third-tab branch is not used as justification. The implementation must reuse scoped contact data, suppress external contacts in staging, and never broaden the people directory. PDF file-sharing and tailor/inspector current-work controls remain explicitly owned by operations; no acceptance is claimed here until their pending integration.

### Scoped customer context and account contacts — 9 November

Home now includes the shared Customer/Dealer account contact card, based solely on `sdk.person(identity.id)`. It preserves the original dealer-first/contact fallback and keeps external WhatsApp/call links disabled in staging. The local actual-React contact test passes five cases, including multi-dealer selection, exact normalized numbers, missing numbers and 390px bounds.

Catalogue deep links from People resolve `customer_id` through the scoped person contract before mounting any customer-priced queries. Eight actual-React checks pass: authorized SC context, decimal IDs above JavaScript's safe integer range, 390px layout, malformed IDs, Customer cross-account requests, wrong response ID, non-customer roles and server denial. The mobile populated-context screenshot `/tmp/squad-catalogue-customer-mobile.png` was independently inspected; labels, wrapped product tabs and customer controls remain readable without horizontal overflow. A staging build passed in 6.72s. These are local UI regression results, not hosted acceptance of the new contracts.

### Independent integrated controls review — 9 November, iteration 2

`web-current-ui-review.mjs` builds the actual current People/Stock/JobWork components against the populated contract-test SDK fixtures and applies the current production-build CSS. Seven desktop/mobile visual checkpoints pass without browser errors or page-level horizontal overflow: People toolbar/details, mobile Edit person modal, editable backorder review, and job-worker commitment/stage controls. The images were inspected, not merely generated. The selected coordinator toolbar and profile edit dialog meet the existing spacing, focus and responsive standards.

Three concrete operations refinements were sent to the owning agent: add inner padding around Backorders non-table form controls; replace the preview-only “Changes saved” message with quote-specific feedback; remove redundant inset padding in commitment history. This review does not replace the separate hosted command acceptance. The existing Tailor work and prepared PDF-share modal visual fixture also remains green at390/1440px.

The operations owner applied all three refinements. The same seven styled checks were re-run, and the corrected Backorders mobile and populated commitment-history desktop images were independently inspected. Form controls now have consistent20px insets, quote preview does not claim a write, and history spacing matches neighboring cards. No remaining visual blocker was found in these reviewed surfaces. The22 stale dashboard contact index rows have been reconciled to local implementation evidence while preserving their separate hosted status.

### Actual hosted catalogue-terms visual review — 9 November

Independently inspected the retained `976769c4-9ff5-441f-b4bd-d4b8f0ddac33` browser-ready screenshots at390/1440px and rendered the actual downloaded one-page A4 catalogue with Poppler at1800px. The responsive document status screen, download/share controls, PDF header, product details, prices, terms-attachment notice and footer are legible and unclipped. No layout blocker was found. The synthetic product has no image; its explicit image-unavailable state is expected and does not claim catalogue image rendering acceptance. Two minor PDF copy refinements were reported: singular product count and a clearer separator between sale price and MRP. Root owns the immutable download/embedded-byte proof and final exact cleanup acceptance separately.

Commerce then integrated the remaining SC order-header contact affordance as a lazy scoped customer disclosure. Independent styled review now covers nine checkpoints, including the opened SC contact section at390/1440px; the section and contact buttons fit cleanly and staging external actions remain disabled. `UI-CONTROL-APP-03` now records local integration for Home, People and Orders while retaining hosted contact acceptance as pending.

### 360px keyboard and isolated browser engines

The populated Chrome review now runs at 360px as well as desktop. All ten checks pass, including opening the People edit dialog using Enter, cycling focus through controls, closing with Escape, and restoring the invoker. This caught and fixed actual focus loss in controlled command dialogs without a Radix trigger; the scoped `SquadDialogContent` wrapper is used by shared and commerce command forms. An independent commerce review accepted the change.

Playwright 1.65.0 and its Firefox159/WebKit27.2 engines were installed only under `/tmp`. Both engines rendered the actual shared React form with the built application CSS; all nine keyboard/layout checks per engine passed. The two 360px screenshots were inspected: inputs, labels, focus rings and actions remain legible and within the viewport. This is local engine evidence, not native Safari or hosted persona acceptance. The read-only hosted adapter and its four positive-network-policy tests are ready for parent-owned execution; no hosted state was changed. See `cross-browser-acceptance.md` for exact setup, scope and remaining acceptance.

Final checkpoint for this iteration: staging build completed in7.37s (`/tmp/squad-ui-cross-browser-build.log`); all ten populated 360/1440px Chrome checks were rerun against that build and passed. The new 360px People edit form was visually reviewed after this build. No hosted acceptance or native Safari result is inferred from these local checks.

### Accessibility and production artifact review — 9 November

The next actual-component scan covered 13 populated light/dark/mobile/desktop states, including the People edit dialog, registration, catalogue variants, order contacts, backorders and worker commitments. Axe-core4.14.0 found two concrete categories of defect: neutral small badges had insufficient contrast, and named generic containers lacked an appropriate role. The neutral badge now uses the foreground token; the table scroll area is a named region, and inventory/product-type selectors are named groups. The final13 scans report zero violations. Radix modal focus guards/background produce three manual-review findings, separately checked with keyboard opening,16 contained Tab steps, Escape and invoker restoration. This is not a screen-reader or full WCAG conformance claim. Final light/dark People screens and its360px edit dialog were visually inspected. Machine-readable scope and findings are in `evidence/accessibility-local.json`.

The final production artifact was measured with actual Chrome, official web-vitals6.2.3 instrumentation, isolated cache-disabled contexts and explicit CPU/network throttling. Its initial JavaScript plus CSS is321,552 gzip bytes;13 feature chunks and the legacy Tracker application remain outside the initial static import closure. Six anonymous local sign-in samples at360/1366px measured LCP2.032–2.080s, INP8–32ms and CLS0. The screenshot at360px was inspected. These are local artifact measurements, not deployed authenticated performance, real-device results or field p75. The shared stylesheet remains a measurable146KB gzip part of the initial payload; no unrelated stylesheet rewrite was made. Full measurements and limitations are in `evidence/production-rendering-lab.json`.

### Query lifecycle and navigation performance

A focused actual-hook reproduction confirmed that obsolete filter and unmounted-page reads previously continued because the query loader did not consume its abort signal. The SDK now offers an immutable signal-bound read client with a positive read-contract allowlist; mutating calls are rejected before transport, and the original command client is unchanged. Query loaders consume their own signal, and cancelled authorization responses cannot trigger session repair. Nested shared configurator cache entries keep their own query signals so cancelling one consumer does not cancel another consumer's shared request; parent cancellation still stops subsequent scheduling and discards its result.

Eight transport tests and six actual-hook browser checks pass, including rapid filters, identity/environment scope changes, stale-response prevention, unmount cancellation and cancelled-forbidden handling. The controlled reproduction leaves only the latest read active and zero after unmount. The earlier hosted timing report's69 unfinished observations are not proof of69 active database queries: its observer stopped before browser shutdown. The new change is justified by the separate reproduction, with hosted rerun owned by the coordinator.

The local lifecycle report is retained in `evidence/query-lifecycle-local.json`. Supabase's current [abortSignal reference](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal) confirms the request cancellation API. Edge signal forwarding was additionally checked in the installed `@supabase/functions-js`2.100.0 implementation, rather than assuming a client-version capability. The current official changelog was reviewed; no package or platform upgrade was required for this change.

Independent commerce review accepted the transport and lifecycle change. Commerce and operations23 plus operations-read7 rendered regressions, configurator geometry/security, PNG capture and target controls pass. Final staging build completed in7.73s. The13 accessibility scans and production artifact lab were then rerun against that build. Application files are frozen for the coordinator's next hosted run.

Native Safari anonymous-route review was attempted through CUA on9 November. The computer inventory reported the Mac locked, so no Safari tab, navigation, input or settings were changed. Installed Safari26.1 remains separately identified from the tested WebKit engine; native Safari route rendering and keyboard behavior are still pending.

### Frozen-build Tracker and current hosted screenshots

`web-tracker-build-smoke.mjs` serves the actual frozen production artifact and uses clearly synthetic staff/Auth/read responses in an isolated browser. All external HTTP is intercepted, WebSocket subscription transport is replaced locally, and writes are denied. Admin and viewer membership reach the original Tracker lazy chunk without loading Squad or creating/promoting a profile. Missing staff membership is denied before the legacy chunk loads. Admin Printing Orders, populated Masters and Data Refresh entry screens render without page errors or horizontal overflow, and their screenshots were visually inspected. The report is retained in `evidence/tracker-build-local.json` with the exact entry hash.

This is local gateway/rendering regression, not real Tracker CRUD, refresh execution or realtime acceptance. Existing Tracker mounting attempts dashboard-presence writes; these were denied in the fixture. Source inspection also found its existing timed stale-order promotion. A future hosted Tracker navigation test cannot be described as read-only while forwarding those automatic operations.

Separately reviewed the coordinator's private pass3 Customer and Sales Coordinator accepted-order screens, Inspector completed queue and Dispatch detail screenshots. The actual populated states retain consistent spacing, readable hierarchy, bounded table controls and clear action placement. No concrete visual blocker was found in those four states. This visual review does not change the coordinator's functional run or cleanup result.

### Production gate warning triage

The coordinator's subsequent production build passed in7.12s. Its JSX heuristic warns on valid local import aliases and component-valued destructured props: `collectImports` retains the exported name before `as`, while its local-binding check does not inspect parameters. The reported Squad bindings were checked at their declarations; the legacy `QueueIcon` prop declaration is also present unchanged in HEAD. No missing import was found in these warnings.

The CSS minifier warning has a concrete legacy source: the reference parser's regex character class `[-:–—]` in `enquiryBulkUploadUtils.js` is scanned as a Tailwind arbitrary property, producing a tiny invalid CSS declaration. It is unrelated to evidence files: Tailwind scans only the application's HTML and source JS/JSX. The1,094,463-byte main stylesheet is largely explained by existing global Radix Themes and legacy stylesheet imports (812,667 and302,544 source bytes respectively), plus Tailwind. Squad's separate stylesheet is8,904 bytes. No source or build configuration was changed during the freeze, and no broad CSS optimization is implied by this diagnostic.

### Hosted conditional-persona visual review

Eight retained screenshots from run `4e1d4def-d2db-4afc-96e4-bde4052b1425` were independently inspected: Job Worker and Team off/configure/combined/revoked states at1440px and360px. No clipping, overlap or unreadable controls were found. The revoked Team homepage returns to its Tasks/Goals workspace; Job Worker keeps its own operational summary. The shared configuration form and document selectors maintain consistent spacing and hierarchy. The synthetic base product's missing artwork is explicit; the promotions screen distinguishes actual available artwork from source-missing files. One minor copy issue remains: single-row pagination says “1 records.” No application change was made during the run.

The large local journal count in this run was investigated: the browser dispatcher preallocates256 deterministic UUIDs per persona, so those rows are not evidence of that many executed commands. The capability observer has a fixed16-stage matrix and no retry loop; its80 full navigations explain the several-minute duration. Both revocation screenshots were subsequently produced. This visual review does not itself accept the functional journey or cleanup; the coordinator owns those receipts.

### Weekly schedule server-failure review

The weekly run `0bb5b80d-9257-4bce-8cec-83ff464d199c` stopped before PDF/email output, so no visual PDF or delivery acceptance is claimed. The actual `IntegrationsPanel` and shared query/command/dialog components were exercised by `web-schedule-error-browser.mjs` with an explicit local SDK failure matching SQLSTATE21000. Eight checks pass: failed save retains the confirmation and previous Disabled state; a visible error replaces pending state; no automatic command retry occurs; an explicit retry keeps the same command key/version; successful retry refetches and closes; read failure supports read-only retry; mirror controls remain disabled; and the360px error dialog has no overflow. The generated mobile screenshot was visually inspected. No application edit was necessary. The same missing-WHERE pattern in weekly/warehouse singleton schedule statements was passed to the database owner for the separate140 fix; mail recipient settings already use their kind predicate.

### Actual generated PDF visual review after migration140

All three retained page PNGs from run `757eb52e-a796-4229-abc0-84d93357dcd7` were visually inspected. The catalogue, delivery challan and weekly work/payment report have readable text, aligned sections, consistent dark title bands and unclipped1/1 footers. The weekly report shows3 assigned/completed,0 pending, INR35 rate and INR105 total. The challan shows one unit, INR500 subtotal, INR12.50 each CGST/SGST and INR525 total; destination, quantity and non-tax-invoice qualification are legible. The catalogue's product/brand/color/size and INR80/MRP100 are visible. Fixture image absence is represented explicitly.

No visual blocker was found. Minor existing copy/format nits remain (“1 products” and the raw ISO dispatch timestamp). These are actual single-page output checks, not proof of long-document pagination or email delivery; the coordinator owns provider receipts and fixture cleanup.

### Connected commerce/operations/reporting run visual review

Seven actual1440px screenshots retained for run `f0ba2782-43ca-42da-8cb1-dfcd678955ca` were inspected: Customer order acceptance; Sales Coordinator completed order; Factory Manager item; Dispatch item; Inspector completed queue; Cutting item; and Admin sales-report validation failure. Cards, tables, statuses, payment/delivery details, input labels and error presentation are legible and consistently spaced, with no visible overlap or clipping. Existing single-record pluralization remains a minor copy issue. These screenshots establish only the displayed desktop states; no new mobile or interaction acceptance is inferred.

The reporting screenshot preserves the selected future Before date and clearly displays the server's past-period validation message. The private child diagnostic confirms the reporting adapter stopped on SQLSTATE22023 after commerce, operations and feedback phases passed. At review time, this run's document-output directory had no generated PDF or page PNG; no document visual acceptance is claimed for it. The coordinator owns the functional diagnosis, rerun and cleanup.

### Document-chain follow-up6b0afe1e: failure diagnostic only

The finite visual checklist for the connected document gate is: settled successful report results; weekly/challan queued→ready screens with download actions; correct document/owned-entity/date headings; quantities/rates/taxes/totals matching the verified receipt; every rendered page checked for clipping and page numbering; and explicit missing-media states. Narrow-layout checks are counted only when those screenshots actually exist.

Run `6b0afe1e-3fc7-458b-af47-44c712b9e09c` produced no PDFs or successful document-ready screenshots. The retained Job Worker failure screenshot shows its order-detail read rejected with “canceling statement due to statement timeout” and a visible Retry action. The child then timed out waiting for a stage field in `completeWorker`. This is a real read failure rather than evidence of a missing-label UI race. It was reported to the operations owner and coordinator. No successful workflow, PDF output or responsive acceptance is inferred from this failure screenshot, and the ledger's document gates remain open.

### Correct staging artifact startup

The prior frozen entry failed before the app rendered because default production-mode building lacked base Supabase variables. The same source rebuilt explicitly in staging mode starts correctly. Anonymous local Chrome visual review of the actual5185 login page shows the existing dashboard card, labels, password toggle and recovery/registration/confirmation/invitation links cleanly aligned at1440px. No authenticated or hosted acceptance is inferred. The preflight now catches this startup failure before creating test identities; the old broken artifact is retained privately for its regression proof.


### Session revalidation iteration — 9 November 2026

A local delayed-transport probe of the actual application root demonstrated two concurrent `getUser`, identity and bootstrap reads at initial entry and again for paired focus/visibility events. The change shares only an identical pending session check; it does not cache completed authorization. Fifteen actual-AppRoot browser cases pass under React StrictMode, covering fresh foreground capability revocation, same-token user updates, token refresh, sign-out, direct account changes, expired write leases, mismatched verified user IDs, errors and unmount. Same-account revalidation preserves the current form; a changed account immediately removes the previous workspace. No UI styling or domain contract changed.

This proves removal of redundant browser work. It does not establish the cause of the separate intermittent hosted database timeout. Hosted regression and the final production artifact remain separate release gates. Test: `node tools/squad/web-session-coalescing-browser.mjs`.


### Clean install and frozen-build visual review — 9 November 2026

The reviewed source-only recipe completed in `/tmp/squad-clean-web-cjtmqrp8`: exact Node 26.13.0/npm 11.6.2, fresh `npm ci`, unchanged lockfile and all 597 selected source/config hashes. Explicit public staging build values were passed in memory; no `.env` files, existing dependencies, private fixtures or credentials were copied. The isolated artifact is served on port 5186 and its served entry SHA matches the generated file. Anonymous startup passed with no page errors or remote requests.

Actual clean-build login screenshots at 1440×1000 and 390×844 retain the existing visual standard: clear field labels, balanced card spacing, readable secondary links, intact logo and no horizontal overflow. This is anonymous startup/visual evidence; authenticated flows and production deployment remain separate gates. Full manifests and sanitized install/build logs are beside `evidence/clean-web-build-execution.json`.


### Pass 7 static query review and freeze confirmation

The existing `cb66a688` browser timing journal shows 35 identity checks and 35 bootstrap reads, all successful, with no same-persona identity overlap or sub-500 ms identity launch pair. The Worker ran two identity checks about two seconds apart. This trace supports the accepted 15-case AppRoot coalescing tests; it does not show a foreground/session polling storm. All 597 clean-build source/config hashes remain unchanged.

The trace does expose a separate bounded redundant read: the shared command hook completes active-query invalidation, then the operations command wrapper calls the supplied JobWork detail refresh again. The post-save sequence matches that pattern, but request arguments are intentionally absent, so history/detail attribution is an explicit source/timing inference. The browser saw one Worker order read return HTTP 500 after about 10.44 seconds; the parent SDK oracle failure is outside this observer. No app edit or timeout-cause claim was made. The reported peak observer counter of 42 includes requests with no observed terminal event; it cannot be called 42 concurrent SQL queries. Maximum overlap among browser intervals with known ends was seven. Details: `evidence/session-query-pass7-review.json`.


### Redundant operations refresh iteration

Actual rendered JobWork, cutting and stock reconciliation tests reproduced three total target reads (one initial and two after a command). Removing only the pure post-success refetch callbacks reduces this to two total reads, with the shared command hook still awaiting the active-scope invalidation. Current versions/history, sibling progress, quantity/check resets, reconciliation dialog closure, preview state and navigation remain intact. Manual Refresh/Retry remain available. The candidate passed all 23 existing operations component cases and independent Operations review before application; the focused tests then passed against the actual changed files. No markup, styling, authorization or command contract changed.

The single incremental build reused the isolated clean dependency installation and retained the previous artifact and initial evidence. The current 5186 entry is `index-D0HIEzmj.js`, SHA-256 `d89fa29a6b7150d06d49eeead69dd11a826712b45d7d5ed649564619a6e47085`; exact served bytes and anonymous startup passed. The source is frozen again. This removes demonstrated unnecessary traffic without claiming to explain the separate hosted SQL timeout. Evidence: `evidence/operation-refresh-review.json` and the current `evidence/clean-web-build-execution.json`.
