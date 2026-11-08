# Business email implementation

The existing `squad-jobs` worker now handles all business email through one bounded, per-recipient delivery model. No additional Edge Function or client-selected email endpoint is introduced. This lane is implemented and locally verified; it does not claim that a hosted SMTP delivery has been completed.

## Source behavior and reuse

The approved Rails `develop` source was audited at `tools/canto-sync/private/audit-sources/rails-develop/app/`: `mailers/{order_mailer,user_mailer,bulk_upload_mailer}.rb`, their views, `services/{create_order,update_order,check_item_prices,auto_approval_user,weekly_tailor_report,create_dispatched_quantities_stats}_service.rb`, the people/customer controllers and catalogue/bulk-price jobs.

| Message | Source trigger and preserved data | Current recipient |
|---|---|---|
| Dealer order created | Committed order/backorder; order number, creator, products/categories, quantities, amounts and GST totals | Current dealer assigned to the order |
| Price override review | Initial order override or committed price amendment; first current differing item, original/changed prices, customer and coordinator | Configured application administrators |
| Bulk ready-made price result | Price import reaches completed/failed/invalid; total, valid, invalid, applied and available inserted/updated/duplicate/skipped/failed counters | Configured application administrators |
| Welcome | Successful new-person Auth reconciliation, or successful customer approval reconciliation; role and secure access guidance | Newly eligible account itself |
| Catalogue PDF | Existing generated document completes with email delivery requested | Current original requester |
| Dispatch challan PDF | Existing generated document completes with email delivery requested | Current order customer, including a dealer ordering as customer |
| Weekly tailor PDF | Existing generated document completes with email delivery requested | Configured operations/finance users with current access to the tailor, factory and captured items |

Price checks follow the source's positive-price override guard and compare inequality; a higher override also requires review. A pending provider amendment cannot emit its final price email before confirmation. A resolved price difference is recorded as explicitly skipped, with no SMTP send. Dealer messages show at most 50 items and explicitly identify truncation; they retain order totals and direct the user to the order for the remaining items.

Legacy hardcoded employee addresses and developer BCCs are replaced by configured user IDs. Legacy plaintext-password welcome emails are replaced by secure invitation guidance; password recovery, invitation codes, registration proof and email changes continue to use the existing account challenge service. Unapproved registration does not receive an account-ready email. Auth reconciliation and later approval determine eligibility.

## Database and worker contract

Migration: `supabase/migrations/20261108085500_squad_business_mail.sql`.

`business_mail_settings` and `business_mail_deliveries` are private RLS-protected tables. Public clients use only these administrator RPCs:

- `v1_mail_settings_read()` returns each kind, configured state, recipient IDs as strings and version.
- `v1_mail_settings_save(p_kind, p_recipient_ids, p_expected_version, p_idempotency_key)` performs current-role validation, compare-and-swap versioning, idempotency and audit recording. At most ten distinct users are allowed. Price/bulk recipients must be role 0; weekly recipients may be roles 0, 2 or 4 and must also pass current resource scope at delivery. Empty configuration is explicit and results in a visible configuration failure when a message needs it.

Trusted source commands create `business.mail_fanout` jobs. Existing `document.mail` jobs now perform recipient fanout and no SMTP send. Each recipient gets one `business.mail_delivery` job with handler `business_mail`. The worker uses service-only `squad_business_mail_prepare(p_id,p_lease_token)` and `squad_business_mail_finish(p_id,p_lease_token,p_code)`.

Preparation checks the current generation, cutover state, active lease, current Auth account, source role/approval, configured recipient membership and resource ownership. It never trusts a browser email or borrows the original requester’s identity to deliver to another user. A reassigned customer/dealer, changed role, disabled/banned user, removed configuration or changed factory/item scope prevents delivery. Email address and content freeze at first preparation; a later email change fails the original intent rather than redirecting its contents. The recipient context exists only inside the leased transaction and is removed afterwards.

SMTP confirmation produces `SENT`; unavailable transport produces bounded backoff and at most five attempts. Other typed errors are `MAIL_NOT_ENABLED`, `MAIL_NOT_CONFIGURED`, `MAIL_RECIPIENT_UNAVAILABLE`, `MAIL_MESSAGE_INVALID` and `MAIL_ATTACHMENT_LIMIT`. Expired final leases and source refresh update private delivery/document state immediately. Administrator job retry can recover provider/configuration failures while preserving identity/content binding; the next preparation repeats authorization. An expired document cannot be retried. A multi-recipient document is sent only when every recipient has succeeded, and reports failure if any required recipient fails.

## Transport and limits

`supabase/functions/squad-jobs/business-mail.ts` reuses the existing SMTP configuration and document Storage reader. Templates use plain text and allowlisted fields. Header injection, oversized content and unsupported roles are rejected. Private PDF attachments require an authorized fixed document path and the existing Storage reader's size/hash verification; there are no caller URLs or filesystem reads.

The text/data limit is 64 KiB; PDF attachments are limited to 10 MiB. A larger generated PDF remains downloadable through its normal authorized document flow, while email explicitly fails with `MAIL_ATTACHMENT_LIMIT`. No unusable owner-only download link is substituted for a customer or finance recipient.

SMTP uses pinned Nodemailer 10.3.1, verified TLS, supported ports 2525/465, a 35-second overall deadline, and shorter connection/greeting/socket limits. URL/file access is disabled. These settings use the documented [SMTP transport](https://nodemailer.com/smtp) and [message configuration](https://nodemailer.com/message) contracts.

Every delivery has a stable Message-ID. A confirmed `SENT` job is not sent again, and a lost database finish response is not followed by a second send inside the same invocation. SMTP has no verified idempotency receipt API: if the provider accepted a message but its acknowledgement was lost, later retry can duplicate it. Stable Message-ID helps correlation; it does not provide exactly-once delivery or prove inbox receipt.

Staging fails closed unless the exact recipient is in `SQUAD_MAIL_ALLOWLIST` and ends in `@mailinator.com`. An unknown Supabase project is denied. No synthetic test sends to a real recipient. Production uses its own project/configuration and remains subject to the explicit production release gate.

## Local evidence and hosted acceptance still required

- 30 business-mail SQL tests, plus 188 document, notification, account and account-flow regression tests: **218 passed** in the isolated `squad_test_mail` database.
- 13 business-mail Edge tests; the complete current `squad-jobs` suite: **159 passed**.
- Business-mail and warehouse TypeScript checks passed.
- Existing document tests were adapted to inspect the recipient child job, retaining authorization, replay, retry, retention and refresh assertions.

Commands:

```sh
SQUAD_TEST_DATABASE=squad_test_mail PYTHONPATH=tools/squad tools/canto-sync/.venv/bin/python -m unittest test_business_mail test_documents test_notifications test_accounts test_account_flows -q
deno test --config supabase/functions/squad-jobs/deno.json --allow-env --allow-read supabase/functions/squad-jobs/
deno check --config supabase/functions/squad-jobs/deno.json supabase/functions/squad-jobs/business-mail.ts
```

Before hosted acceptance, wire the shared worker/RPC allowlists, deploy to staging, configure eligible synthetic recipient IDs and exact Mailinator addresses, and verify one received message for each family, private PDF attachment bytes, repeat-job behavior and a revoked recipient. Missing SMTP/recipient configuration is a visible deployment gate. No hosted send, provider availability or production readiness is inferred from synthetic tests.
