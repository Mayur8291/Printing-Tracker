# Scott One UI foundation · v0.1

A source-derived web design foundation for SCOT1, audited on 28 November 2026. This package is isolated from the current production application. It contains design tokens, scoped CSS, React primitives, working pattern examples and a native-source audit. It makes no network requests and contains only synthetic demonstration records.

## Start here

From `apps/admin`:

```sh
node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort
```

Open `http://127.0.0.1:5198/scott-one-ui-kit.html`. This entry is separate from the application's `index.html`. Existing routes, themes, data fetching, authorization and deployment configuration are untouched.

For a separate, portable production build, from `apps/admin`:

```sh
node ../../node_modules/vite/bin/vite.js build --config src/scott-one-ui/preview/vite.config.mjs
```

The output is `apps/admin/dist-ui-kit/`, with an independently runnable `scott-one-ui-kit.html`. Serve the directory over HTTP; ES modules cannot reliably run via `file://`. This build does not replace the application's `dist/`.

## Package map

| File | Responsibility |
| --- | --- |
| `tokens.json` | Canonical token data; exact source values and documented web additions |
| `tokens.css` | Generated custom properties and typography classes, scoped to `.sc1` |
| `styles.css` | Scoped component styles, interaction states, responsive sheet, accessibility preferences |
| `components.jsx` | Presentational React components; no business logic or backend dependencies |
| `Icon.jsx` | All 26 native SVG icons, with original geometry and 1.8 stroke |
| `index.js` | Public exports and CSS imports |
| `AUDIT.md` | Source rationale, coverage, fidelity decisions and migration rules |
| `source-manifest.json` | Indexed source paths, exported components, SHA-256 hashes and color frequency |
| `preview/` | Interactive design reference; documentation styles are not product styles |
| `scripts/` | Token generation and browser/contrast verification |

## Visual decisions

- Use the warm `#F4F3EF` canvas and commerce paper `#FFFEFB` for purchasing and orders. Account cards are white. Authentication and the product studio use white canvases.
- Use `#C8191F` for principal actions, selected studio controls and focused controls. `#E72023` is a distinct native brand red, not a replacement for the action red.
- Ink surfaces support order summaries and purchase progress. Ink actions are a secondary variant; the native purchase action itself is red.
- Use the operating system font. The audited mobile source does not load a custom font. Do not introduce Inter, Poppins or a decorative brand font.
- Keep the seven-step spacing scale: 4, 8, 12, 16, 20, 24 and 32 logical pixels. Component-specific 14/18/22 values are intentional native details, not a second global spacing scale.
- Preserve radius hierarchy: 14 controls, 16 shared cards, 22 commerce/account cards, 28 sheets, 40 dock. Do not round every surface identically.
- Keep product images contained. Use cover for category/editorial imagery where cropping is intentional. The native category-collection view is a cover exception; the web default deliberately preserves the full product.
- Prefer a subtle line over a shadow. Elevate only a dock or overlay. The dock reproduces native translucent fills; it does not claim native blur.

## Token contract

Three layers:

1. **Primitives**: `--sc1-color-primary`, `--sc1-space-4`, `--sc1-radius-commerce`, `--sc1-type-body-size`.
2. **Semantic flow aliases**: `--sc1-canvas`, `--sc1-paper`, `--sc1-ink`, `--sc1-text-secondary`, `--sc1-line`, `--sc1-soft`, `--sc1-accent`.
3. **Component decisions**: `--sc1-component-order-padding`, `--sc1-component-sheet-scrim`, `--sc1-size-purchase-button`.

`--sc1-muted` retains each flow's exact native muted color. Components use `--sc1-text-secondary`, darkened only for commerce/account to pass small-text contrast on the warm backgrounds. `--sc1-color-control-border` is the web-only accessible control boundary; `--sc1-line` remains the original decorative border.

Dimensions use rem equivalents of native logical pixels at a default 16px root. The package does **not** change root font size. Borders and tiny ornamental marks remain CSS pixels. This is a translation of layout units, not a promise that iOS, Android and browsers rasterize type identically.

Edit JSON, then regenerate and check:

```sh
node apps/admin/src/scott-one-ui/scripts/generate.mjs
node apps/admin/src/scott-one-ui/scripts/generate.mjs --check
```

The JSON is a simple documented project schema, not a claim of DTCG/Figma Variables interchange compliance. CSS is deterministic. Skin selectors can be nested deliberately, but should follow a flow boundary rather than be applied individually to every control.

## React integration

```jsx
import { Surface, SearchField, OrderCard, Button } from '@/scott-one-ui';

function Orders({ orders, query, setQuery, openOrder }) {
  return (
    <Surface skin="commerce" className="sc1-stack">
      <SearchField value={query} onChange={setQuery} />
      <div className="sc1-grid">
        {orders.map(order => (
          <OrderCard key={order.id} order={order} onOpen={openOrder} />
        ))}
      </div>
    </Surface>
  );
}
```

For CSS-only use, import `tokens.css` followed by `styles.css` and wrap the region in `<div class="sc1" data-sc1-skin="commerce">`. Every product selector is scoped. The preview CSS is intentionally excluded from the public entry.

### Component API

