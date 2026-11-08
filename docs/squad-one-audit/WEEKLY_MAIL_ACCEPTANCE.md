# Controlled automatic weekly report and inbox acceptance

Status: implementation and local recovery verification complete; hosted execution and intended-inbox evidence are separate pending release checks. This capability does not activate application ownership, production mail, or generic workers. `cutover=false` is mandatory throughout.

## What this proves

The prepared runner composes the existing authenticated business journeys, then configures the existing weekly scheduler and mail settings through the shared SDK. A temporary, exact-capability Cron invocation uses the existing weekly selector, document renderer, private Storage, recipient fanout, and business-mail worker. It generates three documents and at most five messages:

| Document | Source and intended recipient | Expected evidence |
|---|---|---|
| Automatic weekly report | One newly created synthetic Tailor; existing Admin, PC and FM recipient rules | Actual latest completed Kolkata week, one row, three completed pieces, amount 105; three received PDFs |
| Catalogue | Existing catalogue request by the synthetic Admin | Exact fixture RMP selection; one received PDF |
| Delivery challan | Existing dispatch request by synthetic DI, routed to the synthetic Customer | Exact SDK-created order/dispatch; one received PDF |

Only synthetic assignment/completion dates are placed in the prior week. The rows are created during this run, and existing records and the system clock are unchanged. Rendering a report for the current week, an empty report, or a substituted direct SMTP call does not satisfy this test.

SMTP acceptance, private SDK download, PDF visual review, and actual inbox delivery are recorded separately. The runner initially writes `inbox_verified=false`. Five original inbox MIME messages must independently match their exact Message-ID, single recipient, document UUID, attachment length and SHA256 before inbox acceptance is complete.

