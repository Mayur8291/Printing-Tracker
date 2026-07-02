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
