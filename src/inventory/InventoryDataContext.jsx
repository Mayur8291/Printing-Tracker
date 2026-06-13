import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { POS } from "./inventoryData";
import {
  applyStockAdjustment,
  deriveAlerts,
  fetchInventoryBundle,
  insertSku,
  insertStockMovement,
  insertSupplier,
  insertWarehouse,
  saveAlertSettings,
  updateSkuReorder
} from "./inventoryDbUtils";

const InventoryDataContext = createContext(null);

export function InventoryDataProvider({ session, children }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [skus, setSkus] = useState([]);
  const [movements, setMovements] = useState([]);

  const userId = session?.user?.id || null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const bundle = await fetchInventoryBundle();
      setSettings(bundle.settings);
      setSuppliers(bundle.suppliers);
      setWarehouses(bundle.warehouses);
      setSkus(bundle.skus);
      setMovements(bundle.movements);
    } catch (err) {
      setError(err?.message || "Could not load inventory data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      }
      return created;
    },
    [userId]
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

  const value = {
    loading,
    error,
    settings,
    suppliers,
    warehouses: warehousesWithUsage,
    skus,
    fabrics,
    trims,
    apparel,
    movements,
    alerts,
    pos: POS,
    refresh,
    updateAlertSettings,
    saveSkuReorder,
    createSku,
    adjustStock,
    createSupplier,
    createWarehouse,
    canEdit: true
  };

  return <InventoryDataContext.Provider value={value}>{children}</InventoryDataContext.Provider>;
}

export function useInventory() {
  const ctx = useContext(InventoryDataContext);
  if (!ctx) throw new Error("useInventory must be used within InventoryDataProvider");
  return ctx;
}
