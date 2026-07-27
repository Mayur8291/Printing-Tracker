import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { POS } from "./inventoryData";
import { supabase } from "../supabaseClient";
import {
  applyFacilityStockAdjustment,
  bulkAdjustFacilityStock,
  applyStockAdjustment,
  deriveAlerts,
  deleteSku,
  fetchInventoryMovements,
  fetchInventoryMovementsSince,
  fetchInventoryRefreshBundle,
  fetchInventorySkuRowsFromOffset,
  fetchSkuDetail,
  fetchSkuMovements,
  insertSku,
  insertSkuBatch,
  insertStockMovement,
  insertSupplier,
  insertWarehouse,
  rowToSku,
  saveAlertSettings,
  updateSkuFields,
  updateSkuReorder,
  updateWarehouse,
  updateWarehouseLayout
} from "./inventoryDbUtils";
import { INVENTORY_INITIAL_SKU_BATCH } from "./inventoryQueryFields";
import { STOCK_ADJUST_BATCH_SIZE } from "./inventoryStockAdjustImportUtils";
import { buildMinimalSupplierRecord, buildMinimalWarehouseRecord } from "./inventoryMasterQuickAdd";
import { subscribePostgresChanges } from "../realtimeUtils";
import { kpiMovementsSinceIso } from "./inventoryKpiUtils";
import {
  applyComputedDrrToSkus,
  fetchComputedDrrBySkuCode
} from "./inventoryDrrUtils";
import { facilityStockForSku, onHandAtWarehouse, resolveFacilityCode } from "./inventoryFacilityUtils";

const InventoryDataContext = createContext(null);

