# Conditional content and existing-media acceptance

These adapters are prepared for coordinator-owned hosted execution. They have not been run against hosted fixtures. Application files remain unchanged by this iteration.

## Conditional Team and Job Worker stages

`tools/squad/web-conditional-content-hosted-journey.mjs` exports `observeStage(ctx, {role, stage})`. Roles are restricted to the exact fixture subjects11 and12, including exact decimal business IDs. The expected matrix is explicit:

| Stage | Products | Configure | Catalogue/PDF | Promotions |
|---|---|---|---|---|
| off | no | no | no | no |
| browse | yes | no | no | no |
| configure | yes | yes | no | no |
| pdf | yes | no | yes | no |
| combined-products | yes | yes | yes | no |
| promotions | yes | no | no | yes |
| combined | yes | yes | yes | yes |
| revoked | no | no | no | no |

Order placement must remain false at every stage. The adapter reads the actual identity, reloads authenticated bootstrap, compares the real sidebar with the capability-derived navigation and visits all three conditional routes directly. It checks explicit denial when disabled; a browse-only product reference versus real configuration controls; the catalogue document form without submitting; and promotion resources. Screenshots and360px overflow checks remain private.

The existing `business_journey_capabilities.mjs` already owns exact subject grant mutations, command keys, version checks, entity journaling and revocation through the shared cleanup proof. The coordinator may call `observeStage` immediately after each existing change, adding the explicit Promotions-only and combined Promotions stages through the same grant mechanism. The UI adapter does not perform those writes or broaden cleanup. Preserve the existing notes/goals grants and final revoke step. Call it before account closure. A callback failure still flows into the existing parent cleanup.

The default `runJourney(ctx)` observes only the current two identities and reports `completeTransitionMatrix:false`. It must not be accepted as proof of all16 role/stage combinations. Reloading proves the new server identity is enforced after navigation, not automatic live permission pushes.

The separate `web-capabilities-hosted-journey.mjs` now composes the existing capability journey without changing its dispatcher or code. It supplies a cloned Admin SDK facade that observes the existing grant results, adds Promotions-only and combined-with-Promotions changes using the same exact subject/version/command journal, then lets the original journey perform owner-isolation and final revocation checks. Original configuration and queued-document commands remain part of the existing proved cleanup graph; workers/providers are never executed. The frozen original SDK is not modified. This wrapper expects exactly eight ordered stages for each subject and reports complete only after all16 observers pass.

`test_web_capabilities_cleanup.py` runs that exact composed SDK command sequence through real isolated PostgreSQL using `web-capabilities-local-bridge.mjs`. Three tests pass: all16 actual capability identities with exact cleanup/idempotent recovery and every original audit row retained unchanged; cleanup after an injected Promotions observer failure; and cleanup refusal when the extra grant's journal entry is omitted. The local observer validates SQL identities only, so this evidence does not claim browser rendering. The tests use the existing cleanup implementation without exceptions, remove no retained audits and never touch hosted data.

## Existing product and promotion media

`tools/squad/web-content-media-hosted-journey.mjs` exports `runJourney(ctx)`. It uses the existing exact Customer fixture and requires actual catalogue/promotions permissions. Discovery is bounded to40 ready-made products and24 promotions. It uses authorized source descriptors and fresh grants; there are no uploads, new Storage objects, source changes, worker calls or generated documents. Ready downloadable files are limited to10MB, and product ZIP images must be PNG/JPEG/WebP/GIF. No production or legacy URL fallback is allowed.

The finite checks are:

1. Select a real product checkbox; prepare images; click the real ZIP download; compare the downloaded image bytes and SHA256 to its current authorized source; check the flat manifest contains no signed URL, price or stock payload.
2. Render a genuinely missing product image; prepare its selection; verify the explicit excluded-file message and absence of an empty ZIP download.
3. Click a real promotion attachment Download control; require a fresh download grant and compare the actual browser download bytes to its authorized source.
4. Render a genuinely missing promotion attachment with explicit missing-source status and no Open/Download action.
5. Inspect any discovered external promotion's safe Open/Share controls without opening its external destination, writing the clipboard or invoking an operating-system share sheet.
6. Capture private360px controls and reject any observed command, raw-table or cross-environment request.

If bounded source discovery lacks a branch, the report records the exact unmet branch. `completeRequiredMedia` is true only when product ZIP, product missing-file, promotion download and promotion missing-file checks all ran successfully. It is false for absent candidates; an empty screen is never substituted for acceptance. Native OS file sharing remains separately unverified; actual ZIP fallback is the tested sharing path. The previously accepted garment SVG, owned catalogue PNG upload, crop and profile media journeys remain separate and are not duplicated.

Both adapters observe the parent's existing request interception without replacing its handlers. The observation detects unexpected transport; it is not a replacement network-security boundary. No media URLs, credentials or source titles are placed in public reports. Screenshots and detailed source identifiers remain under ignored private directories. The parent must continue to hold its fixture lock, retain its checkpoint and run exact cleanup even after a UI assertion fails.

## Local validation

`node --test tools/squad/web-content-hosted-contracts.test.mjs` passes five cases: exact stage/subject/authority validation; read-only request detection without altering parent interception; grant origin/type/size boundaries; bounded product discovery and reference matching; and bounded promotion discovery with ambiguous titles rejected. These checks make no database connection. They do not claim hosted browser acceptance.
