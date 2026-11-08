# Weekly report and challan output acceptance

The iteration 34 runner is `tools/squad/test_hosted_document_outputs.py`. Without
flags it performs a read-only staging preflight. The release integrator reviews
`--execute` before running it. `--recover` uses the durable business checkpoint;
the ordinary business runner must not recover an output rehearsal.

The runner repeats the existing source-valid shared-SDK business composition and
uses precisely its two workforce download requests. It does not change cutover,
run the general queue pump, contact a warehouse, or send email. The dedicated
staging-only worker route can claim only the two registered document jobs and
reuses the installed document capture, renderer, Storage, and finish pipeline.
Registration expires within both ten minutes and the existing actor rehearsal
scope. Current Auth/source authority, generation, exact lease and request checks
remain in force.

The assertions are deliberately concrete:

- The challan is for the first dispatch of one piece from a four-piece order.
  It retains that dispatch's customer destination after the order destination
  changes to head office. Its amount is INR 525, not the whole-order amount.
- The weekly document covers the original factory tailor and subtailor. Their
  one plus two completed pieces yield INR 105, with zero pending pieces, using
  the Kolkata assignment week and the shared legacy earnings formula.
- Each requester signs in through real Supabase Auth and obtains a 120-second
  private download through the shared SDK. Downloaded PDF bytes, SHA-256,
  page count and extracted quantities/amounts must match the server record.
- A different authenticated customer, an anonymous caller and the public
  Storage URL must all be denied. Local raster previews are retained privately
  for visual inspection; text extraction alone does not claim layout approval.

Cleanup first revokes the exact capabilities and refuses an active worker lease.
An uncertain request keeps its checkpoint until the lease plus a 60-second grace
has passed. This bound applies only to these two text-only, single-part fixture
reports, not arbitrary catalogues. The server's document provenance receipt and
immutable request audit must agree before database cleanup. Receipts remain
attached to retained jobs after capability revocation and document deletion. Exact random object
paths must have been absent before registration. Their Storage identities and
checksums are checkpointed before deletion; a lost delete response can be
recovered by confirming absence. Replaced objects, unexpected files, changed
requests, unreviewed dependencies or unrelated worker execution fail closed.

The existing source graph cleanup remains authoritative. It preserves command,
audit and job-attempt history, advances only the exact fixture's monotonic
revision acknowledgement, verifies the source content baseline, removes the
owned Auth fixtures and restores the precise prior Cron states. Processed output
cleanup is an explicit callback; the ordinary business rehearsal still refuses
any executed job.

## Evidence boundary

Hosted acceptance now passes at staging migration `20261108115936` and
`squad-jobs` version36. Both actual requester logins generated, downloaded and
verified one-page PDFs: challan14,052bytes and weekly13,594bytes. Extracted values,
stored SHA-256, private access denials and visual layout passed. The shared-SDK
composition made437 RPC calls with42 individual check labels across its34 groups.
Cleanup removed199 owned source rows, two processed and two queued documents,
and both exact Storage outputs; all86 source-table fingerprints were restored.
Edit/sync revisions advanced together from446 to566. Immutable command/audit/job
receipts remain. See `implementation-evidence/staging-document-outputs.json` and
`staging-document-final-state.json` for the scoped result.

The final full local discovery ran1,896 tests:1,895 passed and one excluded
Airtable timing check exceeded its budget during concurrent local activity. That
same isolated check passed at594.3ms against2,000ms. The new document SQL lane
passed92 combined tests; final cleanup/recovery and all323 Edge tests passed.

This runner does not claim automatic weekly Cron execution, business email
transport or inbox delivery. Earlier SMTP acknowledgement is not proof that a
recipient saw an email. The remaining mail acceptance must preserve actual
routing: catalogue to requester, challan to order customer, weekly to configured
eligible Admin/PC/FM recipients. Synthetic eligible identities and exact
Mailinator allowlist entries are required; substituting a single Customer inbox
for all recipients would not test that contract. Prior mail scripts that enabled
cutover and rewound revisions must not be reused unchanged.