export function InventoryDataProvider({ session, children }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [skus, setSkus] = useState([]);
  const [movements, setMovements] = useState([]);
  const [kpiMovements, setKpiMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [loadingMoreSkus, setLoadingMoreSkus] = useState(false);
  const [availabilityBySku, setAvailabilityBySku] = useState(null);
  const movementsLoadedRef = useRef(false);
  const loadingMoreSkusRef = useRef(false);

  const userId = session?.user?.id || null;
  const userDisplayName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split("@")[0] ||
    "You";

  const loadComputedDrr = useCallback(async (skuList) => {
    try {
      const drrMap = await fetchComputedDrrBySkuCode();
      setSkus((prev) => {
        const base = skuList ?? prev;
        return applyComputedDrrToSkus(base, drrMap);
      });
    } catch (err) {
      console.warn("Inventory DRR compute:", err?.message || err);
    }
  }, []);

  const applyBundle = useCallback((bundle, { keepMovements = false } = {}) => {
    setSettings(bundle.settings);
    setSuppliers(bundle.suppliers);
    setWarehouses(bundle.warehouses);
    setSkus(bundle.skus);
    if (!keepMovements && Array.isArray(bundle.movements)) setMovements(bundle.movements);
    void loadComputedDrr(bundle.skus);
  }, [loadComputedDrr]);

  const loadMovements = useCallback(async ({ silent = true, force = false } = {}) => {
    if (movementsLoadedRef.current && !force) return;
    if (!silent) setMovementsLoading(true);
    try {
      const rows = await fetchInventoryMovements();
      setMovements(rows);
      movementsLoadedRef.current = true;
    } catch (err) {
      if (!silent) setError(err?.message || "Could not load stock movements.");
    } finally {
      if (!silent) setMovementsLoading(false);
    }
  }, []);

  const loadKpiMovements = useCallback(async () => {
    try {
      const since = kpiMovementsSinceIso();
      const rows = await fetchInventoryMovementsSince(since);
      setKpiMovements(rows);
    } catch (err) {
      console.error("Inventory KPI movements:", err?.message || err);
    }
  }, []);

  // Reserved stock lives only in inventory_facility_stock (Dashboard Stock API);
  // stock_qty alone overstates what is sellable. Fail soft: null map = fall back to stock_qty.
  const loadAvailability = useCallback(async () => {
    try {
      const pageSize = 1000;
      const rows = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("inventory_sku_availability")
          .select("sku_code, facility_code, on_hand_qty, reserved_qty, available_qty")
          .order("sku_code")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      const bySku = {};
      for (const row of rows) {
        const onHand = Number(row.on_hand_qty) || 0;
        const reserved = Number(row.reserved_qty) || 0;
        const available = Number.isFinite(Number(row.available_qty))
          ? Number(row.available_qty)
          : Math.max(0, onHand - reserved);
        const entry =
          bySku[row.sku_code] ||
          (bySku[row.sku_code] = { onHand: 0, reserved: 0, available: 0, facilities: [] });
        entry.onHand += onHand;
        entry.reserved += reserved;
        entry.available += available;
        entry.facilities.push({ facilityCode: row.facility_code, onHand, reserved, available });
      }
      setAvailabilityBySku(bySku);
    } catch (err) {
      console.error("Inventory availability load (falling back to stock_qty):", err?.message || err);
      setAvailabilityBySku(null);
    }
  }, []);

  const loadRemainingSkus = useCallback(async () => {
    if (loadingMoreSkusRef.current) return;
    loadingMoreSkusRef.current = true;
    setLoadingMoreSkus(true);
    try {
      const moreRows = await fetchInventorySkuRowsFromOffset(INVENTORY_INITIAL_SKU_BATCH);
      if (!moreRows.length) return;
      const moreSkus = moreRows.map(rowToSku);
      setSkus((prev) => {
        const seen = new Set(prev.map((s) => s._uuid));
        const merged = [...prev];
        for (const sku of moreSkus) {
          if (!seen.has(sku._uuid)) merged.push(sku);
        }
        return merged.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      });
      void loadComputedDrr();
    } catch (err) {
      console.error("Inventory SKU background load:", err?.message || err);
    } finally {
      loadingMoreSkusRef.current = false;
      setLoadingMoreSkus(false);
    }
  }, [loadComputedDrr]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
      movementsLoadedRef.current = false;
    }
    try {
      const bundle = await fetchInventoryRefreshBundle({ fullSkus: silent });
      applyBundle(bundle, { keepMovements: silent && movementsLoadedRef.current });
      if (!silent && bundle.hasMoreSkus) {
        void loadRemainingSkus();
      }
      void loadKpiMovements();
      if (!silent) {
        window.setTimeout(() => {
          void loadMovements({ silent: true, force: true });
          void loadKpiMovements();
        }, 2500);
      }
    } catch (err) {
      if (!silent) setError(err?.message || "Could not load inventory data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyBundle, loadMovements, loadKpiMovements, loadRemainingSkus]);

  useEffect(() => {
    void loadKpiMovements();
  }, [loadKpiMovements]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  const patchSkuInState = useCallback((sku) => {
    if (!sku?._uuid) return;
    setSkus((prev) => prev.map((s) => (s._uuid === sku._uuid ? { ...s, ...sku } : s)));
  }, []);

  const hydrateSkuDetail = useCallback(
    async (sku) => {
      if (!sku?._uuid) return { sku, movements: [] };
      const [detail, skuMovements] = await Promise.all([
        fetchSkuDetail(sku._uuid),
        fetchSkuMovements(sku._uuid)
      ]);
      const merged = detail || sku;
      patchSkuInState({ ...merged, drr: sku.drr });
      return { sku: { ...merged, drr: sku.drr }, movements: skuMovements };
    },
    [patchSkuInState]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;

    return subscribePostgresChanges({
      channelName: `inventory-bundle-${userId}`,
      tables: [
        "inventory_skus",
        "inventory_stock_movements",
        "inventory_alert_settings",
        "inventory_suppliers",
        "inventory_warehouses"
      ],
      onEvent: () => {
        void refresh({ silent: true });
        void loadKpiMovements();
        if (movementsLoadedRef.current) {
          void loadMovements({ silent: true, force: true });
        }
      }
    });
  }, [userId, refresh, loadMovements, loadKpiMovements]);

  useEffect(() => {
    if (!userId) return undefined;

    return subscribePostgresChanges({
      channelName: `inventory-availability-${userId}`,
      tables: ["inventory_facility_stock"],
      onEvent: () => {
        void loadAvailability();
      }
    });
  }, [userId, loadAvailability]);

  useEffect(() => {
    if (!userId) return undefined;

    return subscribePostgresChanges({
      channelName: `inventory-drr-orders-${userId}`,
      tables: ["scott_orders", "scott_order_items"],
      onEvent: () => {
        void loadComputedDrr();
      }
    });
  }, [userId, loadComputedDrr]);

  const fabrics = useMemo(() => skus.filter((s) => s.kind === "fabric"), [skus]);
  const trims = useMemo(() => skus.filter((s) => s.kind === "trim"), [skus]);
  const apparel = useMemo(() => skus.filter((s) => s.kind === "apparel"), [skus]);
  // Alerts compare against available (on_hand − reserved) when facility data is loaded.
  const alerts = useMemo(() => {
    const adjusted = !availabilityBySku
      ? skus
      : skus.map((s) => {
          const entry = availabilityBySku[s.id];
          if (!entry) return s;
          return s.totalStock !== undefined
            ? { ...s, totalStock: entry.available, stock: entry.available }
            : { ...s, stock: entry.available };
        });
    return deriveAlerts(adjusted, settings);
  }, [skus, settings, availabilityBySku]);

  const warehousesWithUsage = useMemo(() => {
    return warehouses.map((wh) => {
      const used = skus.reduce((sum, sku) => sum + onHandAtWarehouse(sku, wh, availabilityBySku), 0);
      return { ...wh, used };
    });
  }, [warehouses, skus, availabilityBySku]);

  const updateAlertSettings = useCallback(
    async (patch) => {
      const saved = await saveAlertSettings(patch, userId);
      setSettings(saved);
      return saved;
    },
    [userId]
  );

  const saveSkuReorder = useCallback(async (skuUuid, reorderPoint) => {
    const updated = await updateSkuReorder(skuUuid, reorderPoint);
    setSkus((prev) => prev.map((s) => (s._uuid === updated._uuid ? updated : s)));
    return updated;
  }, []);

  const saveSkuFields = useCallback(async (skuUuid, patch) => {
    const { drr: _ignoredDrr, ...rest } = patch;
    const updated = await updateSkuFields(skuUuid, rest);
    setSkus((prev) =>
      prev.map((s) => {
        if (s._uuid !== updated._uuid) return s;
        return { ...updated, drr: s.drr };
      })
    );
    return updated;
  }, []);

  const createSku = useCallback(
    async (kind, record) => {
      const created = await insertSku(kind, record, userId);
      setSkus((prev) => [created, ...prev]);

      const qty = kind === "apparel" ? created.totalStock : created.stock;
      if (qty > 0 && created._uuid) {
        const movement = await insertStockMovement({
          skuUuid: created._uuid,
          type: "IN",
          qty,
          reason: "Opening stock",
          reference: "NEW-SKU",
          fromWh: created.wh,
          toWh: created.wh,
          userId
        });
        setMovements((prev) => [movement, ...prev]);
        void loadKpiMovements();
      }
      return created;
    },
    [userId, loadKpiMovements]
  );

  const importSkus = useCallback(
    async (kind, records, { onProgress } = {}) => {
      const chunkSize = 150;
      let done = 0;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        await insertSkuBatch(kind, chunk, userId, { chunkSize: chunk.length });
        done += chunk.length;
        onProgress?.(done, records.length);
      }
      await refresh();
      return { imported: records.length };
    },
    [refresh, userId]
  );

  const bulkImportStockAdjust = useCallback(
    async (rows, { warehouseId, onProgress } = {}) => {
      if (!warehouseId) {
        throw new Error("Select a warehouse before bulk upload.");
      }

      let stockAdjusted = 0;
      let metricsUpdated = 0;
      let stockFailed = 0;
      const failedRows = [];

      const stockRows = rows.filter((r) => !r.error && r._uuid && r.willAdjustStock && r.targetStock != null);
      const metricRows = rows.filter((r) => !r.error && r._uuid && (r.willUpdateDoc || r.willUpdateBin));

      let done = 0;
      const report = () => onProgress?.(done, rows.length);

      for (let i = 0; i < stockRows.length; i += STOCK_ADJUST_BATCH_SIZE) {
        const chunk = stockRows.slice(i, i + STOCK_ADJUST_BATCH_SIZE);
        const adjustments = chunk.map((row) => ({
          sku_id: row._uuid,
          target_on_hand: row.targetStock,
          reason: row.reason || "Bulk Excel stock adjust",
          reference: "BULK-EXCEL"
        }));

        const result = await bulkAdjustFacilityStock({ warehouseId, adjustments, userId });
        stockAdjusted += Number(result.applied) || 0;
        stockFailed += Number(result.failed) || 0;

        for (const entry of result.results || []) {
          if (entry?.ok === false) {
            const row = chunk.find((r) => r._uuid === entry.sku_id);
            failedRows.push({ skuCode: row?.skuCode || entry.sku_id, error: entry.error || "Stock adjust failed" });
          }
        }

        done = Math.min(rows.length, i + chunk.length);
        report();
      }

      for (let m = 0; m < metricRows.length; m++) {
        const row = metricRows[m];
        const patch = {};
        if (row.willUpdateDoc) patch.doc = row.doc;
        if (row.willUpdateBin) patch.bin = row.targetBin;
        try {
          await updateSkuFields(row._uuid, patch);
          metricsUpdated++;
        } catch (err) {
          failedRows.push({ skuCode: row.skuCode, error: err?.message || "Metrics update failed" });
          stockFailed++;
        }
        done = Math.min(rows.length, stockRows.length + m + 1);
        report();
      }

      done = rows.length;
      report();

      await refresh();
      void loadAvailability();
      void loadKpiMovements();
      return { stockAdjusted, metricsUpdated, stockFailed, failedRows, total: rows.length };
    },
    [refresh, userId, loadKpiMovements, loadAvailability]
  );

  const adjustStock = useCallback(
    async ({ skuUuid, type, qty, reason, reference, fromWh, toWh }) => {
      const sku = skus.find((s) => s._uuid === skuUuid);
      const warehouseId = toWh || fromWh || sku?.wh;
      const signedQty = type === "OUT" ? -Math.abs(qty) : Math.abs(qty);

      if (warehouseId && type !== "TRANSFER") {
        const whRow = warehouses.find((w) => w.id === warehouseId);
        const fc = whRow ? resolveFacilityCode(whRow) : "";
        const fac = facilityStockForSku(availabilityBySku, sku?.id, fc);
        const currentOnHand = fac ? fac.onHand : sku?.wh === warehouseId ? Number(sku?.stock ?? sku?.totalStock ?? 0) : 0;
        const targetOnHand = Math.max(0, currentOnHand + signedQty);

        await applyFacilityStockAdjustment({
          skuUuid,
          warehouseId,
          targetOnHand,
          reason: reason || "",
          reference: reference || "",
          userId
        });

        void loadAvailability();
        await refresh({ silent: true });

        setSkus((prev) =>
          prev.map((s) => {
            if (s._uuid !== skuUuid) return s;
            const total = Math.max(0, Number(s.stock ?? s.totalStock ?? 0) + signedQty);
            if (s.totalStock !== undefined) return { ...s, totalStock: total, stock: total };
            return { ...s, stock: total };
          })
        );

        return { skuUuid, type, qty: signedQty, reason, reference, fromWh, toWh };
      }

      const movement = await applyStockAdjustment({
        skuUuid,
        type,
        qty,
        reason,
        reference,
        fromWh,
        toWh,
        userId
      });
      setMovements((prev) => [movement, ...prev]);
      void loadKpiMovements();
      setSkus((prev) =>
        prev.map((s) => {
          if (s._uuid !== skuUuid) return s;
          const delta = type === "OUT" ? -Math.abs(qty) : Math.abs(qty);
          if (s.totalStock !== undefined) {
            return { ...s, totalStock: Math.max(0, s.totalStock + delta) };
          }
          return { ...s, stock: Math.max(0, (s.stock || 0) + delta) };
        })
      );
      return movement;
    },
    [userId, loadKpiMovements, skus, warehouses, availabilityBySku, refresh, loadAvailability]
  );

  const createSupplier = useCallback(async (record) => {
    await insertSupplier(record);
    await refresh();
  }, [refresh]);

  const createWarehouse = useCallback(async (record) => {
    await insertWarehouse(record);
    await refresh();
  }, [refresh]);

  const editWarehouse = useCallback(async (id, record) => {
    const row = await updateWarehouse(id, record);
    setWarehouses((list) => list.map((w) => (w.id === id ? { ...w, ...row, used: w.used } : w)));
    await refresh();
    void loadAvailability();
    return row;
  }, [refresh, loadAvailability]);

  const editWarehouseLayout = useCallback(async (id, layout) => {
    const row = await updateWarehouseLayout(id, layout);
    setWarehouses((list) => list.map((w) => (w.id === id ? { ...w, layout: row.layout } : w)));
    return row;
  }, []);

  const quickCreateSupplier = useCallback(
    async (name) => {
      const row = await insertSupplier(buildMinimalSupplierRecord(name, suppliers));
      await refresh();
      return row;
    },
    [refresh, suppliers]
  );

  const quickCreateWarehouse = useCallback(
    async (name) => {
      const row = await insertWarehouse(buildMinimalWarehouseRecord(name, warehouses));
      await refresh();
      return row;
    },
    [refresh, warehouses]
  );

  const removeSku = useCallback(
    async (skuUuid) => {
      await deleteSku(skuUuid);
      setSkus((prev) => prev.filter((s) => s._uuid !== skuUuid));
      setMovements((prev) =>
        prev.filter((m) => {
          const match = skus.find((s) => s._uuid === skuUuid);
          return !match || m.sku !== match.id;
        })
      );
    },
    [skus]
  );

  const value = {
    loading,
    loadingMoreSkus,
    movementsLoading,
    error,
    settings,
    suppliers,
    warehouses: warehousesWithUsage,
    skus,
    fabrics,
    trims,
    apparel,
    movements,
    kpiMovements,
    alerts,
    availabilityBySku,
    refreshAvailability: loadAvailability,
    pos: POS,
    refresh,
    loadMovements,
    loadKpiMovements,
    hydrateSkuDetail,
    patchSkuInState,
    updateAlertSettings,
    saveSkuReorder,
    saveSkuFields,
    createSku,
    importSkus,
    bulkImportStockAdjust,
    adjustStock,
    removeSku,
    createSupplier,
    createWarehouse,
    editWarehouse,
    editWarehouseLayout,
    quickCreateSupplier,
    quickCreateWarehouse,
    canEdit: true,
    userDisplayName
  };

  return <InventoryDataContext.Provider value={value}><div className="flex h-full min-h-0 flex-1 flex-col">{children}</div></InventoryDataContext.Provider>;
}

export function useInventory() {
  const ctx = useContext(InventoryDataContext);
  if (!ctx) throw new Error("useInventory must be used within InventoryDataProvider");
  return ctx;
}