| Component | Main contract |
| --- | --- |
| `Surface` | `skin`: core, commerce, account, auth, studio; optional semantic `as` element |
| `Button` | `variant`: primary, ink, outline, quiet, brand, danger; `size`: default, purchase, auth; `loading`, `disabled`; defaults to type button |
| `IconButton` | Required descriptive `label`, `icon`; forwarded ref; minimum 44px target |
| `Field` | Required visible `label`; native input props; `hint`, `error`, `multiline`, `options`, `variant="auth"`; password reveal; forwarded ref |
| `SearchField` | Controlled `value`, `onChange`, optional `onSubmit`; descriptive search label and clear action |
| `ChoiceGroup` | Controlled radio `value` / `onChange`; `options[{value,label,disabled}]`; chips or segmented; stable native radio name |
| `Checkbox`, `Switch` | Required visible `label`, native checked/onChange/disabled props; switch uses switch semantics |
| `Tabs` | `items[{value,label,content}]`, controlled value; arrows, Home/End; associated tab panels |
| `Card` | Optional `as`; tone soft, inverse, account or studio |
| `Badge` | Tone neutral, warning, success, danger; always include a text label |
| `Notice` | Tone info, success, warning, error; optional title; `live` announces dynamic updates politely |
| `EmptyState` | Title, explanatory children, optional icon and action |
| `Skeleton` | Announces a single loading label; `lines`; reduced-motion-safe |
| `Avatar`, `PersonRow` | Name required; optional image/detail/type/onOpen; initials are decorative alongside visible identity |
| `OrderCard` | Display model below; optional `onOpen(order)`; names wrap rather than truncate |
| `ProductCard` | Name/category/preformatted price; image or visual; optional configure action |
| `OptionCard` | Native radio; caller supplies group name, value, checked/onChange; group in a labelled fieldset |
| `ProgressSteps` | Label, string steps, zero-based current index; completed/current/upcoming text semantics |
| `Accordion` | Native details/summary, title, content; supports open/onToggle |
| `Dock` | `items[{href,label,icon,active,count}]`; actual navigation links and aria-current |
| `Sheet` | Controlled open/onOpenChange, title, optional description/footer/skin; native dialog |

`OrderCard.order` takes `id`, `kind`, `status`, `partyType`, `party`, optional `relatedParty`, `placed`, `due`, `quantity`, `amount`, `payment`. Dates/currency are **already formatted strings**. Status labels are currently English; localize through a mapping before using elsewhere. The shell does not resolve parties, calculate tax, infer authorization or mutate orders.

The kit's demo search is local synthetic-data filtering. When applying the kit, retain the existing production server search and party resolver. Do not replace production pagination with filtering only the currently loaded page.

### Accessible web behavior

- All normal controls have a 44px minimum target; field inputs are at least 16px at default scale. Text and cards can grow.
- Focus is a 3px action-red ring with 3px offset. Do not clip it in downstream overflow containers.
- `Sheet` uses `dialog.showModal()` for the inert background and native focus containment plus explicit Tab boundary wrapping; Escape, close action and backdrop close restore the opening element. Background scrolling is locked. Use one modal at a time; a nested-modal stack is outside this foundation.
- `Tabs` expects a nonempty items array and a valid controlled value. Use radios for filter state; links for navigation. Do not use application tabs as ordinary links.
- `Field` connects label, error, hint and any supplied description. Applications own validation timing and focus on submit failures. Read-only data is usually better as text than as an input.
- Do not put every static notice in a live region. Opt into `live` for meaningful changes.
- Reduced motion disables all animation; shimmer does two passes rather than looping indefinitely. Increased contrast strengthens decorative borders. Reduced transparency makes the dock opaque. Forced-colors mode retains selected-control outlines.
- The package contains light appearance and dark summary islands only. It does not invent a full dark mode absent from the native theme.

### Responsive layout rules (web proposal)

| Context | Rule |
| --- | --- |
| Narrow viewport | Single primary column, 20px base gutter; orders 18px and home 12px are available native variants |
| Order collection | Auto-fit columns with a 20rem preferred minimum, never wider than its container; long party names wrap |
| Medium workspace | Optional two columns; keep document reading width and task flow clear |
| Wide workspace | Content max 80rem; optional 15rem staff rail; shell implementation belongs to the next phase |
| Auth | Max 440px column, 24px page gutters, comfortable vertical spacing |
| Overlay | Bottom sheet at ≤560px; centered dialog above, max 85dvh/90dvh with scrolling content |
| Commerce dock | Mobile pattern only; desktop navigation may use the same tokens in a rail or header |
| Large text | Reflow columns, allow labels and actions to wrap; never cap user zoom or force a fixed card height |

## Migration order

1. Apply `Surface` around one orders route. Map existing data to presentational props. Verify pending/completed states, party search, navigation and permissions.
2. Compare customer and dealer flows against the audited native source; review at narrow and desktop sizes.
3. Apply field/action states to people and account screens, then catalogue/cart/configurator patterns.
4. Extend to staff roles using the same visual vocabulary. Staff tables, dashboards, bulk actions and sidebars are **web-specific design work**, not existing native screens.
5. Replace legacy CSS only after the route is reviewed. Do not globally alias existing shadcn tokens to SCOT1 tokens; that could restyle unrelated personas.

## Verification

```sh
node apps/admin/src/scott-one-ui/scripts/generate.mjs --check
node apps/admin/src/scott-one-ui/scripts/verify.mjs
```

The browser verifier expects the preview at `http://127.0.0.1:5198/scott-one-ui-kit.html` (override `SC1_KIT_URL`). It exercises search, filter controls, tabs, a modal, focus restoration, form validation, viewport overflow, reduced motion and token contrast. It writes screenshots and a report under `output/scott-one-ui-kit/`. It uses the existing Puppeteer dependency and installed Google Chrome. These checks support this foundation; they are not a production-route regression suite or a screen-reader audit.

The native reference includes the current local working tree, not a newly captured installed mobile release. See the audit for exactly which evidence informed the design.
