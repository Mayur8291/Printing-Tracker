# Local Product Studio fixture

This fixture renders the actual web `CataloguePage` and its actual Blender/WebGL renderer. Catalogue records and image assets are bundled sample data. Roles, users, quotes, saved products, uploads and order actions are isolated in-memory fixtures; this is not an authenticated hosted acceptance environment.

From the repository root:

```sh
node tools/squad/web-product-studio-preview.mjs
```

Open `http://127.0.0.1:5198/studio-preview`. The preview begins with a red round-neck garment, navy full sleeves and ivory piping. Every part is independently editable. The visible notice identifies sample mode; changes reset on page reload. Add `?role=0`, `1`, `3`, `10`, `11`, or `12` for a sample role. Role `2` is browse only. `/__studio-review?role=3` starts with the normal catalogue entry rather than a seeded design.

The tools-only Vite middleware binds to loopback and is never registered in production routes. The browser CSP, fetch guard and fixture media resolver prohibit external connections. Neither test nor demo calls a production database or writes real orders. Drafts use a fixture-scoped browser key and do not affect actual app identities.

Run regression checks while the server is running:

```sh
node tools/squad/web-studio-local-browser.mjs
STUDIO_BASE=http://127.0.0.1:5198 node tools/squad/web-product-studio-browser.mjs
node tools/squad/web-studio-capture-epoch-browser.mjs
```

The first runs directly against the served preview with no request interception and checks canvas identity across all eight parts, incomplete selections, catalogue failures/retry, PNG capture, responsive layout, and absence of external requests. The role suite uses the same fixture page and SDK, covers save/reopen/independent artwork/quantity/sample/quote permissions, and records per-role screenshots. The capture suite tests camera/context-loss races during asynchronous PNG conversion.
