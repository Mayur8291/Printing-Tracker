# Shared notification contracts — iteration 25

The four planned RPCs are implemented on staging: `v1_device_save`, `v1_device_remove`, `v1_notifications_list`, and `v1_delivery_failures`. They reuse the existing `squad-jobs` deployment. No new Edge deployment or business-schema copy was added.

`packages/shared/squad-notification-rules.json` records all 115 mapped legacy strategies, actual recipient helpers, template evidence and static/dynamic callsites. `tools/squad/notification_registry.py` regenerates it from pinned local Rails source. Main/develop notification directories match. The runtime uses 25 legacy topics plus shared task assignment/removal/change and rating topics. It does not instantiate 115 handlers. Dynamic `UpdateNotificationOrderService` branches are explicitly covered; an absent numeric callsite does not imply an unused feature.

| Event family | Shared routing and variations |
|---|---|
| Registration/customer assignment | Admin recipients for verified registration; the current assigned SC for customer creation/reassignment. Pending customer approval remains distinct from email proof. |
| Placement | Customer/Dealer/SC × readymade/custom × direct/dealer route. Duplicate Admin recipients collapse within the event/topic. Mixed placements use the custom route; current acceptance separates physical families. |
| Order editing | Legacy dynamic branches 78–96 retained in one selector. Mixed edits use the legacy readymade selector. Current public amendment permission remains SC-only; private routing configuration does not grant other roles edit rights. |
| Prices/completion | Server-priced overrides and applied changes to retained line prices emit the appropriate price topics. Quantity-only edits do not. Factory dispatch/jobworker completion emits completion alerts only when the order reaches its completed state. Queued edits/cancellations do not announce success early. |
| Factory execution | Due date, manager/cutter/jobworker assignment, cutting, tailoring allocation, inspection, dispatch, worker cost and stages share captured relationships and current recipient checks. Source completion flags are 0/1; worker stages begin at 0. |
| Tasks | Added assignees plus Admin; removed assignees receive a generic removal record without a resource link; content/status changes go to creator/current assignees/Admin, excluding the actor. |
| Ratings | Recipient plus Admin only for a new or changed score. Comment-only changes do not reproduce the old score-change detection bug. |
| Provider-originated order states | Processing, provider cancellation, partial pickup and dealer-ready routing contracts exist. Their real warehouse/webhook producers remain part of the integration milestone; this document does not claim those providers are implemented. |

Type 92 called a missing legacy recipient helper. Its explicit correction resolves the order customer and then checks current access. Type 20 actually resolves the dealer, despite its class name. Price types 97–99 are not cancellations. Helper behavior and the dynamic source selector take precedence over misleading comments/range classification. Legacy dealer helpers require `customer_dealer_id`; no guessed substitute account is introduced.

## Queue and authority

Domain commands insert events transactionally. A private outbox trigger captures only recognized event families and relationship IDs. It has no provider calls and is not attached to imported business tables. Parent links retain provenance and allow exact-owned test cleanup. Refresh imports enqueue nothing.

Fanout resolves at most 100 recipients per transaction and resumes with an ID cursor. One delivery job per recipient/event/topic creates one inbox record; multiple mapped strategy IDs remain traceable without duplicate records. Delivery derives its actor from a live, service-only lease bound to that recipient. The existing Auth/source-role/resource/capability checks apply again before creating the record and preparing a push. Changed assignments, roles, approval, disabled accounts and Auth bans can suppress queued delivery. Removed task assignees receive only a generic removal notice.

Historical `sa_notifications` rows remain available only to their recipient. Raw old titles/bodies can contain private prices, names or factory details, so the API projects a shared topic title and links only to currently readable resources. Current detail RPCs supply authorized values. Neither historical nor new push payloads expose financial/template variables.

FCM receives generic text and `{notification_id,generation,project_ref,environment}`. The SDK's `notificationFromPush(payload, projectRef)` rejects another project and asks the database to reject an obsolete generation before resolving an inbox ID. Clients navigate only to the returned current `target`. No push body is a permission grant.

Delivery is **at least once**. The inbox identity and platform tag are stable across retries; uncertain network responses can still produce repeated provider acceptance. FCM acceptance is not a physical-device delivery receipt. Results distinguish `validated`, `accepted`, `inbox_only`, `skipped`, and pending work. Per-device successes are retained across partial retries. Only a typed FCM `UNREGISTERED` response retires the exact still-current binding; IAM/configuration failures do not remove devices. Retry-After/backoff is durable, calls are time-bounded, and batches use at most three concurrent provider requests. Failed attempts are visible and eligible failures use the existing versioned `v1_job_retry`.

## Device/client integration

All 11 login personas share the same device/inbox contracts. Tailor/SubTailor remain managed subjects without fabricated logins. Printing Tracker operators can inspect/retry delivery failures without becoming legacy users.

Use `saveDevice(installationId, platform, fcmToken, command)`. Generate and persist a registration UUID scoped to the project and signed-in account. Keep the returned binding ID/version and an uncertain command's original idempotency key. Refresh registration at app startup/token rotation; bindings expire after 45 days. Up to ten active devices and 60 changes per hour are allowed. The exact unchanged token can recover a lost local version. Token changes/removal require the current version. Call `removeDevice` before logout. Presenting the exact opaque token while switching accounts retires its prior binding; delayed results cannot retire a rotated/new-owner token.

Tokens remain in a private operational table and are absent from SDK results, audit, command payloads and outbox. Imported `sa_user_devices` tokens are never automatically subscribed. Refresh invalidates active bindings; it also invalidates old queued jobs and prevents notification-ID reuse from becoming a deep link to another generation.

The token must be a **Firebase registration token**. Expo's native iOS token is APNs, and Expo Push Service tokens are a different protocol. The future Expo UI needs native Firebase integration/custom development builds or a separately reviewed provider adapter. [Firebase HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [Expo custom push delivery](https://docs.expo.dev/push-notifications/sending-notifications-custom/).

Staging is hard-gated to Firebase validation mode, including if a delivery setting is mistakenly enabled. Production requires its own reviewed release configuration. This milestone sent no physical push and changed neither DigitalOcean nor production.

## Evidence and outstanding acceptance

- 1,070 database tests, including 51 notification cases; Edge and SDK checks are recorded in the execution journal.
- `staging-notifications-performance.json`: real coordinator due change → fanout → current-recipient inbox/device preparation; rolled back, with 20k unrelated inbox rows and disjoint pages.
- `staging-notifications-sdk.json`: actual SDK registration → deployed worker → Google OAuth/FCM validation → scoped inbox/push resolution, followed by exact-owned cleanup. Unused sequence gaps remain; counters were not blindly rewound.
- `staging-notifications-provider.json`: independent read-only FCM validation; no automatic device subscription.
- `staging-notification-amendment-regression-before.json` retains the 545 ms failure. The scoped read-only price comparison restored the small-amendment p95 to 486 ms; the final amendment evidence retains the complete measurements. This remains close to the 500 ms target and is included in final mixed-load review.

Physical-phone foreground/background behavior belongs to the later mobile UI acceptance. Provider-originated event producers, business/document email orchestration, and the complete mixed-load/persona/cutover gates remain open. A green notification suite is not a claim that the entire rebuild is complete.
