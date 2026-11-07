# Squad One — functionality and persona matrix

Generated from the curated source audit. **Planned access is not deployed authorization or proven runtime parity.** Conditional roles count toward reuse only when their feature grant is enabled. `P` (Printing Tracker admin), guest and service workers are separate actors and are excluded from persona counts. Tailor/SubTailor are managed subjects, not missing implementation rows.

Source: approved Flutter develop `5d55d946`; Rails main `14277820` plus reviewed WMS branch `058ffb16`. The role-rule CSV records literal legacy UI lists; the following matrix is the proposed server-enforced policy.

**28 shared modules · 115 workflow rows · 68 workflows reused by two or more personas.**

## Personas

| Role | Stored ID | Dashboard | Workflows* | Shared* | Modules |
|---|---:|---|---:|---:|---|
| Admin | 0 | Yes | 67 | 50 | AUTH;PEOPLE;LINK;CAT;CONFIG;PRICE;ORDER;SEW;DISPATCH;JOB;STOCK;TASK;GOAL;TARGET;RATE;METRIC;DOC;PROMO;MEDIA;NOTIFY;MASTER;INTEGRATE;APP;OPS |
| Sales Coordinator | 1 | Yes | 53 | 50 | AUTH;PEOPLE;LINK;CAT;CONFIG;PRICE;ORDER;DISPATCH;STOCK;TASK;GOAL;TARGET;RATE;METRIC;DOC;PROMO;MEDIA;NOTIFY;APP |
| Production Coordinator | 2 | Yes | 42 | 39 | AUTH;PEOPLE;CAT;ORDER;PLAN;CUT;SEW;DISPATCH;JOB;TASK;GOAL;RATE;METRIC;DOC;PROMO;MEDIA;NOTIFY;APP |
| Customer | 3 | Yes | 35 | 34 | AUTH;PEOPLE;LINK;CAT;CONFIG;PRICE;ORDER;STOCK;RATE;METRIC;DOC;PROMO;MEDIA;NOTIFY;APP |
| Factory Manager | 4 | Yes | 34 | 32 | AUTH;PEOPLE;ORDER;PLAN;CUT;SEW;DISPATCH;TASK;RATE;METRIC;DOC;MEDIA;NOTIFY;APP |
| Tailor | 5 | Managed subject | 0 | 0 | PEOPLE;SEW;METRIC;DOC |
| SubTailor | 6 | Managed subject | 0 | 0 | PEOPLE;SEW;METRIC;DOC |
| Dispatch Incharge | 7 | Yes | 18 | 18 | AUTH;PEOPLE;SEW;DISPATCH;METRIC;DOC;MEDIA;NOTIFY;APP |
| Inspector | 8 | Yes | 14 | 13 | AUTH;PEOPLE;SEW;METRIC;MEDIA;NOTIFY;APP |
| Cutting Master | 9 | Yes | 13 | 12 | AUTH;CUT;METRIC;MEDIA;NOTIFY;APP |
| Dealer | 10 | Yes | 44 | 42 | AUTH;PEOPLE;LINK;CAT;CONFIG;PRICE;ORDER;DISPATCH;STOCK;BACK;RATE;METRIC;DOC;PROMO;MEDIA;NOTIFY;APP |
| Job Worker | 11 | Yes | 35 | 35 | AUTH;PEOPLE;CAT;CONFIG;PRICE;ORDER;JOB;TASK;GOAL;RATE;METRIC;DOC;PROMO;MEDIA;NOTIFY;APP |
| Assistant Worker / Team | 12 | Yes | 28 | 28 | AUTH;CAT;CONFIG;PRICE;TASK;GOAL;DOC;PROMO;MEDIA;NOTIFY;APP |

*Includes conditional grants and explicitly proposed improvements. Counts are not a claim that every row is an existing visible screen.

## Shared master functions

| ID | Master functionality | Workflows | Persona reuse count | Personas (including conditional) |
|---|---|---:|---:|---|
| AUTH | Identity, sessions and access | 6 | 11 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team |
| PEOPLE | People and workforce directory | 6 | 9 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Dealer; Job Worker |
| LINK | Customer relationships and onboarding | 6 | 4 | Admin; Sales Coordinator; Customer; Dealer |
| CAT | Product discovery | 4 | 7 | Admin; Sales Coordinator; Production Coordinator; Customer; Dealer; Job Worker; Assistant Worker / Team |
| CONFIG | Custom product configuration | 5 | 6 | Admin; Sales Coordinator; Customer; Dealer; Job Worker; Assistant Worker / Team |
| PRICE | Quotes, margins and price visibility | 4 | 6 | Admin; Sales Coordinator; Customer; Dealer; Job Worker; Assistant Worker / Team |
| ORDER | Order lifecycle | 8 | 7 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dealer; Job Worker |
| PLAN | Factory allocation and criteria | 4 | 2 | Production Coordinator; Factory Manager |
| CUT | Cutting execution | 3 | 3 | Production Coordinator; Factory Manager; Cutting Master |
| SEW | Job sheets, tailoring and inspection | 4 | 5 | Admin; Production Coordinator; Factory Manager; Dispatch Incharge; Inspector |
| DISPATCH | Dispatch and delivery | 4 | 6 | Admin; Sales Coordinator; Production Coordinator; Factory Manager; Dispatch Incharge; Dealer |
| JOB | External job work | 5 | 3 | Admin; Production Coordinator; Job Worker |
| STOCK | Dealer stock and availability | 4 | 4 | Admin; Sales Coordinator; Customer; Dealer |
| BACK | Dealer back orders | 2 | 1 | Dealer |
| TASK | Notes and tasks | 3 | 6 | Admin; Sales Coordinator; Production Coordinator; Factory Manager; Job Worker; Assistant Worker / Team |
| GOAL | Responsibilities, roles and goals | 3 | 5 | Admin; Sales Coordinator; Production Coordinator; Job Worker; Assistant Worker / Team |
| TARGET | Sales milestones | 3 | 2 | Admin; Sales Coordinator |
| RATE | Ratings and feedback | 3 | 7 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dealer; Job Worker |
| METRIC | Dashboards, reports and leaderboards | 5 | 10 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker |
| DOC | Catalogues and operational documents | 5 | 9 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Dealer; Job Worker; Assistant Worker / Team |
| PROMO | Promotional content | 2 | 7 | Admin; Sales Coordinator; Production Coordinator; Customer; Dealer; Job Worker; Assistant Worker / Team |
| MEDIA | Files and media access | 4 | 11 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team |
| NOTIFY | Notifications and devices | 3 | 11 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team |
| MASTER | Master data administration | 3 | 1 | Admin |
| INTEGRATE | Warehouse and data integrations | 6 | 1 | Admin |
| REFRESH | One-way refresh and cutover | 3 | 0 | Platform/service only |
| APP | App bootstrap and shared client behavior | 4 | 11 | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team |
| OPS | Durable work and audit | 3 | 1 | Admin |

## AUTH — Identity, sessions and access

Canonical business tables (within the existing snapshot, with `sa_` prefixes): users reset_password_histories.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| AUTH.01 | Password login, refresh and logout | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | — |
| AUTH.02 | Password recovery and change | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | Guest |
| AUTH.03 | Email confirmation and new customer signup | — | — | 0 | Guest |
| AUTH.04 | My identity, capabilities and profile | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | — |
| AUTH.05 | Disable, enable, delete and invite account | Admin | — | 1 | Printing Tracker admin |
| AUTH.06 | Support login-as replacement | Admin | — | 1 | Printing Tracker admin |

### AUTH.01 — Password login, refresh and logout

- Contract: `Supabase Auth`
- Input: email/password or refresh token
- Result: session; never a password hash
- Rules: Reuse migrated Auth UUID/password hash; reject disabled/deleted or unmapped accounts; role is sa_app, not authenticated.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/auth_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/auth_service.dart#L1)

### AUTH.02 — Password recovery and change

- Contract: `Supabase Auth + POST squad-account/recovery`
- Input: email or verified recovery session/new password
- Result: generic accepted response or new session
- Rules: Replace legacy token/password-email implementation; throttle, one-use recovery, revoke affected sessions; refresh ownership fence protects new passwords.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/auth_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/auth_service.dart#L1)

### AUTH.03 — Email confirmation and new customer signup

