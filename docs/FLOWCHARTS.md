# Flowcharts

## Enquiry Concierge desk (Dashboard Support tab)

Status UI stays **New / Assigned / In progress / Resolved / Closed**. Concierge pick/SLA runs on top.

```mermaid
flowchart TD
  A[Open Support tab] --> ST{Sub-tab}
  ST -->|Enquiry| ENQ[Enquiry desk ENQ codes]
  ST -->|Complaints| B[Complaints desk CS codes]
  ST -->|Delay alert| DATab[Send delay WhatsApp]
  ST -->|Order status| OSTab[Queued production status texts]
  ST -->|Report| BL2[Blank placeholder]
  ENQ --> C[Client SLA pass]
  B --> C
  C --> D{Unpicked over 2h?}
  D -->|yes| E[Write sla_escalated_at + notify Gargi]
  D -->|no| F[Show table + cards]
  E --> F
  F --> G{User action}
  G -->|WhatsApp simulator| S[Fake chat files ticket]
  G -->|Enquiry path| EP[Name phone optional order details then ENQ code]
  G -->|Delay alert| DA[Queue delay text + next buttons]
  G -->|Prod status auto| PS[Backend queues status WhatsApp]
  G -->|Create| H[Order lookup + photos + insert]
  G -->|Assign| I[Team member or unknown to Gargi]
  G -->|Mark verified| J[picked_at]
  G -->|Mark contacted| K[in_progress]
  G -->|Close| L[closed + queue survey text]
  L --> M[WhatsApp simulator shows Feedback]
```

```mermaid
sequenceDiagram
  participant Staff
  participant App as EnquiryPanel
  participant SB as Supabase
  Staff->>App: Open Support / Complaints
  App->>SB: select enquiries
  App->>SB: escalate unpicked if due
  Staff->>App: Create / Assign / Pick
  App->>SB: insert or update enquiries
  App->>SB: storage enquiry-attachments
  SB-->>App: realtime
```

```mermaid
sequenceDiagram
  participant AM as Account manager
  participant App as Enquiry detail
  participant SB as Supabase
  participant Sim as WhatsApp simulator
  AM->>App: Close
  App->>SB: update enquiries status closed
  SB->>SB: trigger queue close survey
  SB-->>Sim: realtime enquiry_outbound_messages
  Sim->>Sim: show Feedback text
  Sim->>SB: save feedback_rating
```

```mermaid
sequenceDiagram
  participant Staff
  participant Card as Delay alert card
  participant SB as Supabase
  participant Sim as WhatsApp simulator
  Staff->>Card: Order number, phone, new date
  Card->>SB: insert support_delay_alerts
  Card->>SB: insert enquiry_outbound_messages delay + buttons
  SB-->>Sim: realtime outbound
  Sim->>Sim: show Concierge delay copy
```

```mermaid
sequenceDiagram
  participant Prod as Production
  participant SB as Supabase
  participant Sim as WhatsApp simulator
  Prod->>SB: update orders.status
  SB->>SB: trigger queue_production_status_customer_message
  SB->>SB: lookup phone enquiry / contact / Ready Stock
  alt phone found
    SB->>SB: insert support_production_status_alerts queued
    SB->>SB: insert enquiry_outbound_messages
    SB-->>Sim: realtime outbound
    Sim->>Sim: show Status is now
  else no phone
    SB->>SB: insert support_production_status_alerts skipped
  end
```

```mermaid
sequenceDiagram
  participant Cust as WhatsApp simulator
  participant App as EnquiryWhatsAppSimulator
  participant SB as Supabase
  Cust->>App: Home then Help then Customized then Enquiries
  App->>Cust: Ask name
  Cust->>App: Name
  App->>Cust: Ask phone
  Cust->>App: Phone
  App->>Cust: Optional order ID or Skip
  Cust->>App: Details
  App->>SB: insert enquiries ticket_kind enquiry
  SB-->>App: ENQ-#####
  App->>Cust: Enquiry logged confirmation
```

```mermaid
sequenceDiagram
  participant Cust as WhatsApp simulator
  participant App as EnquiryWhatsAppSimulator
  participant SB as Supabase
  Cust->>App: Help then Concerns then Product issues
  App->>Cust: Ask Order ID
  Cust->>App: Order ID
  App->>Cust: Ask issue then photos
  Cust->>App: Photo then Done
  App->>SB: upload photos then insert enquiries
  SB-->>App: CS-#####
  App->>Cust: Ticket created confirmation
```

```mermaid
flowchart LR
  subgraph ui [Support tab]
    Cards[New Assigned In progress Resolved Closed]
    Pending[Pending badge if unpicked]
    Detail[Detail dialog Concierge actions]
    Sub[Enquiry Complaints Delay alert Order status Report]
    Delay[Delay alert tab]
    Status[Order status tab]
    Cols[Customer Order ID Concerns]
  end
  Delay --> Sub
  Status --> Sub
  Sub --> Cards
  Cards --> Cols
  Cols --> Detail
  Pending --> Detail
```

## Purchase Order main tab

```mermaid
flowchart TD
  User[Open sidebar] --> PO[Purchase Order tab]
  PO --> Panel[PurchaseOrderPanel]
  Panel --> Plus[Plus new PO]
  Panel --> Grid[Compact unlabeled sheet]
  Grid --> L[R1 invoice To Scott address]
  Grid --> R2[R2 Consignee ship to]
  Grid --> R3[R3 supplier dropdown]
  Grid --> R11[R11 Voucher No plus PO FY seq]
  Grid --> R12[R12 Dated plus create day]
  Grid --> R31[R31 Reference copies R11 voucher]
  Grid --> R22[R22 Mode terms of Payment 30 days]
  Grid --> TR[R21 R32 R41 R42]
  Grid --> BR[R21B Terms of Delivery plus input]
  Plus --> Alloc[Next seq for current FY]
  Alloc --> R11
  Alloc --> R12
  Alloc --> R31
```

```mermaid
sequenceDiagram
  participant User
  participant App
  participant SB as Staging Supabase
  User->>App: Select Purchase Order
  App->>App: dashboardTab purchase_order
  App->>SB: max seq for FY then insert next voucher
  SB-->>App: PO/26-27/392 plus created_at
  App-->>User: R11 voucher, R12 Dated, R31 same voucher
  User->>App: Plus
  App->>SB: insert next seq
  SB-->>App: PO/26-27/393 plus today
  App-->>User: New voucher on R11 and R31, new Dated, empty delivery terms
```
