import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInventoryDrrWindow,
  buildOrderQuantityBySku,
  enrichInventoryWithOrderDemand,
  isCompletedInventoryDemand
} from "./inventoryDemand.js";

const WINDOW = {
  startDate: "2026-06-01",
  endDate: "2026-08-29",
  start_date: "01-06-2026",
  end_date: "29-08-2026",
  days: 90
};

function order(overrides = {}) {
  return {
    order_date: "01-07-2026",
    rmp_sku_id: "SKU-1",
    rmp_sku_name: "SCOTT-POLO-WHT-S",
    quantity: 90,
    order_status: "COMPLETED",
    ...overrides
  };
}

test("DRR window is inclusive, 90 days long and caps future dates at today", () => {
  assert.deepEqual(buildInventoryDrrWindow("31-12-2026", new Date(2026, 7, 29)), WINDOW);
});

test("only realized order statuses qualify", () => {
  for (const status of ["COMPLETED", "DISPATCHED", "DELIVERED", "CLOSED", "FULFILLED", "SHIPPED"]) {
    assert.equal(isCompletedInventoryDemand(order({ order_status: status })), true);
  }
  for (const status of ["PENDING", "OVERDUE", "CANCELLED", "FAILED", "REJECTED", "VOID"]) {
    assert.equal(isCompletedInventoryDemand(order({ order_status: status })), false);
  }
});

test("quantities aggregate by normalized SKU aliases within the inclusive window", () => {
  const totals = buildOrderQuantityBySku(
    [
      order({ quantity: 180, order_date: "01-06-2026" }),
      order({ quantity: 90, order_date: "29-08-2026", rmp_sku_id: " sku-1 " }),
      order({ quantity: 500, order_date: "31-05-2026" }),
      order({ quantity: 500, order_status: "CANCELLED" })
    ],
    WINDOW
  );
  assert.equal(totals.get("sku-1"), 270);
  assert.equal(totals.get("scott-polo-wht-s"), 270);
});

test("inventory joins order demand case-insensitively and preserves direct API DRR", () => {
  const [derived, direct] = enrichInventoryWithOrderDemand(
    [
      { id: "inventory-1", sku: " scott-polo-wht-s ", inventory: 180 },
      { id: "SKU-1", sku: "OTHER", inventory: 40, drr: 4, days_of_cover: 10 }
    ],
    [order({ quantity: 270 })],
    WINDOW
  );
  assert.equal(derived.three_month_sales, 270);
  assert.equal(direct.drr, 4);
  assert.equal(direct.three_month_sales, undefined);
});

test("zero qualifying demand is represented as zero 90-day sales", () => {
  const [row] = enrichInventoryWithOrderDemand(
    [{ id: "SKU-2", sku: "SKU-2", inventory: 50 }],
    [order({ order_status: "PENDING" })],
    WINDOW
  );
  assert.equal(row.three_month_sales, 0);
});