- Contract: `POST squad-account/register; POST squad-account/confirm`
- Input: email,password,name,phone,address; confirmation token
- Result: enrollment state and user ID
- Rules: Auth creation and legacy user link use a resumable saga; reserve stable ID, never infer an Admin role from input; confirmation does not imply business approval.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/auth_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/auth_service.dart#L1)

### AUTH.04 — My identity, capabilities and profile

- Contract: `v1_me; v1_profile_save`
- Input: editable profile allowlist; expected_version
- Result: identity, capabilities, allowed modules, profile
- Rules: Resolve live legacy identity and session; strip password/reset/device secrets. Self-profile for A/AW is an explicit consistency improvement over drawer visibility.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/auth_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/auth_service.dart#L1)

### AUTH.05 — Disable, enable, delete and invite account

- Contract: `POST squad-account/users/status; POST squad-account/users/invite`
- Input: target ID, action, reason, version
- Result: account and enrollment status
- Rules: Separate Canto Admin from Printing Tracker admin guard; no self-promotion; soft delete linked business records; revoke sessions and enforce live denial.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/auth_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/auth_service.dart#L1)

### AUTH.06 — Support login-as replacement

- Contract: `POST squad-account/support-session`
- Input: target ID, purpose, expiry
- Result: audited scoped support context
- Rules: Legacy universal-password login-as is retired. Do not implement impersonation until explicit support policy; default to read-only support views.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/auth_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/auth_service.dart#L1)

## PEOPLE — People and workforce directory

Canonical business tables (within the existing snapshot, with `sa_` prefixes): users factories addresses.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| PEOPLE.01 | Search, list and view people | Admin; Sales Coordinator; Production Coordinator; Factory Manager; Dispatch Incharge; Inspector; Dealer | — | 7 | — |
| PEOPLE.02 | Create and edit business personas | Admin; Sales Coordinator; Production Coordinator; Dealer | — | 4 | — |
| PEOPLE.03 | Factory, manager and operational staff setup | Admin; Production Coordinator; Factory Manager | — | 3 | — |
| PEOPLE.04 | Tailor and sub-tailor management | Admin; Production Coordinator; Factory Manager | — | 3 | — |
| PEOPLE.05 | Safe workforce/person removal | Admin; Sales Coordinator; Production Coordinator; Factory Manager | — | 4 | — |
| PEOPLE.06 | Addresses and primary-address selection | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dealer; Job Worker | — | 7 | — |

### PEOPLE.01 — Search, list and view people

- Contract: `v1_people_list; v1_person_get`
- Input: role,search,filters,cursor; ID
- Result: scoped people/detail projection
- Rules: Admin organization scope; SC assigned customers/dealers; dealer linked customers; PC operational contacts; factory staff restricted to their factory/team.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tailors_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/admin_personas/admin_personas_viewmodel.dart#L1)

### PEOPLE.02 — Create and edit business personas

- Contract: `v1_person_save`
- Input: target role, allowlisted profile fields,version
- Result: person ID/version; enrollment job if login enabled
- Rules: Admin owns staff role/capability changes; SC may manage assigned customers/dealers; D may create/edit own linked customers (legacy auto-approved/onboarded); PC factory setup only within granted operational scope. No arbitrary-column CRUD.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tailors_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/admin_personas/admin_personas_viewmodel.dart#L1)

### PEOPLE.03 — Factory, manager and operational staff setup

- Contract: `v1_factory_save; v1_factory_team_save`
- Input: factory/address; CM/IN/DI assignment
- Result: factory/team version
- Rules: PC administers factory allocation; FM manages own team; reject cross-factory foreign keys. Factory detail and selectors share this directory.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tailors_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/admin_personas/admin_personas_viewmodel.dart#L1)

### PEOPLE.04 — Tailor and sub-tailor management

- Contract: `v1_tailor_save; v1_subtailor_save`
- Input: factory,parent tailor,team details,version
- Result: workforce record
- Rules: T and ST are managed subjects, not established mobile login personas. Preserve team counts and work history; do not generate synthetic login credentials.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tailors_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/admin_personas/admin_personas_viewmodel.dart#L1)

### PEOPLE.05 — Safe workforce/person removal

- Contract: `v1_person_archive`
- Input: target ID,reason,version
- Result: archived person/dependency summary
- Rules: Own-scope deletion only; retain order, payment and work history; reject removal that strands active assignments.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tailors_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/admin_personas/admin_personas_viewmodel.dart#L1)

### PEOPLE.06 — Addresses and primary-address selection

- Contract: `v1_address_save; v1_address_archive`
- Input: owner ID,address,primary flag,version
- Result: address list and derived zone/price type
- Rules: Owner or delegated scoped manager; one primary address; address changes trigger relationship/price re-evaluation, not silent historical repricing.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tailors_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/admin_personas/admin_personas_viewmodel.dart#L1)

## LINK — Customer relationships and onboarding

Canonical business tables (within the existing snapshot, with `sa_` prefixes): users addresses user_dealers customer_requests assigned_brands zones cities.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| LINK.01 | Review and approve customer registration | Admin; Sales Coordinator | — | 2 | — |
| LINK.02 | Assign coordinator or dealer; direct-deal conversion | Admin; Sales Coordinator | — | 2 | — |
| LINK.03 | Dealer automatic approval and zone routing | Admin; Dealer | — | 2 | — |
| LINK.04 | Request a coordinator change | Customer | — | 1 | — |
| LINK.05 | Review coordinator requests and bulk reassignment | Admin | — | 1 | — |
| LINK.06 | Authorized brands and customer price/stock rules | Admin; Sales Coordinator; Dealer | — | 3 | — |

### LINK.01 — Review and approve customer registration

- Contract: `v1_customer_review`
- Input: customer ID,approve/reject,onboarding fields,version
- Result: approval and linked contacts
- Rules: Manual verification is A/SC only in backend; dealer-created customers follow the separate automatic creation path. Preserve independent registered/verified/approved/onboarded states.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/auto_approval_user_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customer_requests_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/customer_service.dart#L1)

### LINK.02 — Assign coordinator or dealer; direct-deal conversion

- Contract: `v1_customer_links_save`
- Input: customer,coordinator,dealer IDs,mode,version
- Result: updated relationship graph
- Rules: Validate relationship consistency; SC cannot move another SC customer; intentional direct-deal switch updates derived pricing/stock scope.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/auto_approval_user_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customer_requests_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/customer_service.dart#L1)

### LINK.03 — Dealer automatic approval and zone routing

- Contract: `v1_dealer_rules_save`
- Input: dealer,auto_approve,zone/stock flags,version
- Result: rules and preview of effect
- Rules: Dealer edits own allowed rules; zone/primary-city links decide candidate dealers; no random-password emails.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/auto_approval_user_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customer_requests_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/customer_service.dart#L1)

### LINK.04 — Request a coordinator change

- Contract: `v1_coordinator_change_request`
- Input: requested SC,reason
- Result: pending request
- Rules: Direct customers only; one active request per customer; do not change existing assignments before approval.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/auto_approval_user_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customer_requests_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/customer_service.dart#L1)

### LINK.05 — Review coordinator requests and bulk reassignment

- Contract: `v1_coordinator_requests; v1_coordinator_change_decide; v1_customers_reassign`
- Input: request decision or selected IDs/from-to coordinator/version
- Result: affected counts and audit
- Rules: Update the authoritative customer_sc_id relation and intended pending-order ownership atomically; legacy created_by-only rewrite is insufficient; preserve completed history.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/auto_approval_user_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customer_requests_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/customer_service.dart#L1)

### LINK.06 — Authorized brands and customer price/stock rules

- Contract: `v1_customer_commercial_rules_save`
- Input: dealer brands; customer stock percentage/price class
- Result: rules version
- Rules: Admin/SC manage delegated customer terms; dealer sees own brand grants, cannot self-grant brands. Percentage controls display, never real reservation quantity.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/auto_approval_user_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customer_requests_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/customer_service.dart#L1)

## CAT — Product discovery

Canonical business tables (within the existing snapshot, with `sa_` prefixes): base_products base_product_types rmp_categories rmp_brands rmp_classes rmp_skus rmp_prices rmp_price_types rmp_min_infos.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| CAT.01 | Browse custom base types, categories and products | Admin; Sales Coordinator; Production Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 7 | — |
| CAT.02 | Browse and search ready-made products | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| CAT.03 | SKU sizes, colors and warehouse availability | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| CAT.04 | Price type and catalogue selectors | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |

