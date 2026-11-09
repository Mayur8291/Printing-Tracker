# Catalogue media acceptance: narrow hosted rehearsal

Status: proposed for integrator review; no hosted execution and no recovery code broadened. This is separate from the already accepted own-profile media rehearsal.

## Browser scope

Use a fresh business fixture Customer and its own synthetic base product/configuration. Through the actual Products UI, select that exact fixture base, fill the known fixture configuration, and click Save reusable design. Record the `v1_configure_product` response immediately. Require a newly created product (`reused=false`) owned by this actor/current generation, not a historical product or order-derived preset.

1. Add one run-specific valid PNG through the real ProductReferenceImages `Add reference image` MediaField. Journal the reservation UUID immediately after the POST reserve response, before verification/finalization waits. Record finalization's concrete `product_images` ID; the reserved parent target is `products/<owned product>/images`.
2. Confirm a decoded image and exact same-origin fresh-grant download bytes. Enter a run-labelled note, save, then edit and save it again through the actual note form. Read `sdk.productImages` after each command to verify the note and changing product version. Exercise refetch after mutation, never accept a stale cached list as an oracle.
3. Detach that concrete image through Remove/reason/confirmation. Verify the image grant becomes empty. The source image row may remain empty; recovery removes only this audit-bound new row with the new product graph.
4. Optional separate phase, only after migration130 and Edge validation are released: Add placement in the same actual configurator, Save artwork to create a new unlinked branding design, then attach one run-specific small `.cdr` opaque fixture as application/octet-stream. Verify Download retrieves the identical bytes and the card exposes no Open, image, video, iframe or inline preview. Detach it. Do not attach the branding to an order or quote. No archive extraction or active content is needed; the opaque fixture is inert ASCII bytes with the run UUID.

All writes are actual UI commands; SDK reads serve only as independent verification. Browser request interception may journal commands, but must not replace SDK responses or Storage traffic. Run no unrelated commerce, closure or document provider work in this mode. Save only private screenshots of fixture-filtered records; publish counts/hashes, not signed URLs or credentials.

## Manifest and durable checkpoint

Introduce a separate versioned `web_catalogue_media` checkpoint section and dedicated entrypoint/recovery module. Do not relax `web_media_recovery.validate` or its exact own-profile/two-PNG restrictions.

The manifest must contain the run UUID, exact fixture Customer legacy/Auth IDs, generation, fixed fixture configuration/hash, permitted phases, one PNG plus optional one opaque file, exact deterministic filenames, bytes, MIME and SHA256, canonical `sha256/xx/hash` paths, original media/Storage/source baselines, source-table preflight maximum IDs, and audit-start watermark. Preflight proves each hash/path absent from both canonical media and Storage. New product/branding/image IDs are learned from immutable server command receipts, not trusted solely from client journal entries.

A configuration result must bind to the journalled deterministic idempotency key, current actor and generation, an exact immutable configure audit, source-row creation transaction, fixture configuration and actor ownership. Reject `reused=true`, any preexisting product, foreign configuration fingerprint ownership, an existing item/order relationship or any source row modified by a foreign transaction.

The optional branding phase additionally proves its creation command/audit, `design_owners` tuple, `item_id IS NULL`, no inherited child/order links, and the exact specification saved through the fixture UI. The general business cleanup's KIND_TABLE does not currently include branding: this requires a separately reviewed explicit audit-bound root, not a blanket branding-table cleanup.

## Storage and reference proof

Adapt the existing safe primitives by composition, not permissive target parameters:

