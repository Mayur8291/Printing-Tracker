# Catalogue and terms output acceptance extension

Status: local implementation complete; migration 123 is frozen for independent review. No hosted acceptance has been executed by this lane. The release integrator owns hosted execution and promotion.

## Run and authority

Use a separate staging business fixture with workers paused and no account closure. The actual Customer browser selects the fixture's one ready-made class, supplies a unique synthetic UTF-8 terms file, uploads through the existing reserve → signed PUT → verify/finalize protocol, and requests a download catalogue. No fake branding/profile entity is used for terms. The run never changes cutover, invokes a generic worker, sends email, or accesses an external provider.

The driver journals deterministic browser UUIDv5 command keys before use, records the unique source file hash/bytes and absent canonical Storage path before upload, and checkpoints the final attachment and document IDs only after checking their server command/audit ownership. The request must resolve to exactly the known fixture class/product set and the attachment created by this Customer. A browser-returned ID is a candidate, not deletion authority.

## Additive SQL scope

Allow `catalogue` in the existing exact document rehearsal register/scope allowlists. Preserve the existing maximum of two active capabilities, current actor/generation/test-write expiry, download-only condition, untouched queued document prerequisite, immutable request hash, exact job lease and private output path. Existing weekly/challan behavior stays unchanged. The standalone catalogue harness registers only one exact job.

Add nullable attachment identity/xmin/row-SHA256 fields to the retained document rehearsal receipt. Registration captures the current ready actor-owned `catalogue_terms` attachment after the request's legitimate expiry extension. Before every worker operation, compare its current row with that receipt, just as the document row is checked today. After exact `prepare`, record the updated attachment claim row atomically with the document receipt. `finish` must preserve the established claim and hash. A foreign edit between phases must fail; a retry must never bless a changed attachment.

Worker access to the attachment is read-only and restricted to the active exact document rehearsal's request reference, actor and generation. No client gains access to the receipt or capability tables, and there is no new service-facing arbitrary-row reader. Unrelated document requests and catalogue emails remain unavailable to this staging capability.

## Cleanup ownership

Reuse the existing output Storage receipt/lease recovery implementation, adapted through a separate catalogue binding path rather than loosening the two weekly/challan binder. The new harness accepts a single-part catalogue only (bounded fixture rows, no parts objects). Unknown paths, extra objects, multipart work, foreign edits and unsettled leases retain the checkpoint.

Terms ownership needs two immutable chains:

1. Reserved upload command → exact attachment ID/actor/generation/purpose/file manifest; finalize command/audit → upload result and media reference.
2. Browser document request command/audit → exact terms reference; retained worker receipt → post-capture attachment xmin/digest.

Before any Storage deletion, validate the current generation and every attachment/media reference and upload that could reference the unique canonical hash. Reject foreign upload IDs, other document requests/snapshots, other media references or overrides. Verify the exact Storage catalog record and re-download bytes to compare the preplanned hash/size; revalidate inventory immediately before each exact-path delete. Preserve all commands, audit rows, upload history and worker attempts.

Unfinished upload recovery must use the existing application expiry plus **2 hours 10 minutes** bound, because a signed upload URL may be reissued just before application expiry. Expiry plus one minute is insufficient. A successful attached upload may be cleaned after observed finalization and browser shutdown, with the immutable finalize proof and no in-flight request. Output workers use the existing lease plus grace rule independently.

Once exact output and input objects are removed, remove only the proven fixture documents, attachment row, corresponding media reference and newly introduced canonical media catalog row. Do this in the existing atomic business cleanup transaction, after a narrowly scoped attachment-aware callback. Compare source/Auth/media/Storage baselines; any discrepancy refuses the transaction. Retain the checkpoint if Storage or database cleanup is uncertain. Never delete audits or rewind revision counters.

## Acceptance checks

- Real browser file selection, progress, reserve/PUT/finalize, typed attachment display and catalogue submit.
- Owner media grant succeeds; foreign persona and anonymous grant fail.
- Queued detail polls to ready without reload; real Prepare download/Open PDF works.
- Downloaded PDF byte count/SHA matches published receipt; catalogue includes only fixture products/prices.
- Extract embedded `terms.txt` using pypdf and compare its complete bytes/SHA to the original synthetic upload.
- Poppler raster and actual desktop/mobile document screens receive visual review.
- Lost response at reserve/finalize/request/prepare/finish/delete and foreign row/object/reference edits fail safely in local tests.
- Cleanup proves source/Auth/media/Storage restored while commands, audits and worker attempts remain.

Actual hosted acceptance and production promotion remain parent-owned. Passing local tests or this design review does not mark the catalogue/media workflow accepted.


## Implemented acceptance entry point

`tools/squad/test_web_catalogue_terms_hosted.py` defaults to preflight; the release integrator may run `--execute` after review or `--recover` for its retained exact-owned checkpoint. It runs the real browser adapter in two phases, validates browser-returned IDs against server command/audit evidence before registering the one job, preserves private reports before cleanup, verifies captured prices and the embedded original file using an actual PDF parser, and produces Poppler page images for visual review. It does not run the commerce/account/provider workflows.

Local checks currently pass: 11 SQL capability cases, 11 immutable recovery cases, 4 orchestration boundary cases and 4 actual PDF parsing cases. A successful local run is not hosted acceptance. A partially uploaded object intentionally retains the checkpoint until the existing signed-upload expiry plus two-hour-ten-minute bound if it cannot prove a completed attachment.