Public Mailinator cannot prove PDF delivery: its public mailbox removes attachments or discards messages containing them. Use an explicitly supplied, attachment-capable controlled inbox. [Mailinator public-mailbox documentation](https://mailinator.com/documentation/docs/core/publicmailbox/).

## Exact authorization and isolation

Migration `20261108121935_squad_weekly_mail_rehearsal.sql` adds a private staging capability registered only through trusted direct SQL. An API caller supplies only its UUID. The capability binds the current generation, synthetic run, Admin owner, Tailor, two untouched audited manual document intents, and four current Auth/source identities with roles 0, 2, 3 and 4.

The operator supplies one plain base inbox. Four aliases are derived as `local+squad-<run12>-<role>@domain`. Arbitrary actor addresses are rejected; local-part and total email lengths are bounded. Registration requires exact equality across Auth email, source email and identity mapping, plus the synthetic `SQB <run12> role<role>` name. Public Mailinator and unsafe or oversized base addresses are rejected. Normal persona fixtures keep their existing email behavior.

The deadline is at most 15 minutes and never exceeds the runtime test-actor expiry; the runner requests ten minutes. The generic queue remains paused. The exact route can process no more than three render roots, three mail fanouts and five recipient deliveries. It cannot process warehouse work, another document, another recipient or production work. Registration is immutable; deleting it revokes the capability. A later ownership cutover cannot adopt its old queued work.

`sa_mail_lock` is a non-login, non-inheriting, non-bypass role. Its only function takes row locks on the five exact capability/configuration/schedule tables. Column-level UPDATE privileges satisfy PostgreSQL's row-lock requirement, while RLS `WITH CHECK(false)` rejects actual UPDATE statements. Browser and service roles cannot assume it or execute the helper. No privileged-definer exception is added to deployment checks.

The Edge route is `POST /functions/v1/squad-jobs/mail-rehearsal` with the existing worker secret and body `{ "capability_id": "…" }`. It uses the unchanged document and mail workers. Immediately before SMTP, a service RPC creates a durable send receipt and returns the exact capability, message, document, role, kind, recipient and attachment path. Only this one-message staging grant permits the route-local recipient. Global SMTP configuration and its normal recipient restrictions are unchanged.

A send receipt is created before SMTP. If SMTP or the finish response is lost, the delivery is not automatically reclaimed or resent. `started` and `unknown` receipts remain evidence; they are not reported as inbox success.

## Cleanup and recovery

The runner saves its checkpoint before each setup transaction commits. It pauses and restores the exact prior Cron definitions and active states, and removes only its own definition-hashed temporary Cron job. Existing mail settings and weekly schedule are restored after provenance validation.

Cleanup revokes the actor allowance and capability, then checks any active lease. An unconfirmed worker requires lease expiry plus a 60-second grace before output cleanup; otherwise the checkpoint remains. This is limited to the three bounded single-part PDFs, not a general multipart cleanup rule.

Job, document, delivery, settings, schedule-run and entry rows are locked and revalidated inside the same mutation transaction. Full row hashes and `xmin` receipts prevent a foreign change—even a same-value UPDATE—from being adopted as owned work. A new matching weekly run, unreceipted delivery/child job, unexpected document FK dependant, or unknown Storage object causes refusal. Source-schema fingerprints must return to the original contents before cleanup commits.

The three fresh Storage prefixes are server-derived. Before deletion, each PDF is downloaded, checked, saved privately, and recorded with its exact object identity and bytes/hash. Repeated recovery after a completed database cleanup uses retained server root receipts to check all prefixes, including a partially failed run that never reached its success checkpoint.

Immutable command audits, outbox entries, job attempts, send receipts and canonical worker proofs remain. Business edit revisions are not rewound. Exact-owned Auth sessions/source rows are removed; identity reservations remain blocked. Sending an email is an external effect and is not undone by cleanup.

## Local verification

Final focused evidence on a fresh isolated PostgreSQL database containing migrations through `20261108115936`, followed by `20261108121820` and `20261108121935`:

- 25 SQL capability/workflow tests passed in 6.321 seconds: actual weekly selection/fanout, five recipient bindings, no generic queue activation, expiry/generation/production denial, lost SMTP/finish responses, alias/source-name validation and role/ACL checks. Log: `/tmp/squad-weekly-mail-final-focused.log`.
- Independent reviewer: 14 full shared-SDK composition and recovery tests passed in 51.844 seconds. These cover five synthetic SQL send receipts, exact cleanup/repeat, registration rollback, live lease refusal, uncertain SMTP, foreign descendants, run/entry provenance and three mutation-boundary interleavings. They do not claim actual SMTP execution.
- 13 synthetic MIME parser tests cover exact content/identity/recipient binding, ambiguous duplicate headers, missing or extra attachments, and altered bytes. They do not claim real inbox delivery.
- Matching Edge implementation: 283 job-worker tests passed, including exact controlled-recipient capability binding. The release integrator must deploy this matching Edge version before using controlled aliases.

The parent release process owns the final integrated regression suite and hosted deployment. These focused counts do not substitute for that gate.

## Release-integrator commands

Do not run alongside another active business fixture or provider lifecycle. A retained, user-deferred warehouse checkpoint must remain intact; verify that it has no active lease or submitted order before proceeding with unrelated mail acceptance. The ordinary default is a read-only structural preflight:

```sh
PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python tools/squad/test_hosted_weekly_mail.py
```

After the matching SQL and Edge release, explicit operator selection of an inbox, and review of that preflight:

```sh
PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python tools/squad/test_hosted_weekly_mail.py --inbox 'controlled@example.com'
PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python tools/squad/test_hosted_weekly_mail.py --execute --inbox 'controlled@example.com'
```

Replace the example with the explicitly authorized inbox. The mailbox must deliver plus aliases and retain PDF attachments. Do not pass credentials. The command creates only the reviewed synthetic fixture and at most five controlled messages.

For an interrupted run, use the saved identity, capability and configuration bindings, without supplying replacement addresses:

```sh
PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python tools/squad/test_hosted_weekly_mail.py --recover
```

If recovery reports a live worker or foreign change, keep `tools/squad/private/business-checkpoint.json`; do not delete or replace it. An uncertain-send marker is never permission to retry SMTP.

Private artifacts are stored below `tools/squad/private/mail-outputs/<run>/`: three PDFs, rendered PNG pages, and `inbox-manifest.json`. Review all three PDFs visually. Download the five original messages from the explicitly authorized inbox into that private directory and verify them:

```sh
python3 tools/squad/verify_weekly_mail_inboxes.py \
  tools/squad/private/mail-outputs/<run>/inbox-manifest.json \
  /private/message-1.eml /private/message-2.eml /private/message-3.eml \
  /private/message-4.eml /private/message-5.eml
```

The verifier writes `verified-inboxes.json` beside the private manifest. Real mailbox collection remains the integrator's step; constructing synthetic MIME does not satisfy hosted inbox acceptance. Public release evidence contains role/kind/count/hash results, not credentials or recipient addresses.

## Frozen migration

SHA256: `863ed66d920dd289be760dd68674278fb866e7ab20ea3c037c5749ac7b7eb6e9`.

No production ownership, live scheduler, or generic mail activation is implied by this staging acceptance tool.