- At most two reservations total, one per distinct manifest filename; each is from this one actor/current generation and a journalled UUID5 command key.
- PNG reservation target is exactly the proven new product/images. Its finalize result must resolve to exactly one newly inserted product_images row under that product. The result, upload row, media history, command and attached audit must agree on parent/concrete target, hash and transaction provenance.
- Optional opaque reservation target is exactly the proven new branding/attachment; content type is application/octet-stream and the manifest filename has the reviewed `.cdr` extension.
- Every attached upload has settled verification and immutable attach provenance. For incomplete reservations, preserve the checkpoint until signed PUT/verification execution cannot continue (retain existing expiry +2h10m rule), then prove exact pending bytes before deletion. Do not shorten this waiting rule merely to make the test finish.
- Reject any foreign upload, source marker, admin override, document attachment, media reference, inherited branding or other object referencing a manifest hash. Concrete product image references may only use the one proven inserted image ID.
- Canonical/pending Storage IDs, metadata, filename, MIME, byte count and SHA256 must match the manifest. Read and hash exact bytes using the existing bounded service-side proof. Recheck all metadata/provenance immediately before deletion; persist receipts before deleting anything.
- Delete only exact `pending/<upload UUID>` and exact canonical hash paths through Storage API. Never prefix-delete a directory or use a user-wide/record-wide deletion query.

## Database cleanup and monotonic accounting

Disable only this fixture write allowlist before recovery. Preserve environment, generation, cutover=false, no active sync, original cron definitions, and existing staff Auth exactly as the business runner already does.

After proven Storage removal, remove only the exact owned test references/objects. Remove the new product_images/product and optional unlinked branding source graph using immutable audit-derived roots and owned transaction IDs. Keep upload rows, media history, command receipts and audit history. Do not rewind entity/environment revisions or erase rejected attempts. Retain or explicitly classify owner/cache history according to existing business recovery contracts; a clean source digest alone is insufficient to invent ownership of those domain rows.

Require equality with preflight source digests and media/Storage snapshots, unchanged unrelated public structure/Auth, no surviving test blob references and no foreign revision delta. Only then acknowledge the exact net-zero fixture revision delta through the existing cleanup audit. If any proof is incomplete or concurrent edits are detected, refuse cleanup and retain the checkpoint and receipts.

## Local recovery rejection tests required before execution

- Forged product ID; reused foreign or preexisting product; wrong configuration; mismatched actor/generation.
- Fake concrete image ID; image belongs to another product; attached audit/result mismatch; non-owned comment update transaction.
- Branding linked to any item/order/child, wrong owner, wrong attachment field or unsupported extension.
- Missing reserve command; altered filename/MIME/bytes/hash; duplicate or extra reservation.
- Foreign reference/admin override/document attachment/upload using a test hash.
- Storage bytes or object metadata changed between receipt and deletion.
- Incomplete verification before safe expiry; interrupted Storage deletion with idempotent receipt-based retry.
- Unchanged baseline objects preserved; retained upload/history/audit; exact monotonic revision/source/media baseline proof.

The implementation should begin with the PNG/product-only phase; the opaque branding phase becomes executable only after its independent root/owner/cache recovery assertions and migration130 deployment are verified. Passing profile media or synthetic local tests is not evidence for these two new targets.

### Local runner checkpoint (9 November)

The dedicated runner is `tools/squad/test_web_catalogue_media_hosted.py`. Its default invocation is a read-only preflight. Execution supports the PNG flow alone or `--opaque` for the additional exact unlinked-branding `.cdr` flow. Recovery reads only the `web_catalogue_media` marker, rejects other rehearsal capabilities, and uses the shared business checkpoint and the same exclusive/shared refresh lock. Generic business recovery now rejects this marker.

The real `plan_fixture` shape drives the runner tests, including the distinction between `fixture.ids` and `fixture.commercialExtras`. Eleven isolated PostgreSQL orchestration tests pass, in addition to the 21 media ownership/recovery tests. The tests cover no-credential default preflight, real fixture rollback after a browser failure, checkpoint retention on unsettled cleanup, forged browser reports, active attachments, exact downloads, and repeated cleanup. The JS capability is tested using a payload constructed by the real Python fixture preparation. Browser root/upload observations are durably journaled before response assertions and remain explicitly non-authoritative: cleanup independently binds immutable server commands, audits, generation, exact source transaction IDs and Storage byte receipts.

No hosted execution or acceptance is implied. The release integrator must review the dedicated runner before executing it. Existing app freeze and release coordination still apply.