### CAT.01 — Browse custom base types, categories and products

- Contract: `v1_catalog_tree; v1_base_product_get`
- Input: base type/category/search,cursor
- Result: hierarchy and product detail
- Rules: Shared product screen; only active/nondeleted allowed masters; selectors use canonical master IDs.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ready_made_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/readymade_product_service.dart#L1)

### CAT.02 — Browse and search ready-made products

- Contract: `v1_rmp_search; v1_rmp_detail`
- Input: category,brand,class,term,cursor
- Result: classes,SKU variants and visible prices
- Rules: Apply authorized brands, zone and price type before pagination; no per-role duplicate endpoint.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ready_made_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/readymade_product_service.dart#L1)

### CAT.03 — SKU sizes, colors and warehouse availability

- Contract: `v1_rmp_variants`
- Input: class/brand/category,size/color,facility
- Result: variants; availability timestamp/source
- Rules: One-day/three-day facilities retained; distinguish true stock, display percentage and reservation availability; stale provider status explicit.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ready_made_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/readymade_product_service.dart#L1)

### CAT.04 — Price type and catalogue selectors

- Contract: `v1_catalog_options`
- Input: customer context,product family
- Result: permitted options and price type
- Rules: Resolve price type server-side from user/zone/address/direct-deal rules. Do not accept arbitrary commercial identity.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ready_made_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/readymade_product_service.dart#L1)

## CONFIG — Custom product configuration

Canonical business tables (within the existing snapshot, with `sa_` prefixes): products product_parts product_part_add_ons brandings product_images parts add_ons fabrics colors sizes.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| CONFIG.01 | Select fabric, color, parts and add-ons | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| CONFIG.02 | Create or reuse a custom preset | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| CONFIG.03 | Branding, print/embroidery and design preview | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| CONFIG.04 | Find previous custom products and rename preset | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| CONFIG.05 | Sample quantities, bulk sizes and extra quantities | Sales Coordinator; Customer; Dealer | — | 3 | — |

### CONFIG.01 — Select fabric, color, parts and add-ons

- Contract: `v1_configurator_options`
- Input: base product,selected IDs
- Result: valid compatibility options
- Rules: Validate joins, sizes and material units; client cannot pair unrelated add-ons/colors.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_custom_product_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/product_service.dart#L1)

### CONFIG.02 — Create or reuse a custom preset

- Contract: `v1_product_configure`
- Input: canonical options,reference media,branding flag
- Result: product ID/style number/fingerprint
- Rules: Canonical fingerprint excludes branding/media in legacy source; retain base preset matching and bind per-order artwork separately; concurrency-safe deduplication.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_custom_product_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/product_service.dart#L1)

### CONFIG.03 — Branding, print/embroidery and design preview

- Contract: `v1_branding_save; client preview`
- Input: side,type,width,height,units,design attachment IDs
- Result: validated branding specification
- Rules: Preserve SVG/product preview client-side; server validates dimensions and pricing inputs; media ownership cannot follow arbitrary URLs.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_custom_product_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/product_service.dart#L1)

### CONFIG.04 — Find previous custom products and rename preset

- Contract: `v1_presets_list; v1_preset_rename`
- Input: filters; preset ID/name/version
- Result: presets or renamed preset
- Rules: Shared search; rename restricted to SC in Flutter develop. Product creation does not itself grant order placement.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_custom_product_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/product_service.dart#L1)

### CONFIG.05 — Sample quantities, bulk sizes and extra quantities

- Contract: `v1_item_quantity_validate`
- Input: sample/bulk,size quantities,extra quantities
- Result: normalized item quantities
- Rules: Share validation between quote and order; positive bounded integers; sample-to-bulk expansion retains history.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_custom_product_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/product_service.dart#L1)

## PRICE — Quotes, margins and price visibility

Canonical business tables (within the existing snapshot, with `sa_` prefixes): profit_margins rmp_prices rmp_sku_prices items orders.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| PRICE.01 | Authoritative custom quote and cost breakdown | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| PRICE.02 | Ready-made quote, tax and mixed-order totals | Sales Coordinator; Customer; Dealer | — | 3 | — |
| PRICE.03 | Controlled item price override | Sales Coordinator | — | 1 | — |
| PRICE.04 | Catalogue margin and markup calculation | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |

### PRICE.01 — Authoritative custom quote and cost breakdown

- Contract: `v1_quote`
- Input: customer,configuration,quantity,branding
- Result: quote ID,revision,expires_at,decimal line totals
- Rules: Port Flutter formula once to SQL/domain implementation; cost breakdown capability differs from selling price visibility; redact fabric/cost fields by actor.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/check_item_prices_service.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/profit_service.dart#L1)

### PRICE.02 — Ready-made quote, tax and mixed-order totals

- Contract: `v1_quote`
- Input: customer,SKU/size quantities,address
- Result: quote with tax/discount/total
- Rules: Reuse same quote engine for RMP/custom/mixed; version tax schedule and legacy thresholds; finance validates values before release; no claim of legal tax compliance.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/check_item_prices_service.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/profit_service.dart#L1)

### PRICE.03 — Controlled item price override

- Contract: `v1_quote_override`
- Input: quote/item,override,reason,expected_version
- Result: new quote revision and audit
- Rules: Only SC per develop UI; recompute totals and downstream notices; do not trust client total or arbitrary payment amount.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/check_item_prices_service.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/profit_service.dart#L1)

### PRICE.04 — Catalogue margin and markup calculation

- Contract: `v1_catalogue_quote`
- Input: selected products,percentage/fixed markup
- Result: document price projection
- Rules: Same price engine; markup is document presentation and does not change canonical sale prices.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/check_item_prices_service.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/profit_service.dart#L1)

## ORDER — Order lifecycle

Canonical business tables (within the existing snapshot, with `sa_` prefixes): orders items quantities extra_quantities back_order_links.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| ORDER.01 | Scoped order list, filters, search and detail | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dealer; Job Worker | — | 7 | — |
| ORDER.02 | Place custom, ready-made or mixed order | Sales Coordinator; Customer; Dealer | — | 3 | — |
| ORDER.03 | Edit existing order and quantities | Sales Coordinator | — | 1 | — |
| ORDER.04 | Cancel or soft-delete order | Sales Coordinator; Dealer | — | 2 | — |
| ORDER.05 | Force-complete an order | Admin | — | 1 | — |
| ORDER.06 | Prime flag and due-date changes | Admin; Sales Coordinator; Production Coordinator | — | 3 | — |
| ORDER.07 | Manual payment status and amount | Sales Coordinator | — | 1 | — |
| ORDER.08 | Derive order completion and histories | — | — | 0 | Trusted worker |

### ORDER.01 — Scoped order list, filters, search and detail

- Contract: `v1_orders_list; v1_order_get`
- Input: type,status,search,date filters,cursor; ID
- Result: scoped projection with items and progress
- Rules: SC customer_sc_id; PC custom operational scope; FM assigned factory; C/D own or linked dealer view; JW assigned work. Hide factory from C/D and sensitive price/cost fields from unauthorized actors.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.02 — Place custom, ready-made or mixed order

- Contract: `v1_order_place`
- Input: quote ID/revision,delivery address,due date,comments,idempotency_key
- Result: all created order IDs,totals,status,events
- Rules: Atomic order/items/quantities/brand splitting; pure RMP linked-customer orders split by dealer-authorized brand; preserve mixed/custom routing. Return all children, not legacy last child only.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.03 — Edit existing order and quantities

- Contract: `v1_order_edit`
- Input: order ID,quote revision,changes,expected_version,idempotency_key
- Result: updated order and recalculation summary
- Rules: Develop narrows edit/cancel to SC; block changes incompatible with completed production/reservations; explicit external reconciliation instead of swallowed failures.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.04 — Cancel or soft-delete order

- Contract: `v1_order_cancel`
- Input: order ID,kind,reason,version,idempotency_key
- Result: cancellation state and provider job
- Rules: SC scoped cancellation; D own linked customer order cancellation per dealer workflow. Distinguish cancel from delete; release reservations once; completed external orders cannot be silently deleted.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.05 — Force-complete an order

- Contract: `v1_order_force_complete`
- Input: order ID,reason,version
- Result: completion exception and audit
- Rules: Admin search-order flow calls this action; preserve dedicated force-complete behavior, never grant to all users merely because old endpoint lacks checks.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.06 — Prime flag and due-date changes

