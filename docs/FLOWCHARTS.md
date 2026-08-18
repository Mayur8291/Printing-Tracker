# Flowcharts

## Enquiry Concierge desk (Dashboard Support tab)

Status UI stays **New / Assigned / In progress / Resolved / Closed**. Concierge pick/SLA runs on top.

```mermaid
flowchart TD
  A[Open Support tab] --> ST{Sub-tab}
  ST -->|Enquiry| BL1[Blank placeholder]
  ST -->|Report| BL2[Blank placeholder]
  ST -->|Complaints| B[Load enquiries RLS]
  B --> C[Client SLA pass]
  C --> D{Unpicked over 2h?}
  D -->|yes| E[Write sla_escalated_at + notify Gargi]
  D -->|no| F[Show table + cards]
  E --> F
  F --> G{User action}
  G -->|WhatsApp simulator| S[Fake chat files WhatsApp enquiry]
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
flowchart LR
  subgraph ui [Support tab]
    Cards[New Assigned In progress Resolved Closed]
    Pending[Pending badge if unpicked]
    Detail[Detail dialog Concierge actions]
    Sub[Enquiry Complaints Report]
    Cols[Customer Order ID Concerns]
  end
  Sub --> Cards
  Cards --> Cols
  Cols --> Detail
  Pending --> Detail
```
