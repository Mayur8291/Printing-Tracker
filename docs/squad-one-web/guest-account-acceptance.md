# Guest account acceptance

Status: independently reviewed and frozen locally; **not deployed or executed against hosted staging**. This is a separate test capability, not a change to native business authorization or a global mirror cutover.

The browser adapter covers registration, confirmation, recovery, and invitation using the same `AccountFlow` components and Edge routes as the product. Invitation begins from the actual administrator People page. Every flow checks local password mismatch, actual wrong-proof rejection, real mailbox proof, the resulting approval state, and real Auth login with the new password. Existing-account flows also reject the previous password. Recovery additionally requires the previous live session and refresh token to fail; that last behavior still needs real GoTrue evidence and must not be inferred from a successful password update. Supabase's [admin update reference](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) documents the update operation but does not establish our application's immediate session-revocation guarantee.

## Scope

- CLI-created migration `20261108190645_squad_account_rehearsal.sql` follows121. Its final provenance revision passed independent security review and is frozen pending integrator release.
- Exactly four immutable flow capabilities per run, at most four active globally, staging only, mirror mode, same generation, maximum15 minutes, exact synthetic administrator and existing target bindings.
- Exact inboxes are `squad-guest-<run UUID without hyphens>-<purpose>@mailinator.com`; they are not aliases for, redirects to, or replacements of a real user's email.
- Capabilities can only be inserted by the trusted SQL operator. API, application, and service roles cannot insert/update/delete them or alter receipts. Revocation is a separate one-way durable record.
- Registration's future source/Auth IDs are bound by its real proof-preparation receipt. The new Auth UUID has only a provider-phase exception while its exact prepared flow and credential lease are current. It is never added to the general test actor allowlist.
- Generic worker fencing, generic queue claims, schedules, unrelated mail, and native cutover remain unchanged.

## Product corrections

The UI now matches the backend password policy: at least12 JavaScript characters and at most72 UTF-8 bytes. The invitation email includes the exact invitation request ID that its existing guest form requires. No arbitrary hostname or action URL is accepted from a client.

## Mutation and cleanup evidence

Original account RPC implementations remain private invoker cores. Their original public wrappers retain their owners and ACLs; the wrappers append phase receipts after successful calls, including wrong-code business results. Scope checks compare current source/mapping/flow/job/credential hashes with the last receipt before further work. Auth login timestamps are excluded from credential fingerprints.

A credential update's immediate trigger only captures transaction-local pending evidence. It does **not** authorize cleanup. Existing deferred password/flow-marker validation must succeed, advance the matching credential revision, and attest the same Auth UUID before the pending deltas become immutable receipts. An unrelated ban-only change receives no owned receipt; it makes the next hash/revision proof fail. A regression covers this distinction.

The pending OLD-to-NEW credential fingerprint chain must begin at the last immutable receipt. An intervening foreign metadata edit cannot be incorporated into an otherwise valid provider update and thereby become cleanup authority.

The cleanup helper removes only the exact synthetic users, their receipt-bound addresses and dealer links, and their Auth identities/sessions. It retains blocked identity reservations, legacy identity keys, domain audits, flow/outbox history, capabilities/revocations, phase receipts, and normal Auth logs. Jobs are terminalized rather than removed. Source table contents must match the prefixture digest before commit. Every edit-revision increment must be proven by a receipt; the revision never moves backwards. The synced watermark advances only by the proven net-zero synthetic delta.

Cleanup handles setup-only, requested-but-not-completed, registration source-created before Auth, provider-committed before finish, and fully completed flows. Unknown source/credential changes, extra revisions, foreign children, or public schema changes cause rollback and retain the checkpoint. Current unrelated staff Auth rows are locked and preserved; a baseline difference is reported, never restored or concealed.

## Delivery boundary

`/squad-jobs/account-rehearsal` requires the existing worker bearer and exact staging project. It accepts one job UUID, calls only its private SQL claim, and runs the existing account-mail processor. SQL binds the challenge job to the exact flow/guest actor/purpose/generation/payload. The worker then rechecks returned flow, actual recipient, purpose, lease, and expiry before creating a one-recipient SMTP allowlist. It does not invoke generic queues or maintenance. An uncertain first SMTP attempt is not automatically retried by this acceptance harness.