- Contract: `v1_order_priority_save; v1_order_due_save`
- Input: order ID,prime/due date,reason,version
- Result: new priority/due date
- Rules: Prime applies to A/SC/PC. Field permissions and allowed status independent; date comparisons use defined business timezone.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.07 — Manual payment status and amount

- Contract: `v1_order_payment_record`
- Input: order ID,paid/unpaid/partial,amount,reference,version
- Result: payment projection
- Rules: Legacy manual status only; QR/payment instructions remain presentation. No payment gateway is evidenced. Prevent negative/excess values according to documented business rule.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### ORDER.08 — Derive order completion and histories

- Contract: `internal recompute_order_progress`
- Input: changed order/item IDs
- Result: status dimensions and completion event
- Rules: Mixed requires dispatch complete AND provider COMPLETE; custom/dealer-linked uses dispatch; pure RMP provider complete; force override separate. Delivered-at set once; cancellation not misreported as fulfillment.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/orders_controller.rb#L1), [source 4](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

## PLAN — Factory allocation and criteria

Canonical business tables (within the existing snapshot, with `sa_` prefixes): orders items item_criteria criteria users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| PLAN.01 | Assign factory or change production allocation | Production Coordinator | — | 1 | — |
| PLAN.02 | Set criteria and readiness checklist | Production Coordinator; Factory Manager | — | 2 | — |
| PLAN.03 | Assign cutting master | Factory Manager | — | 1 | — |
| PLAN.04 | Operational factory queues and selectors | Production Coordinator; Factory Manager | — | 2 | — |

### PLAN.01 — Assign factory or change production allocation

- Contract: `v1_order_assign_factory`
- Input: order,factory,version
- Result: assignment and affected work
- Rules: One authority; reassign only after checking active cutting/sewing/dispatch. Emit events after commit.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/factory_managers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/factory_service.dart#L1)

### PLAN.02 — Set criteria and readiness checklist

- Contract: `v1_item_criteria_save`
- Input: item,criteria IDs/status,version
- Result: item/order criteria progress
- Rules: Use master criteria and assignment scope; complete only when required criteria satisfied; preserve pending-criteria views.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/factory_managers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/factory_service.dart#L1)

### PLAN.03 — Assign cutting master

- Contract: `v1_item_assign_cutter`
- Input: item,cutting master,version
- Result: assignment
- Rules: Same-factory validation; existing assignment guard; reassignment is an explicit audited operation.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/factory_managers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/factory_service.dart#L1)

### PLAN.04 — Operational factory queues and selectors

- Contract: `v1_factory_queue`
- Input: factory,phase,filters,cursor
- Result: scoped pending/completed items
- Rules: Reuse order/item read projections; no duplicate store for factory lists.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/factory_managers_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/factory_service.dart#L1)

## CUT — Cutting execution

Canonical business tables (within the existing snapshot, with `sa_` prefixes): mark_cuttings mark_cutting_quantities quantities items orders.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| CUT.01 | Read cutting job queue and item detail | Cutting Master; Factory Manager | — | 2 | — |
| CUT.02 | Record partial cutting by size/date | Cutting Master | — | 1 | — |
| CUT.03 | Cutting progress rollups | Factory Manager; Production Coordinator; Cutting Master | — | 3 | — |

### CUT.01 — Read cutting job queue and item detail

- Contract: `v1_cutting_queue; v1_cutting_detail`
- Input: filters,cursor; item ID
- Result: sizes,assignment,history,remaining
- Rules: CM only own assigned items; FM own factory oversight; do not leak selling prices.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/cutting_masters_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_cutting_status_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/cutting_master_service.dart#L1)

### CUT.02 — Record partial cutting by size/date

- Contract: `v1_cutting_record`
- Input: item,size quantities,date,idempotency_key,version
- Result: record and recalculated progress
- Rules: Lock item/quantity rows; reject negative and over-cut values; preserve sample-specific progress semantics.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/cutting_masters_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_cutting_status_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/cutting_master_service.dart#L1)

### CUT.03 — Cutting progress rollups

- Contract: `v1_production_progress`
- Input: order or item ID
- Result: cut/remaining totals and timestamps
- Rules: One calculation feeds dashboards, item details and notifications; historical rows never overwritten by status-only edits.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/cutting_masters_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_order_cutting_status_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/cutting_master_service.dart#L1)

## SEW — Job sheets, tailoring and inspection

Canonical business tables (within the existing snapshot, with `sa_` prefixes): item_tailors item_tailor_quantities job_sheet_assign_dates job_sheet_assign_quantities job_sheet_assign_tailors job_sheet_mark_tailors job_sheet_tailor_mark_dates mark_tailor_quantities.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| SEW.01 | Assign job sheet to tailor/team by size | Factory Manager | — | 1 | — |
| SEW.02 | Read job sheets and tailor work history | Factory Manager; Inspector; Dispatch Incharge; Production Coordinator | — | 4 | — |
| SEW.03 | Record inspected/completed and picked quantities | Inspector | — | 1 | — |
| SEW.04 | Tailor earnings and weekly work report | Admin; Production Coordinator; Factory Manager | — | 3 | — |

### SEW.01 — Assign job sheet to tailor/team by size

- Contract: `v1_jobsheet_assign`
- Input: item,tailor/subtailor,size quantities,date,version,idempotency_key
- Result: assignment and remaining capacity
- Rules: T/ST are subjects; allocation bounded by cut/available quantity; cross-factory assignment forbidden; lock allocation rows.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/inspectors_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/mark_tailor_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/inspector_service.dart#L1)

### SEW.02 — Read job sheets and tailor work history

- Contract: `v1_jobsheets_list; v1_tailor_work`
- Input: factory/tailor/item/date,cursor
- Result: assignments,completed/picked/dispatched totals
- Rules: Inspector and DI only factory scope; PC oversight projection; same job-sheet model for detail screens.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/inspectors_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/mark_tailor_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/inspector_service.dart#L1)

### SEW.03 — Record inspected/completed and picked quantities

- Contract: `v1_jobsheet_inspect`
- Input: assignment,tailor,size quantities,date,version,idempotency_key
- Result: history and updated balances
- Rules: Completion/pick counts validated independently against assigned/remaining; derive order stitching state; reject repeated retries as new work.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/inspectors_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/mark_tailor_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/inspector_service.dart#L1)

### SEW.04 — Tailor earnings and weekly work report

- Contract: `v1_tailor_earnings`
- Input: tailor,week
- Result: quantity/rate breakdown and total
- Rules: Legacy Saturday-Friday window and OF/SN/add-on rates captured as versioned formula; T/ST subjects; validate historical rate treatment before payroll use.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/inspectors_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/mark_tailor_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/inspector_service.dart#L1)

## DISPATCH — Dispatch and delivery

Canonical business tables (within the existing snapshot, with `sa_` prefixes): dispatched_quantities job_sheet_dispatched_dates orders items quantities.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| DISPATCH.01 | Read dispatch queue and delivery details | Dispatch Incharge; Factory Manager; Dealer | — | 3 | — |
| DISPATCH.02 | Record partial dispatch by size/date | Dispatch Incharge; Dealer | — | 2 | — |
| DISPATCH.03 | Choose dispatch destination | Admin; Sales Coordinator; Production Coordinator; Dispatch Incharge | — | 4 | — |
| DISPATCH.04 | Delivery history and totals | Factory Manager; Dispatch Incharge; Dealer | — | 3 | — |

### DISPATCH.01 — Read dispatch queue and delivery details

- Contract: `v1_dispatch_queue; v1_dispatch_detail`
- Input: factory/customer/date/status,cursor
- Result: eligible dispatch items and histories
- Rules: DI/FM own factory; dealer own customer fulfillment; reuse order/read model with dispatch projection.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/dispatch_incharges_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_dispatched_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/dispatch_service.dart#L1)

### DISPATCH.02 — Record partial dispatch by size/date

- Contract: `v1_dispatch_record`
- Input: order,item,size quantities,date,version,idempotency_key
- Result: dispatch ID,remaining,stock effects
- Rules: Single transaction for dispatch and local dealer-stock consumption; no overdispatch, negative stock or cross-dealer writes; external fulfillment queued.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/dispatch_incharges_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_dispatched_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/dispatch_service.dart#L1)

### DISPATCH.03 — Choose dispatch destination

