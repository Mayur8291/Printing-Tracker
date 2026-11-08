# Notification source acceptance

The notification fixture gap is closed for the behavior recoverable from the approved source. **12 grouped executable tests** compare literal source-derived expectations against **46 distinct order/account/production dispatch branches**, all **115 registered recipient-helper contracts**, task lifecycle deliveries and rating deliveries. The 46 branches exercise **114 strategy types**; the remaining type, **115**, has no original producer. Registry membership is not presented as evidence of a producer.

Validation: `test_notification_source_goldens`, `test_notifications`, `test_warehouse_notifications`, `test_ratings`, and `test_work_management`: **142 tests passed in 2.927 seconds**, using isolated synthetic `squad_test_transfers`. No hosted write, external message, device registration or provider call occurred. The new files change test evidence only; no runtime SQL change was needed.

## Evidence and independence

- [Literal source fixture](../../tools/squad/fixtures/notification_source_goldens.json): source commit, per-strategy Ruby path/line/hash, shared controller/helper hashes, literal expected recipient IDs/types, exact resource targets, and dormant-producer labels.
- [Executable checks](../../tools/squad/test_notification_source_goldens.py): the expected recipient sets are not computed from SQL, the current routing registry, or production helper functions. Each branch resolves the real plan, claims actual queue leases, fans out, performs current-authority preparation, records inbox-only completion and reads the recipient’s public inbox projection.
- Tasks and ratings begin at their public mutation RPCs. Order/account branch fixtures begin at the private notification plan to isolate recipient selection; existing domain/warehouse tests cover the corresponding command-to-outbox paths. This does not falsely claim every legacy route was invoked through a rebuilt UI.
- Rails source: `14277820c78e018e62be3da1a14cd8d716cdbf02`; approved Flutter develop: `5d55d9461af18b94a867dce07dee7c4b76f1e51f`. Pinned contents were read with `git show`, not inferred from the current working tree.

## Source behavior and intentional boundaries

| Source finding | Tested interpretation |
|---|---|
| `OrderNotificationStrategy` recipients use current customer, current SC, `customer_dealer_id`, assigned FM/cutter/worker, all Admins/PCs, and Inspectors linked to the assigned manager. | Exact synthetic identities cover every helper; unrelated factory Inspector 208 and absent-manager Inspectors are excluded. Dealer self-purchase does not invent a dealer fallback absent from the source helper. |
| Type 92 calls the undefined Ruby helper `add_dealers_customer_recipients`. | Existing explicit correction resolves the order customer with current authorization. The fixture marks this correction rather than claiming the Ruby helper worked. |
| Types 20/21, 24, 98 and 115 have no original static/dynamic producer in the reviewed code. | Private route support for 20/21/24/98 is tested and labeled dormant. Type 115 has source-contract evidence only; no fabricated event/endpoint is added. |
| Legacy custom-price change nominates PCs even for dealer-linked fulfillment. | Candidate nomination remains visible, while current PC order scope correctly suppresses delivery with durable `42501` failure. This fixture distinguishes candidate parity from permission to open the resource. |
| Legacy templates for completion types 22/23 mention rating/milestone actions, but the actual Flutter `Order Processing` handler opens the order. | Authorized order targets follow actual navigation, not template wording. |
| Flutter cutter/inspector navigation expects `item_Id`, but the corresponding Ruby strategies add only order payload. | No historical item ID is invented. Current authorized order target is explicit; future UI composition may choose the appropriate authorized work view. |
| Source `BaseStrategy.flow_for_type` classifies some price strategies as cancellation. | Event topic and source producer govern the new route. Misleading legacy flow labels are not copied as permissions or business events. |
| Task add/remove controllers notify the affected assignee plus Admins; changes notify current assignees, creator and Admins excluding the actor. | Literal task recipient sets cover create, simultaneous add/remove/content change, assignee transition and Admin edit. Removed notifications have no resource target; duplicate Admin notifications collapse per event/topic. |
| Rating create targets the rated person and Admins with `rating_id`; update intends the same on score change, but the Ruby controller captures `old_rating` after assignment. | Creation and actual score changes reach the exact recipient/Admin set with a rating target; comment-only edits do not. The existing before-score correction is documented, not mistaken for legacy execution parity. |
| Legacy nominations do not establish current login or resource authority. | Disabled, deleted and unapproved candidates are excluded; preparation checks current resource access. Managed Tailor/SubTailor subjects are not invented login recipients. |

Additional source anchors are `app/controllers/api/v1/tasks_controller.rb` (create/update recipient loops), `ratings_controller.rb` (create/update SendFCM payloads), `app/services/notifications/order_notification_strategy.rb`, `user_notification_strategy.rb`, `base_strategy.rb`, and Flutter `lib/services/notifications_config.dart`. Exact file hashes are in the fixture.

## Distinct dispatch fixtures

Synthetic identities: Admins 100/200, SC 101, PCs 102/202, Customer 103, FM 104, Inspector 108, Cutter 109, Dealer 110 and Worker 111. Types are merged per recipient; the JSON preserves the exact per-recipient type list.

