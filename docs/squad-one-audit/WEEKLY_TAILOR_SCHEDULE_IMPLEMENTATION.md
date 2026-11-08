# Scheduled weekly tailor reports

Migration `20261108092021_squad_weekly_tailor_schedule.sql` completes the scheduled part of DOC.04 and OPS.03. It reuses the existing weekly earnings formula, document snapshot/PDF worker, private document Storage and business-mail delivery. It does not add another Edge function or separate scheduler.

The Rails `WeeklyTailorReportJob` invokes `WeeklyTailorReportService`, scheduled Saturday 00:01 by the original Sidekiq configuration. The service iterates root tailors, reports the previous Saturday–Friday and uses the same earnings service as manual reports. The new scheduler makes the approved `Asia/Kolkata` timezone explicit. This is not evidence that the old server's operating-system timezone was verified.

## Operation

First configure real authorized users in the existing `tailor_weekly` mail-recipient settings. A current legacy administrator (role 0) can then call `v1_weekly_tailor_schedule_configure(enabled,expected_version,idempotency_key)`. The enabling administrator explicitly delegates the automation under their own identity; no arbitrary administrator or user UUID can be supplied. Configuration is off by default, idempotent and versioned.

`v1_weekly_tailor_schedule_status()` returns enabled state, the delegated owner, configured/current generation, next report week, last scheduler error, version and the last ten run summaries. A run marked `queued` means its bounded document fanout completed; it does not claim that PDFs were rendered or emails delivered. Those results remain visible in the existing document and job APIs.

The existing minute Cron should invoke service-only `canto_api.squad_weekly_tailor_heartbeat(25)` under its established service-worker context. Cron installation is handled by the shared scheduler integration, not this migration. [Supabase Cron supports executing database functions directly](https://supabase.com/docs/guides/cron); rendering and SMTP remain in the existing jobs worker.

Each heartbeat creates at most 25 fixed weekly document requests. Root tailor subjects use role 5, exclude soft-deleted records, and include disabled workforce subjects because completed work may still need reporting. Subtailor team expansion is false, matching the source scheduled service; manual reports retain their existing team option. The scheduler performs no earnings computation, HTTP, rendering, mail send or business-data mutation.

The first enable starts with the latest completed report week only. At Saturday 00:00, the just-ended week is not eligible until00:01. A persistent next-week cursor subsequently catches missed weeks one at a time. Every run fixes its maximum tailor ID before pagination, so newly added tailors cannot extend a running scan indefinitely. A row lock with `SKIP LOCKED`, a unique generation/week run and a unique run/tailor document entry prevent repeated or concurrent heartbeats from duplicating requests. An empty population completes without creating empty placeholder documents.

## Authority and failure handling

Mirror mode and an active refresh pause the scheduler. A generation change requires explicit re-enablement and resets the initial catch-up week. Invalid current owner mapping/role or missing authorized mail recipients pauses without advancing the week. The existing document worker verifies the owner's current Supabase Auth state and role, including bans, before capturing or publishing a PDF. A banned owner can therefore leave a visible failed queued intent but cannot render or send its report.

Recipients come only from the existing current operations/finance user configuration, with roles 0/2/4. Each delivery independently rechecks current identity, configuration, factory and item scope; a reassigned or unauthorized recipient does not receive the PDF. No hardcoded staff email, password or client-supplied destination is used. Disabling the schedule revokes pending scheduled render/mail authorization as well. Manual document requests are unaffected. Changing the delegated owner affects future requests; queued requests retain their original owner and current-authority checks.

Document limits, part rendering, checksums, current-scope download grants, retries and SMTP ambiguity are exactly those of the existing document/business-mail services. Worker failures remain visible; scheduler fanout completion never substitutes for provider delivery proof. A revoked/dead request can be recreated through the authorized manual document flow after its underlying issue is resolved. Staging sends still require the existing explicit Mailinator recipient allowlist; these tests do not send messages.

## Verification

23 focused synthetic SQL tests pass. A combined 284-test run passes across weekly scheduling, Airtable reports, business mail, documents, notifications, account flows and tailor earnings. Coverage includes the exact Saturday 00:01 Kolkata boundary, first-enable catch-up, missed-week resumption, pages and fixed ceiling, repeat safety, a second-connection nonblocking heartbeat, current owner demotion/banned Auth, mirror/generation fences, refresh→disable→re-enable, recipient configuration removal, post-queue/post-render disable, empty/deleted subjects and the existing PDF→mail pipeline. All work is local synthetic data; no hosted Cron activation or real SMTP acceptance is claimed by this lane.

Twelve local synthetic heartbeats queuing 25 documents each measured median 6.93 ms and maximum 7.47 ms. This measures queue creation only, not PDF rendering, SMTP or production load.