- Contract: `v1_dispatch_destination_save`
- Input: order,customer/HO/Makali,destination ID,version
- Result: destination
- Rules: Preserve three destination modes; destination ID validated within chosen mode; do not replace customer ownership.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/dispatch_incharges_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_dispatched_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/dispatch_service.dart#L1)

### DISPATCH.04 — Delivery history and totals

- Contract: `v1_deliveries_list`
- Input: date range,order/customer,cursor
- Result: delivery groups and quantities
- Rules: Shared projection powers delivery tabs and challans; canceled/voided operations distinguished from completed deliveries.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/dispatch_incharges_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_dispatched_quantity_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/dispatch_service.dart#L1)

## JOB — External job work

Canonical business tables (within the existing snapshot, with `sa_` prefixes): orders items users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| JOB.01 | Manage job worker and Team feature grants | Admin | — | 1 | — |
| JOB.02 | Assign order to job worker | Production Coordinator | — | 1 | — |
| JOB.03 | Set job-worker per-piece and total costs | Production Coordinator | — | 1 | — |
| JOB.04 | Update six-stage worker item status | Job Worker; Production Coordinator | — | 2 | — |
| JOB.05 | Request/update job-worker due date with reason | Job Worker; Production Coordinator | — | 2 | — |

### JOB.01 — Manage job worker and Team feature grants

- Contract: `v1_person_capabilities_save`
- Input: user,capability keys,version
- Result: effective capability set
- Rules: Preserve keys for notes, roles/goals, product tab, PDF, configurator and promotions. No caller-controlled privilege escalation.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/job_worker_stats_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/job_worker_service.dart#L1)

### JOB.02 — Assign order to job worker

- Contract: `v1_order_assign_worker`
- Input: order,worker,due date,version
- Result: assignment
- Rules: Validate eligible active worker and feature-independent order assignment; reassignment checks active work and costs.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/job_worker_stats_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/job_worker_service.dart#L1)

### JOB.03 — Set job-worker per-piece and total costs

- Contract: `v1_worker_cost_save`
- Input: item,unit cost,quantity basis,version
- Result: decimal total
- Rules: Separate worker costs from customer price; derive total server-side; hide from customers/dealers and unentitled workers.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/job_worker_stats_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/job_worker_service.dart#L1)

### JOB.04 — Update six-stage worker item status

- Contract: `v1_worker_stage_save`
- Input: item,stage,version
- Result: stage history and derived order status
- Rules: fabric_ordered/in_cutting/in_branding/in_stitching/ready_for_dispatch/dispatched; JW only own assignment; PC correction with reason; explicit transition policy.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/job_worker_stats_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/job_worker_service.dart#L1)

### JOB.05 — Request/update job-worker due date with reason

- Contract: `v1_worker_due_save`
- Input: order,due date,reason,version
- Result: old/new date,delta days,audit
- Rules: Worker only assigned orders; preserve reason and original due date for efficiency metrics.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/items_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/job_worker_stats_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/job_worker_service.dart#L1)

## STOCK — Dealer stock and availability

Canonical business tables (within the existing snapshot, with `sa_` prefixes): stocks stock_infos stock_useds rmp_skus.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| STOCK.01 | Read dealer stock and customer-visible availability | Dealer; Customer; Sales Coordinator | — | 3 | — |
| STOCK.02 | Receive dealer stock from completed purchase orders | — | — | 0 | Trusted worker |
| STOCK.03 | Allocate dealer stock to customer dispatch | — | — | 0 | Trusted worker |
| STOCK.04 | Reconcile stock and rebuild derived summaries | Admin | — | 1 | Printing Tracker admin; Trusted worker |

### STOCK.01 — Read dealer stock and customer-visible availability

- Contract: `v1_dealer_stock`
- Input: dealer/customer,product,size,cursor
- Result: real/display/available quantities
- Rules: Own dealer or linked customer scope; prevent broad inventory disclosure; visibility percentage never changes physical balances.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_user_stock_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_used_stock_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1)

### STOCK.02 — Receive dealer stock from completed purchase orders

- Contract: `internal dealer_stock_receive`
- Input: source order/event ID
- Result: stock entries
- Rules: Idempotent origin order/item/size keys; preserve RMP vs canonical custom product matching; never duplicate receipts on refresh/retry.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_user_stock_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_used_stock_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1)

### STOCK.03 — Allocate dealer stock to customer dispatch

- Contract: `internal dealer_stock_consume`
- Input: dispatch ID,size/product
- Result: allocations and remaining balance
- Rules: Fix legacy min-allocation arithmetic; row-lock sources; consume min(available,remaining), not remaining-available; unique retry key.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_user_stock_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_used_stock_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1)

### STOCK.04 — Reconcile stock and rebuild derived summaries

- Contract: `v1_stock_reconciliation; internal stock_rebuild`
- Input: dealer/date or source event range
- Result: differences and repair job
- Rules: Rebuild summaries from authoritative receipts/consumption; no second warehouse ledger; repair must be audited and additive/reversible.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_user_stock_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_used_stock_service.rb#L1), [source 3](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/customers_controller.rb#L1)

## BACK — Dealer back orders

Canonical business tables (within the existing snapshot, with `sa_` prefixes): back_order_links orders items stocks.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| BACK.01 | Preview shortage and aggregate customer orders | Dealer | — | 1 | — |
| BACK.02 | Place dealer bulk back order and link originals | Dealer | — | 1 | — |

### BACK.01 — Preview shortage and aggregate customer orders

- Contract: `v1_backorder_preview`
- Input: selected pending linked customer orders
- Result: grouped required/stock/shortage quantities
- Rules: Exclude already linked/completed orders; group product+size+type consistently; preserve custom comparable-value semantics.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_back_orders_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_order_params_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

### BACK.02 — Place dealer bulk back order and link originals

- Contract: `v1_backorder_place`
- Input: preview revision,direct-placement flag,idempotency_key
- Result: created order IDs and original links
- Rules: Atomic link+create; concurrent requests cannot double-order shortages; server recalculates stale stock preview.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/create_back_orders_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_order_params_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/order_service.dart#L1)

## TASK — Notes and tasks

Canonical business tables (within the existing snapshot, with `sa_` prefixes): tasks task_users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| TASK.01 | Read notes/tasks, assignees and order notes | Admin; Sales Coordinator; Production Coordinator; Factory Manager | Job Worker; Assistant Worker / Team | 6 | — |
| TASK.02 | Create/edit task, deadline and assignments | Admin; Sales Coordinator; Production Coordinator; Factory Manager | Job Worker; Assistant Worker / Team | 6 | — |
| TASK.03 | Change task state or archive | Admin; Sales Coordinator; Production Coordinator; Factory Manager | Job Worker; Assistant Worker / Team | 6 | — |

### TASK.01 — Read notes/tasks, assignees and order notes

- Contract: `v1_tasks_list; v1_task_get; v1_task_assignees`
- Input: owner/assigned/order/status/date,cursor
- Result: scoped tasks and allowed assignees
- Rules: Creator/assigned membership; Admin oversight. JW/AW require toDos; no global users endpoint for ordinary actors.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tasks_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/notes_service.dart#L1)

### TASK.02 — Create/edit task, deadline and assignments

- Contract: `v1_task_save`
- Input: text,deadline,order link,assignees,version
- Result: task and membership
- Rules: Creator/manager edits text/assignment; validate order visibility and assignee eligibility; notify new/removed members once.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tasks_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/notes_service.dart#L1)

### TASK.03 — Change task state or archive

- Contract: `v1_task_transition`
- Input: task,status,version,idempotency_key
- Result: state and audit
- Rules: Assignees may update allowed state; deletion creator/manager only; pending/inprogress/complete/deleted map explicitly.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/tasks_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/notes_service.dart#L1)

## GOAL — Responsibilities, roles and goals

Canonical business tables (within the existing snapshot, with `sa_` prefixes): responsibilities users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| GOAL.01 | Read responsibilities, role descriptions and goals | Admin; Sales Coordinator; Production Coordinator | Job Worker; Assistant Worker / Team | 5 | — |
| GOAL.02 | Create/edit/bulk assign responsibility items | Admin | — | 1 | — |
| GOAL.03 | Complete or archive responsibility | Admin; Sales Coordinator; Production Coordinator | Job Worker; Assistant Worker / Team | 5 | — |

### GOAL.01 — Read responsibilities, role descriptions and goals