| Branch | Strategy types | Expected nominated recipients | Resource target |
|---|---|---|---|
| place_0_103_direct | 3, 4 | 100, 101, 103, 200 | order:1001 |
| place_0_103_dealer | 3, 106 | 103, 110 | order:1001 |
| place_0_110_direct | 5, 6 | 100, 101, 110, 200 | order:1001 |
| place_0_110_dealer | 5, 6 | 100, 101, 103, 200 | order:1001 |
| place_0_101_direct | 9, 10 | 100, 103, 200 | order:1001 |
| place_0_101_dealer | 11, 12 | 100, 110, 200 | order:1001 |
| place_1_103_direct | 14, 15, 107, 108 | 100, 101, 102, 103, 200, 202 | order:1001 |
| place_1_103_dealer | 116, 117 | 103, 110 | order:1001 |
| place_1_110_direct | 7, 8 | 101 | order:1001 |
| place_1_110_dealer | 113, 114 | 103, 110 | order:1001 |
| place_1_101_direct | 109, 110, 111, 112 | 100, 101, 102, 103, 200, 202 | order:1001 |
| place_1_101_dealer | 11, 12 | 100, 110, 200 | order:1001 |
| edit_rmp_customer | 78, 79, 80 | 100, 101, 103, 200 | order:1001 |
| edit_rmp_dealer | 81, 82, 83 | 100, 101, 200 | order:1001 |
| edit_rmp_dealer_customer | 84, 85 | 103, 110 | order:1001 |
| edit_rmp_sc_customer | 86, 87 | 100, 103, 200 | order:1001 |
| edit_rmp_sc_dealer | 88 | 110 | order:1001 |
| edit_custom_customer | 89, 90, 91 | 101, 102, 103, 202 | order:1001 |
| edit_custom_dealer | 89, 90, 91 | 101, 102, 110, 202 | order:1001 |
| edit_custom_dealer_customer | 92, 93 | 103, 110 | order:1001 |
| edit_custom_sc_customer | 94, 95, 96 | 101, 102, 103, 202 | order:1001 |
| registration | 1 | 100, 200 | person:103 |
| coordinator_assigned | 2 | 101 | person:103 |
| due | 26, 27, 28 | 101, 102, 103, 202 | order:1001 |
| factory | 29, 30, 31, 32 | 101, 102, 103, 104, 202 | order:1001 |
| cutter | 33, 34, 35, 36 | 101, 102, 104, 109, 202 | order:1001 |
| cut_partial | 37, 38, 39, 40 | 101, 102, 104, 109, 202 | order:1001 |
| sew_assigned | 45, 46, 47, 48 | 101, 102, 104, 108, 202 | order:1001 |
| inspect_partial | 49, 50, 51, 52 | 101, 102, 104, 108, 202 | order:1001 |
| dispatch | 58, 59, 60 | 101, 102, 104, 202 | order:1001 |
| cut_complete | 41, 42, 43, 44 | 101, 102, 104, 109, 202 | order:1001 |
| inspect_complete | 53, 54, 55, 56, 57 | 101, 102, 103, 104, 108, 202 | order:1001 |
| worker_assigned | 61, 62, 63, 64 | 101, 102, 103, 111, 202 | order:1001 |
| worker_cost | 65, 66 | 102, 111, 202 | order:1001 |
| worker_stage_0 | 67, 68 | 101, 102, 202 | order:1001 |
| worker_stage_1 | 69, 70 | 101, 102, 202 | order:1001 |
| worker_stage_3 | 71, 72, 73 | 101, 102, 103, 202 | order:1001 |
| custom_price | 74, 75, 76, 77 | 100, 101, 102, 103, 110, 200, 202 (PC delivery suppressed by current scope) | order:1001 |
| rmp_price_private_98 | 97, 98, 99 | 100, 103, 110, 200 | order:1001 |
| provider_processing | 16, 17 | 101, 103 | order:1001 |
| provider_cancel | 18, 19 | 101, 103 | order:1001 |
| custom_cancel | 100, 101, 102, 103 | 100, 101, 102, 103, 200, 202 | order:1001 |
| dealer_cancel | 104, 105 | 103, 110 | order:1001 |
| complete | 22, 23 | 101, 103 | order:1001 |
| pickup_private | 20, 21 | 101, 110 | order:1001 |
| dealer_ready_private | 24 | 103 | order:1001 |

## Remaining acceptance boundaries

Actual FCM receipt and foreground/background navigation on a phone belong to the later mobile UI milestone. These tests prove recipient selection, durable delivery state, current authorization and public target projection, not phone delivery.

The 115 strategy classes are push/inbox routes. Email recipient contracts remain separately mapped in [business mail implementation](BUSINESS_MAIL_IMPLEMENTATION.md) and [business mail tests](../../tools/squad/test_business_mail.py): dealer-created orders, configured Admin price alerts, customer-addressed challans, owner-addressed catalogues, scoped weekly recipients, successful-account welcome messages and bulk-price outcomes. Those tests also cover reassignment, removed recipients, provider-confirmed amendments and frozen message retry. This review reuses that independent evidence instead of adding another 115 mail tests for push-only strategies. Actual SMTP acceptance/inbox receipt is not inferred from notification coverage.

Historical timestamp meaning, source stock inconsistencies, missing source media and a fresh environment-specific migration are data/ownership acceptance questions, not missing notification services. No cutover evidence or approval is generated by this document.
