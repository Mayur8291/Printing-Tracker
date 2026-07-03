import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { POS } from "./inventoryData";
import { supabase } from "../supabaseClient";
import {
  applyStockAdjustment,
  deriveAlerts,
  deleteSku,
  fetchInventoryMovements,
  fetchInventoryRefreshBundle,
  fetchInventorySkuRowsFromOffset,
  fetchSkuDetail,
  fetchSkuMovements,
  insertSku,
  insertSkuBatch,
  insertStockMovement,
  insertStyleParent,
  insertSupplier,
  insertWarehouse,
  rowToSku,
  saveAlertSettings,
  updateSkuFields,
  updateSkuReorder
} from "./inventoryDbUtils";
import { INVENTORY_INITIAL_SKU_BATCH } from "./inventoryQueryFields";
import { buildMinimalSupplierRecord, buildMinimalWarehouseRecord } from "./inventoryMasterQuickAdd";

const InventoryDataContext = createContext(null);

export function InventoryDataProvider({ session, children }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [skus, setSkus] = useState([]);
  const [styleParents, setStyleParents] = useState([]);
  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [loadingMoreSkus, setLoadingMoreSkus] = useState(false);
  const inventoryRefreshTimerRef = useRef(null);
  const movementsLoadedRef = useRef(false);
  const loadingMoreSkusRef = useRef(false);

  const userId = session?.user?.id || null;
  const userDisplayName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split("@")[0] ||
    "You";

  const applyBundle = useCallback((bundle, { keepMovements = false } = {}) => {
    setSettings(bundle.settings);
    setSuppliers(bundle.suppliers);
    setWarehouses(bundle.warehouses);
    setStyleParents(bundle.styleParents || []);
    setSkus(bundle.skus);
    if (!keepMovements && Array.isArray(bundle.movements)) setMovements(bundle.movements);
  }, []);

  const loadMovements = useCallback(async ({ silent = true } = {}) => {
    if (movementsLoadedRef.current) return;
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
    } catch (err) {
      console.error("Inventory SKU background load:", err?.message || err);
    } finally {
      loadingMoreSkusRef.current = false;
      setLoadingMoreSkus(false);
    }
  }, []);

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
      if (!silent) {
        window.setTimeout(() => {
          void loadMovements({ silent: true });
        }, 2500);
      }
    } catch (err) {
      if (!silent) setError(err?.message || "Could not load inventory data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyBundle, loadMovements, loadRemainingSkus]);

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
      patchSkuInState(merged);
      return { sku: merged, movements: skuMovements };
    },
    [patchSkuInState]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel(`inventory-skus-bundle-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_skus" },
        () => {
          if (inventoryRefreshTimerRef.current) {
            clearTimeout(inventoryRefreshTimerRef.current);
          }
          inventoryRefreshTimerRef.current = window.setTimeout(() => {
            inventoryRefreshTimerRef.current = null;
            void refresh({ silent: true });
          }, 400);
        }
      )
      .subscribe();

    return () => {
      if (inventoryRefreshTimerRef.current) {
        clearTimeout(inventoryRefreshTimerRef.current);
        inventoryRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const fabrics = useMemo(() => skus.filter((s) => s.kind === "fabric"), [skus]);
  const trims = useMemo(() => skus.filter((s) => s.kind === "trim"), [skus]);
  const apparel = useMemo(() => skus.filter((s) => s.kind === "apparel"), [skus]);
  const alerts = useMemo(() => deriveAlerts(skus, settings), [skus, settings]);

  const warehousesWithUsage = useMemo(() => {
    return warehouses.map((wh) => {
      const used = skus
        .filter((s) => s.wh === wh.id)
        .reduce((sum, s) => sum + Number(s.stock ?? s.totalStock ?? 0), 0);
      return { ...wh, used };
    });
  }, [warehouses, skus]);

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
    const updated = await updateSkuFields(skuUuid, patch);
    setSkus((prev) => prev.map((s) => (s._uuid === updated._uuid ? updated : s)));
    return updated;
  }, []);

  const createStyleParent = useCallback(
    async ({ parentSkuCode, styleName, kind }) => {
      const parent = await insertStyleParent({ parentSkuCode, styleName, kind }, userId);
      setStyleParents((prev) =>
        [...prev, parent].sort((a, b) => (a.styleName || "").localeCompare(b.styleName || ""))
      );
      return parent;
    },
    [userId]
  );

  const createSku = useCallback(
    async (kind, record) => {
      let parentStyleId = record.parentStyleId || null;

      if (record.parentMode === "new" && record.parentSkuCode && record.parentStyleName) {
        const parent = await insertStyleParent(
          {
            parentSkuCode: record.parentSkuCode,
            styleName: record.parentStyleName,
            kind
          },
          userId
        );
        parentStyleId = parent.id;
        setStyleParents((prev) => [...prev, parent]);
      }

      const created = await insertSku(kind, { ...record, parentStyleId }, userId);
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
      }
      return created;
    },
    [userId]
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

  const adjustStock = useCallback(
    async ({ skuUuid, type, qty, reason, reference, fromWh, toWh }) => {
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
    [userId]
  );

  const createSupplier = useCallback(async (record) => {
    await insertSupplier(record);
    await refresh();
  }, [refresh]);

  const createWarehouse = useCallback(async (record) => {
    await insertWarehouse(record);
    await refresh();
  }, [refresh]);

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
    styleParents,
    fabrics,
    trims,
    apparel,
    movements,
    alerts,
    pos: POS,
    refresh,
    loadMovements,
    hydrateSkuDetail,
    patchSkuInState,
    updateAlertSettings,
    saveSkuReorder,
    saveSkuFields,
    createStyleParent,
    createSku,
    importSkus,
    adjustStock,
    removeSku,
    createSupplier,
    createWarehouse,
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