The harness obtains the eight-digit proof from the real Mailinator inbox. No database code extraction, decrypted-code shortcut, fabricated OTP, or recipient redirect is provided. The controlled operator verifies the exact run-specific mailbox and subject before entering its observed code into the masked prompt. The SMTP-submitted Message-ID is retained as submitted metadata only: providers may replace it, and it is not claimed as observed in the inbox unless separately verified. The observed unique recipient and proof accepted by the exact flow establish the delivery boundary. Codes/passwords/tokens are never written to the checkpoint or report.

## Files and execution contract

- `tools/squad/guest_account_fixture.py`: read-only plan, exact preparation, revocation, phase receipt validation and monotonic cleanup.
- `tools/squad/test_web_guest_hosted.py`: explicit `--execute` / `--recover`, default read-only preflight. Uses an isolated browser, checkpoint, bounded780-second deadline and paused/restored Squad schedules. Run only after the integrator approves the deployed migration/worker and this exact artifact.
- `tools/squad/web-guest-hosted.mjs`: real UI orchestration and real Auth/read oracles.
- `tools/squad/web-account-entry-adapter.mjs`: shared guest form browser interactions.
- `tools/squad/test_account_rehearsal.py`: capability, native-regression, revision, mirror, foreign scope, provider lease and SMTP-job boundary tests.
- `tools/squad/test_guest_account_fixture.py`: completed/partial cleanup and negative attribution tests.
- `supabase/functions/squad-jobs/account-rehearsal_test.ts`: exact SMTP recipient and route tests, using local injected transport only.

No production execution is part of this harness. A successful local run is not evidence that real mail, real GoTrue ordering, or hosted guest flows have passed.

## Local validation and durable evidence

The frozen version passes 61 SQL capability/native-regression tests, 58 fixture/native-regression tests, four actual-database release-guard tests, 23 foundation tests, and 43 Edge tests. The two SQL suites intentionally include the same 51 existing account-flow regressions; these counts are suite results, not a claim of distinct tests. Negative release checks exercise each privileged helper's owner, search path, definer status and API/executor grants against the shared release guard.

During hosted execution, partial flow results and observed-mail metadata are saved privately to `tools/squad/private/guest-result-<run>.json` without codes, passwords or tokens. Only successful completion plus exact cleanup produces `docs/squad-one-audit/implementation-evidence/staging-web-guests.json`. Independently changed staff Auth rows produce an explicit qualified result instead of a claim that the baseline was unchanged.


## Selected-flow debugging and failure diagnostics

The optional `--flows recovery,invite` runs only those two browser/email purposes; omitting it retains all four. The canonical selected set is checkpointed before preparation and cannot be changed by `--recover`. All four capability manifests and allocated fixture accounts remain in the original cleanup scope, including unselected purposes. The parent accepts only selected request IDs and requires one completed result per selected purpose.

A subset result lists requested and untested flows, sets `all_flows_passed` to false, and uses a distinct artifact such as `staging-web-guests-recovery-invite.json`. It never overwrites the all-flow artifact or claims complete guest acceptance. One actual SQL regression executes recovery/invitation only, then proves that unchanged cleanup removes every allocated synthetic account, revokes all four capabilities, and preserves the two completed flows' evidence.

Failure evidence contains only fixed purpose/stage/type/code values and at most eight approved source basenames with bounded line/column numbers. Raw error messages, stack headers, paths, payloads, inbox addresses, proofs, passwords and tokens are discarded. The parent validates this shape and persists it before lengthy cleanup. A local rendered recovery form test passes the correct proof flow and confirms that a missing completion status produces the specific safe timeout stage; this is local fixture transport evidence, not a hosted recovery pass.

Current focused additions pass four selection tests, one strict Python diagnostic test, two JavaScript sanitization tests, two rendered recovery checks, and the 61-test account/fixture SQL suite (including the existing account-flow regressions).