- Contract: `v1_responsibilities_list`
- Input: subject,kind,status,cursor
- Result: role/goal/task groups
- Rules: Shared typed entity; JW/AW need rolesAndGoals. Preserve role-specific subjects and team ownership.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/responsibilities_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/responsibilities_service.dart#L1)

### GOAL.02 — Create/edit/bulk assign responsibility items

- Contract: `v1_responsibility_save`
- Input: subject IDs,kind,items,version
- Result: responsibility IDs
- Rules: SC/PC/JW/AW are subjects; fix backend role enum omission for AW; no duplicate roles/goals service.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/responsibilities_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/responsibilities_service.dart#L1)

### GOAL.03 — Complete or archive responsibility

- Contract: `v1_responsibility_transition`
- Input: ID,status,version
- Result: updated item
- Rules: Self subject completes allowed items; Admin owns assignment/archive; conditional JW/AW self scope.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/responsibilities_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/responsibilities_service.dart#L1)

## TARGET — Sales milestones

Canonical business tables (within the existing snapshot, with `sa_` prefixes): milestones orders users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| TARGET.01 | Create/edit/delete SC milestone target | Admin | — | 1 | — |
| TARGET.02 | Current/past/year-to-date target progress | Admin; Sales Coordinator | — | 2 | — |
| TARGET.03 | Recalculate milestone progress | — | — | 0 | Trusted worker |

### TARGET.01 — Create/edit/delete SC milestone target

- Contract: `v1_milestone_save; v1_milestone_archive`
- Input: SC,period,target amount,version
- Result: milestone
- Rules: Validate full interval overlap, including one range containing another; preserve history and audit changes.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/milestones_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/milestones/recalculate_milestone_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/milestone_service.dart#L1)

### TARGET.02 — Current/past/year-to-date target progress

- Contract: `v1_milestones_list; v1_milestone_progress`
- Input: SC,period
- Result: target,placed/completed amounts,orders
- Rules: SC self; Admin selected SC; reuse metrics, distinguish placed vs completed and cancellation reversals.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/milestones_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/milestones/recalculate_milestone_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/milestone_service.dart#L1)

### TARGET.03 — Recalculate milestone progress

- Contract: `internal milestone_recompute`
- Input: changed order/SC/date
- Result: updated aggregates
- Rules: Idempotent derive/recompute after order/ownership/status changes; avoid incrementing twice on notification retry.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/milestones_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/milestones/recalculate_milestone_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/milestone_service.dart#L1)

## RATE — Ratings and feedback

Canonical business tables (within the existing snapshot, with `sa_` prefixes): ratings users orders items.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| RATE.01 | Read scoped order/item feedback | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dealer; Job Worker | — | 7 | — |
| RATE.02 | Submit or edit own rating | Sales Coordinator; Customer; Production Coordinator; Factory Manager | — | 4 | — |
| RATE.03 | Moderate/withdraw feedback and recalculate | Admin | — | 1 | — |

### RATE.01 — Read scoped order/item feedback

- Contract: `v1_ratings_list`
- Input: entity kind/ID,cursor
- Result: rating/comment projection
- Rules: Only visible entity and relevant feedback; avoid exposing private staff feedback to customers. Actor list is proposed scoped policy, not proof all have rating UI.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ratings_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_rating_avg_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/rating_service.dart#L1)

### RATE.02 — Submit or edit own rating

- Contract: `v1_rating_save`
- Input: entity,rating,positive/negative comments,version
- Result: rating and average
- Rules: Customer rates SC; SC order rates assigned PC; other role targets constrained by actual work relation. Derive from_id; unique actor/target/entity; target policies need fixture proof.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ratings_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_rating_avg_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/rating_service.dart#L1)

### RATE.03 — Moderate/withdraw feedback and recalculate

- Contract: `v1_rating_archive`
- Input: rating,reason,version
- Result: audit and new aggregate
- Rules: Preserve history; no arbitrary actor spoofing. Legacy role-constant and old-rating capture defects are not compatibility requirements.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/ratings_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/update_rating_avg_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/rating_service.dart#L1)

## METRIC — Dashboards, reports and leaderboards

Canonical business tables (within the existing snapshot, with `sa_` prefixes): orders items users ratings milestones quantities.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| METRIC.01 | Persona home summaries and order graphs | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker | — | 10 | — |
| METRIC.02 | Factory, cutting, inspection and worker efficiency | Admin; Production Coordinator; Factory Manager; Cutting Master; Inspector; Dispatch Incharge; Job Worker | — | 7 | — |
| METRIC.03 | Tailor leaderboard and rankings | Admin; Production Coordinator; Factory Manager; Inspector; Dispatch Incharge | — | 5 | — |
| METRIC.04 | Customer, brand, class and sales reports | Admin | — | 1 | Printing Tracker admin |
| METRIC.05 | SC detail and milestone/customer performance | Admin; Sales Coordinator; Production Coordinator | — | 3 | — |

### METRIC.01 — Persona home summaries and order graphs

- Contract: `v1_dashboard`
- Input: period,allowed scope
- Result: cards,series,totals,as_of
- Rules: One projection engine with persona scope; no separate calculation implementation per dashboard; AW has capability-based landing without invented order KPI.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/user_specific_stats_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/order_stats_graph_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/leaderboard_service.dart#L1)

### METRIC.02 — Factory, cutting, inspection and worker efficiency

- Contract: `v1_work_metrics`
- Input: period,team/self scope
- Result: throughput,remaining,due-date and rating statistics
- Rules: Reuse production history; worker date changes do not erase lateness; no monetary earnings for unauthorized roles.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/user_specific_stats_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/order_stats_graph_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/leaderboard_service.dart#L1)

### METRIC.03 — Tailor leaderboard and rankings

- Contract: `v1_tailor_leaderboard`
- Input: factory,period,cursor
- Result: rank,work totals
- Rules: T/ST are ranked subjects; same formula as weekly work reports; role scope enforced before ranking.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/user_specific_stats_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/order_stats_graph_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/leaderboard_service.dart#L1)

### METRIC.04 — Customer, brand, class and sales reports

- Contract: `v1_sales_report`
- Input: report enum,period,filters,cursor
- Result: aggregate/detail report
- Rules: Port existing dashboard controller reports; controlled report enum, not arbitrary SQL; job-backed large exports.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/user_specific_stats_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/order_stats_graph_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/leaderboard_service.dart#L1)

### METRIC.05 — SC detail and milestone/customer performance

- Contract: `v1_sales_coordinator_metrics`
- Input: SC,period
- Result: assigned customers,order and target metrics
- Rules: SC self; Admin global; PC operational projection only; omit prices where not permitted.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/user_specific_stats_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/order_stats_graph_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/leaderboard_service.dart#L1)

## DOC — Catalogues and operational documents

Canonical business tables (within the existing snapshot, with `sa_` prefixes): catalogues orders users quantities.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| DOC.01 | Request branded catalogue PDF | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| DOC.02 | Catalogue history, progress and secure download | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | — |
| DOC.03 | Generate delivery challan | Dispatch Incharge; Factory Manager; Dealer | — | 3 | — |
| DOC.04 | Generate weekly tailor work/payment report | Admin; Production Coordinator; Factory Manager | — | 3 | Trusted worker |
| DOC.05 | Purge expired generated documents | — | — | 0 | Trusted worker |

### DOC.01 — Request branded catalogue PDF

- Contract: `v1_document_request(kind=catalogue)`
- Input: selection,exclusions,markup,company/address/bank/terms,stock flag,idempotency_key
- Result: job ID
- Rules: Shared quote engine; validate payload limits and media ownership. PDFs execute in durable worker, not heavy Edge CPU.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_catalogue_pdf_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_tailors_payment_pdf.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/catalogue_service.dart#L1)

### DOC.02 — Catalogue history, progress and secure download

- Contract: `v1_documents_list; v1_document_get`
- Input: kind,status,cursor; job ID
- Result: queued/running/ready/failed/expired and media grant
- Rules: Only creator/delegated scope; email-vs-direct delivery choice; expire output with retention rule.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_catalogue_pdf_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_tailors_payment_pdf.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/catalogue_service.dart#L1)

### DOC.03 — Generate delivery challan

- Contract: `v1_document_request(kind=delivery_challan)`
- Input: order/customer,date,dispatch IDs,idempotency_key
- Result: job ID/PDF
- Rules: Use dispatch snapshot; own factory or dealer scope; never expose unrelated customer addresses.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_catalogue_pdf_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_tailors_payment_pdf.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/catalogue_service.dart#L1)

