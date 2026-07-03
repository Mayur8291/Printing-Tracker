# Database

## `inward_grn_entries`

Multiple GRN rows per inward entry. Labels print per GRN row.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | bigint | Primary key |
| `inward_entry_id` | bigint | FK → `inward_entries.id` |
| `grn_no` | text | GRN number |
| `for_whom` | text | Recipient / department |
| `supplier` | text | Supplier name |
| `invoice_no` | text | Supplier invoice |
| `qty_received` | text | Total qty (pieces for apparel, kg for fabric) |
| `bora_carton_unit` | text | Bora count (apparel) or lot count (fabric) |
| `location_rack` | text | Storage location |
| `received_by` | text | Person who received goods |
| `remark` | text | Optional note |
| `size_breakdown` | jsonb | Aggregated size totals (apparel) for labels |
| `grn_entry_detail` | jsonb | Full form: `type`, `header`, `boras[]`, `fabrics[]` |
| `created_by` | uuid | Auth user |
| `created_at` | timestamptz | Insert time |

### `grn_entry_detail` shape

```json
{
  "version": 1,
  "type": "apparel",
  "header": { "date": "2026-06-22", "forWhom": "", "receivedBy": "", "remark": "" },
  "boras": [{ "id": "…", "label": "Bora 1", "products": [{ "id": "…", "name": "…", "S": "12", "M": "24", "L": "24", "XL": "18", "XXL": "6" }] }],
  "fabrics": [{ "id": "…", "ftype": "…", "color": "…", "gsm": "180", "rolls": "4", "kgs": "96.5", "lot": "LOT-7781" }]
}
```

### Migrations

| Migration | Change |
|-----------|--------|
| `20260619120000_add_inward_grn_entries.sql` | Create table, RLS, legacy data move |
| `20260630120000_add_grn_entry_detail.sql` | Add `grn_entry_detail` jsonb |

## Inventory

### `inventory_style_parents`

Parent style / SKU group (one row per style family).

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `parent_sku_code` | text | Unique parent code (e.g. `STY-1`) |
| `style_name` | text | Display style name |
| `kind` | text | `fabric`, `trim`, or `apparel` |
| `created_by` | uuid | Auth user |
| `created_at` | timestamptz | Insert time |

### `inventory_skus`

Master SKU records. Sub SKUs (colorways / variants) link to a parent via `parent_style_id`.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `sku_code` | text | Unique sub SKU code |
| `kind` | text | `fabric`, `trim`, or `apparel` |
| `name` | text | Style or material name |
| `parent_style_id` | uuid | FK → `inventory_style_parents.id` (nullable) |
| `unit_cost` | numeric | Cost per unit |
| `retail_price` | numeric | Sale price (all kinds) |
| `reorder_point` | numeric | Low-stock threshold |
| `doc` | numeric | Days of cover |
| `drr` | numeric | Daily run rate |
| `stock_qty` | numeric | On-hand quantity |
| `extra` | jsonb | Kind-specific fields (sizes, GSM, etc.) |

### Migrations (inventory)

| Migration | Change |
|-----------|--------|
| `20260620120000_add_inventory_tables.sql` | Core inventory tables |
| `20260708120000_inventory_sku_parent_pricing_doc_drr.sql` | Parent styles, `doc`, `drr`, `parent_style_id` |

## `orders` — job sheet payment / delivery / approval

Production tracker job sheets store payment and approval data on the same `orders` row (`is_production_order = true`).

| Column | Type | Purpose |
|--------|------|---------|
| `order_cost` | numeric | Total amount |
| `job_sheet_payment_mode` | text | Mode of payment (cash, UPI, bank transfer, etc.) |
| `job_sheet_advance_amount` | numeric | Advance received |
| `job_sheet_advance_payment_date` | date | Date advance was received |
| `job_sheet_advance_proof_url` | text | JSON array of transaction proof URLs (`payment-screenshots` bucket) |
| `job_sheet_balance_amount` | numeric | Total minus advance (snapshot at save) |
| `job_sheet_pending_amount` | numeric | Balance when not full paid; 0 when full paid |
| `job_sheet_full_paid` | boolean | Whether order is fully paid |
| `job_sheet_payment_closure_at` | timestamptz | Auto-set when full paid = yes |
| `job_sheet_payment_proof_url` | text | JSON array of final payment proof URLs |
| `job_sheet_delivery_city` | text | Delivery city (India) |
| `job_sheet_transport_charges` | numeric | Transport charges |
| `job_sheet_approval_date` | date | Approval date |
| `job_sheet_approval_image_url` | text | Approval image URL (`approved-designs` bucket) |
| `job_sheet_approved_by` | text | Approver name |
| `job_sheet_regular_stock` | boolean | Whether regular stock items are used |
| `job_sheet_regular_stock_items` | jsonb | Array of `{ sku_uuid, sku_code, name, color, qty }` from inventory |

### Migrations (job sheet payment)

| Migration | Change |
|-----------|--------|
| `20260703160000_add_job_sheet_payment_delivery_approval.sql` | Add columns above |
| `20260703180000_add_job_sheet_regular_stock.sql` | Regular stock flag + items jsonb |
