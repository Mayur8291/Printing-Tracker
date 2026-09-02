# Uniware boundary contract (Step 5)

Signed as of 2026-09-02 for the Scott Ops Platform. This is the rule that prevents double-counting stock.

## Ownership

| Location | Owner | Platform may |
|---|---|---|
| Uniware ecom facility (and its shelves) | **Uniware** | Mirror on-hand (read-only). Never add those qty into platform-owned stock. |
| Every other warehouse / zone / job-worker / in-transit | **Platform** | Ledger (`inv_movement`) is the truth. |
| Amazon FC / sold-in distributor | **External** | Record what we sent. On-hand comes from their report / mirror. |

A location has exactly one `owner_system` (`platform` | `uniware` | `external`). Never both.

## What crosses the line

Stock moves between platform and the Uniware facility **only** through a `uni_transfer` document.

- Platform → Uniware: platform movement (source → `in_transit` → `uniware_facility` marker) **and** Uniware `POST /services/rest/v1/inventory/adjust` `adjustmentType: ADD` with the transfer number in `remarks`.
- Reverse: Uniware `REMOVE` + platform movement back from the marker / in-transit.

Nothing else in the platform writes Uniware inventory. The Inventory tab and Stock Ledger never treat the mirror as platform-owned.

## What is mirrored (read-only)

- Inventory snapshot per facility × SKU (good / bad / QC).
- Sale orders (`channel = ecom_uniware` on `uni_sale_order`; never edited here — link out to Uniware).
- Shipments, invoices, returns when the feed is enabled.

Retries are idempotent: upserts key on Uniware's code.

## Auth

OAuth password grant per tenant. `Facility` header on every warehouse call. Token cached until expiry. Secrets live in the edge function (`UNIWARE_BASE_URL`, `UNIWARE_USERNAME`, `UNIWARE_PASSWORD`, `UNIWARE_FACILITY`) — never in the SPA.

## Freshness

`uni_sync_log` stores last-success per feed. The Uniware Bridge tab (`ops_uniware`) flags a feed with no success for two hours.

## Out of scope (do not build here)

Marketplace connectors, labels, manifests, courier APIs. Uniware keeps those. B2B orders stay on the platform (`so_order`) and do not enter Uniware unless they already do today.