### DOC.04 — Generate weekly tailor work/payment report

- Contract: `v1_document_request(kind=tailor_weekly)`
- Input: tailor/week,idempotency_key
- Result: job ID/PDF/email result
- Rules: One worker template and formula; scheduled Saturday report uses explicit timezone and authorized recipients.
- Managed workforce subjects: Tailor; SubTailor
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_catalogue_pdf_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_tailors_payment_pdf.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/catalogue_service.dart#L1)

### DOC.05 — Purge expired generated documents

- Contract: `internal document_retention`
- Input: retention cutoff
- Result: deleted object/reference counts
- Rules: Only generated outputs; never purge source media or historical business evidence by generic age rule.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_catalogue_pdf_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/generate_tailors_payment_pdf.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/catalogue_service.dart#L1)

## PROMO — Promotional content

Canonical business tables (within the existing snapshot, with `sa_` prefixes): promotions promotional_banners asset_infos base_product_asset_infos.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| PROMO.01 | Browse promotion categories, assets and banners | Admin; Sales Coordinator; Production Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 7 | — |
| PROMO.02 | Preview, share and download promotional files | Admin; Sales Coordinator; Production Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 7 | — |

### PROMO.01 — Browse promotion categories, assets and banners

- Contract: `v1_promotions_list; v1_banners_list`
- Input: category,cursor
- Result: content and scoped file grants
- Rules: Conditional JW/AW promotional-assets flag; preserve external YouTube/Drive link distinction.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/promotions_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/promotional_banners_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/promotion_service.dart#L1)

### PROMO.02 — Preview, share and download promotional files

- Contract: `client + media grant`
- Input: asset ID,intended disposition
- Result: authorized download/share link
- Rules: Reuse media module; no per-role share endpoint; client deep links and expired-file fallback tested.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/promotions_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/promotional_banners_controller.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/promotion_service.dart#L1)

## MEDIA — Files and media access

Canonical business tables (within the existing snapshot, with `sa_` prefixes): product_images brandings promotions catalogues.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| MEDIA.01 | Resolve/download migrated and new files | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | — |
| MEDIA.02 | Upload and attach design, reference or document file | Admin; Sales Coordinator; Customer; Dealer | Job Worker; Assistant Worker / Team | 6 | Printing Tracker admin |
| MEDIA.03 | Detach/replace media with history | Admin; Sales Coordinator; Customer; Dealer | — | 4 | Printing Tracker admin |
| MEDIA.04 | Missing-file and external-link reporting | Admin | — | 1 | Printing Tracker admin |

### MEDIA.01 — Resolve/download migrated and new files

- Contract: `POST squad-account/media/grants`
- Input: resource type/ID,attachment IDs
- Result: short-lived signed URLs,missing state
- Rules: Authorize business resource before object grant; private canto-media bucket. Existing admin-only policy cannot simply be reused for all mobile users.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product_image.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/pdf_view/pdf_view.dart#L1)

### MEDIA.02 — Upload and attach design, reference or document file

- Contract: `POST squad-account/media/uploads; v1_media_attach`
- Input: resource,filename,type,size; completed object ID
- Result: signed upload or bound attachment
- Rules: No arbitrary storage path grants; validate allowed types/size/checksum; resource-bound lease and orphan cleanup; capability-gated JW/AW designs.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product_image.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/pdf_view/pdf_view.dart#L1)

### MEDIA.03 — Detach/replace media with history

- Contract: `v1_media_detach`
- Input: resource/attachment,version
- Result: new reference version
- Rules: Owner/editor only; soft detach references; shared content hash objects not deleted until unreferenced and retention elapsed.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product_image.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/pdf_view/pdf_view.dart#L1)

### MEDIA.04 — Missing-file and external-link reporting

- Contract: `existing media_status; media_exceptions`
- Input: page/environment
- Result: ready/missing/external/error counts
- Rules: Keep staging and production separate. Explicit missing record, never substitute production media into staging.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/product_image.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/ui/views/pdf_view/pdf_view.dart#L1)

## NOTIFY — Notifications and devices

Canonical business tables (within the existing snapshot, with `sa_` prefixes): notifications user_devices users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| NOTIFY.01 | Register devices and manage own notifications | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | — |
| NOTIFY.02 | Deliver domain events to role-specific recipients | — | — | 0 | Trusted worker |
| NOTIFY.03 | Retry, deduplicate and observe delivery | Admin | — | 1 | Printing Tracker admin; Trusted worker |

### NOTIFY.01 — Register devices and manage own notifications

- Contract: `v1_device_save; v1_device_remove; v1_notifications_list`
- Input: device token/platform; cursor
- Result: device status or own notifications
- Rules: Derive recipient ID from identity; notifications controller currently trusts user_id. Client permissions, FCM background/foreground and deep links share SDK.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/notifications/strategy_factory.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/notifications/base_strategy.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/notifications_config.dart#L1)

### NOTIFY.02 — Deliver domain events to role-specific recipients

- Contract: `internal notification_dispatch`
- Input: event ID/version
- Result: in-app records and provider delivery attempts
- Rules: 115 legacy strategy mappings become event/recipient/template configuration; do not create 115 functions. Task/rating/job-sheet alerts outside factory also included.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/notifications/strategy_factory.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/notifications/base_strategy.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/notifications_config.dart#L1)

### NOTIFY.03 — Retry, deduplicate and observe delivery

- Contract: `v1_delivery_failures; internal notification_retry`
- Input: event/job ID
- Result: attempts and final state
- Rules: Unique event+recipient+channel; per-device token invalidation; at-least-once processing with idempotent effects; no replay of historical imported events.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/notifications/strategy_factory.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/notifications/base_strategy.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/notifications_config.dart#L1)

## MASTER — Master data administration

Canonical business tables (within the existing snapshot, with `sa_` prefixes): base_products add_ons parts colors fabrics rmp_skus rmp_prices settings.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| MASTER.01 | Read/edit catalogue and ready-made masters | — | — | 0 | Printing Tracker admin |
| MASTER.02 | Bulk edit, import/export and archive master records | — | — | 0 | Printing Tracker admin |
| MASTER.03 | Manage criteria, geography, app and integration settings | Admin | — | 1 | Printing Tracker admin |

### MASTER.01 — Read/edit catalogue and ready-made masters

- Contract: `existing canto_api.masters`
- Input: resource,action,payload
- Result: validated records and relations
- Rules: Reuse current 22-resource registry and admin guard; full transaction for joins, min-price stats and media. Canto role0 not automatically Printing Tracker admin.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/dashboard/v1/base_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/dashboard/v1/rmp_prices_controller.rb#L1)

### MASTER.02 — Bulk edit, import/export and archive master records

- Contract: `existing masters + v1_import_request; v1_export_request`
- Input: resource,CSV/object ID,mapping,idempotency_key
- Result: job with row errors or export
- Rules: Bounded validation then atomic batches; keep source/read-only modes explicit; master deletion protects active references.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/dashboard/v1/base_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/dashboard/v1/rmp_prices_controller.rb#L1)

### MASTER.03 — Manage criteria, geography, app and integration settings

- Contract: `v1_settings_read; v1_settings_save`
- Input: allowlisted setting group,values,version
- Result: versioned settings
- Rules: Split business Admin settings from platform secrets/provider configuration; extend existing registry only where missing, no generic table editor.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/dashboard/v1/base_products_controller.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/dashboard/v1/rmp_prices_controller.rb#L1)

## INTEGRATE — Warehouse and data integrations

Canonical business tables (within the existing snapshot, with `sa_` prefixes): orders rmp_skus sync_airtables bulk_uploads settings.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| INTEGRATE.01 | Warehouse availability, reserve, release and fulfill | — | — | 0 | Trusted worker |
| INTEGRATE.02 | Submit/cancel external order and sync customer | — | — | 0 | Trusted worker |
| INTEGRATE.03 | Signed order/stock webhook intake | — | — | 0 | Trusted worker |
| INTEGRATE.04 | Reconcile external statuses/inventory | Admin | — | 1 | Printing Tracker admin; Trusted worker |
| INTEGRATE.05 | Airtable master import/status and report export | Admin | — | 1 | Printing Tracker admin; Trusted worker |
| INTEGRATE.06 | CSV ready-made price and zone import | Admin | — | 1 | Printing Tracker admin |

### INTEGRATE.01 — Warehouse availability, reserve, release and fulfill

- Contract: `existing dashboard-stock-api / uniware-bridge adapters`
- Input: source order,facility,SKU quantities,idempotency key
- Result: reservation/order IDs,status
- Rules: One inventory authority per facility; select provider explicitly; reuse existing warehouse APIs and contracts. New Squad code must not duplicate Printing Tracker stock ledger.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/uni_commerce/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/airtable/fetch_all_data_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/airtable_service.dart#L1)

### INTEGRATE.02 — Submit/cancel external order and sync customer

- Contract: `squad-jobs handler warehouse`
- Input: domain event
- Result: provider reference/retry state
- Rules: Transactional outbox and persistent provider IDs; compensate on partial failure; never hold DB transaction over HTTP.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/uni_commerce/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/airtable/fetch_all_data_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/airtable_service.dart#L1)

### INTEGRATE.03 — Signed order/stock webhook intake

- Contract: `POST squad-webhooks/warehouse/:provider`
- Input: raw signed payload,event ID,timestamp
- Result: accepted/duplicate
- Rules: Verify HMAC over raw bytes, replay window and environment; queue before acknowledging. Branch stock webhooks are TODO/log-only, not proven complete behavior.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/uni_commerce/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/airtable/fetch_all_data_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/airtable_service.dart#L1)

### INTEGRATE.04 — Reconcile external statuses/inventory

- Contract: `v1_integration_reconcile; squad-jobs handler`
- Input: provider,scope,last cursor
- Result: job status and differences
- Rules: Scheduled fallback to webhooks; handle CREATED race and out-of-order events; do not let canceled/terminal order regress.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/uni_commerce/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/airtable/fetch_all_data_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/airtable_service.dart#L1)

### INTEGRATE.05 — Airtable master import/status and report export

- Contract: `v1_import_request(kind=airtable); v1_import_status`
- Input: selected families,dry_run,idempotency_key
- Result: job/counts/errors
- Rules: Preserve existing optional source integration behind environment flag; default off after Supabase owns masters; full audit, no competing master writers.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/uni_commerce/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/airtable/fetch_all_data_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/airtable_service.dart#L1)

### INTEGRATE.06 — CSV ready-made price and zone import

- Contract: `v1_import_request(kind=prices|zones)`
- Input: file ID,validated mappings,dry_run
- Result: job and row-level diagnostics
- Rules: Reuse bulk upload model; geography changes recompute future eligibility/price types intentionally; no silent historical repricing.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/uni_commerce/create_order_service.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/services/airtable/fetch_all_data_service.rb#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/airtable_service.dart#L1)

## REFRESH — One-way refresh and cutover

Canonical business tables (within the existing snapshot, with `sa_` prefixes): users orders settings.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| REFRESH.01 | Request and monitor environment refresh | — | — | 0 | Printing Tracker admin |
| REFRESH.02 | Reconcile identities, files and business data | — | — | 0 | Printing Tracker admin; Trusted worker |
| REFRESH.03 | Transition read-only mirror to new-system ownership | — | — | 0 | Printing Tracker admin |

### REFRESH.01 — Request and monitor environment refresh

- Contract: `existing canto-refresh + request_refresh/refresh_status`
- Input: environment,approved revision guard
- Result: job/progress/counts/errors
- Rules: Retain completed one-way database+Auth+media pipeline; staging source only to staging and production source only to production.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/user.rb#L1)

### REFRESH.02 — Reconcile identities, files and business data

- Contract: `existing worker + reconciliation reports`
- Input: snapshot manifest,identity/media checks
- Result: parity,exceptions,guard results
- Rules: Preserve Auth UUID mapping; explicit email-case collision exceptions; no replayed emails/order/stock side effects; snapshot/public guards.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/user.rb#L1)

### REFRESH.03 — Transition read-only mirror to new-system ownership

- Contract: `v1_cutover_preview; v1_cutover_commit`
- Input: environment,source watermark,acceptance ID
- Result: write epoch and refresh lock
- Rules: Before real new-app writes, stop destructive refresh for owned data. Final frozen-source import, parity, auth/media checks, enable writes. Rollback with new writes needs reverse reconciliation, not restore-old blindly.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/models/user.rb#L1)

## APP — App bootstrap and shared client behavior

Canonical business tables (within the existing snapshot, with `sa_` prefixes): app_configs users.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| APP.01 | Version, splash, login routing and shared navigation | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | Guest |
| APP.02 | Reusable screen/query composition | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | — |
| APP.03 | Local preferences, cache, preview and share | Admin; Sales Coordinator; Production Coordinator; Customer; Factory Manager; Dispatch Incharge; Inspector; Cutting Master; Dealer; Job Worker; Assistant Worker / Team | — | 11 | — |
| APP.04 | Payment instructions and acknowledgement | Sales Coordinator; Customer; Dealer | — | 3 | — |

### APP.01 — Version, splash, login routing and shared navigation

- Contract: `v1_app_bootstrap; client`
- Input: platform,version
- Result: minimum version,feature configuration
- Rules: Preserve force-update and connectivity states; 11 dashboards are compositions of shared modules; CustomerCoordinator phantom enum is not a new persona.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/app_configs_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/config_service.dart#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/app/utils.dart#L1)

### APP.02 — Reusable screen/query composition

- Contract: `shared TypeScript SDK + UI contracts`
- Input: capabilities,filters,selected environment
- Result: typed view model/query state
- Rules: One order list/detail, person editor, product browser, work queue and task view with scope/action configuration; no role-specific service copies.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/app_configs_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/config_service.dart#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/app/utils.dart#L1)

### APP.03 — Local preferences, cache, preview and share

- Contract: `client only`
- Input: local UI settings,resource versions
- Result: presentation state
- Rules: No backend endpoint for snackbars, SVG rendering or preferences. Key caches by environment+Auth UUID+capability/price/data revision; clear on logout.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/app_configs_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/config_service.dart#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/app/utils.dart#L1)

### APP.04 — Payment instructions and acknowledgement

- Contract: `client + v1_order_get`
- Input: order
- Result: QR/instructions/thank-you view
- Rules: Legacy manual payment guidance retained; do not invent charging, subscription or payment webhook services.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/controllers/api/v1/app_configs_controller.rb#L1), [source 2](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/services/config_service.dart#L1), [source 3](https://github.com/arslan9380/scott/blob/5d55d9461af18b94a867dce07dee7c4b76f1e51f/lib/app/utils.dart#L1)

## OPS — Durable work and audit

Canonical business tables (within the existing snapshot, with `sa_` prefixes): notifications bulk_uploads catalogues.

| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |
|---|---|---|---|---:|---|
| OPS.01 | Enqueue, claim and run bounded background work | — | — | 0 | Trusted worker |
| OPS.02 | Audit, job progress and operator retry | Admin | — | 1 | Printing Tracker admin |
| OPS.03 | Scheduled maintenance and derived rebuilds | — | — | 0 | Trusted worker |

### OPS.01 — Enqueue, claim and run bounded background work

- Contract: `squad-jobs + durable queue worker`
- Input: job ID,handler/version
- Result: lease,progress,result
- Rules: One handler registry; transactionally enqueue intent; retry/backoff/dead-letter; check idempotency after worker crash.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/jobs/application_job.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/config/sidekiq.yml#L1)

### OPS.02 — Audit, job progress and operator retry

- Contract: `v1_jobs_list; v1_job_get; v1_job_retry; v1_audit_list`
- Input: scope,job ID,reason
- Result: redacted progress and event history
- Rules: Domain-admin sees only allowed jobs; platform ops sees integrations/refresh. Simple existing Data Refresh page stays simple; shared status component.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/jobs/application_job.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/config/sidekiq.yml#L1)

### OPS.03 — Scheduled maintenance and derived rebuilds

- Contract: `Cron -> queue handlers`
- Input: schedule key + time window
- Result: bounded jobs
- Rules: Daily PDF expiry/external reconciliation; weekly tailor report; min-stat/report rebuilds event-driven. Avoid legacy 2030 placeholder as active schedule.
- Managed workforce subjects: None
- Evidence: [source 1](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/app/jobs/application_job.rb#L1), [source 2](https://github.com/arslan9380/scott-international-backend/blob/14277820c78e018e62be3da1a14cd8d716cdbf02/config/sidekiq.yml#L1)
