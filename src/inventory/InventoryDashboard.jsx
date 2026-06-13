import { useCallback, useEffect, useState } from "react";
import InventoryIcon from "./InventoryIcon";
import { useInventory } from "./InventoryDataContext";
import InventorySubNav from "./InventorySubNav";
import AdjustStockModal from "./modals/AdjustStockModal";
import CreatePOModal from "./modals/CreatePOModal";
import NewSkuModal from "./modals/NewSkuModal";
import SkuDrawer from "./modals/SkuDrawer";
import InventoryAlertsPage from "./pages/InventoryAlertsPage";
import InventoryListPage from "./pages/InventoryListPage";
import InventoryMovementsPage from "./pages/InventoryMovementsPage";
import InventoryOverview from "./pages/InventoryOverview";
import InventoryPurchaseOrdersPage from "./pages/InventoryPurchaseOrdersPage";
import InventorySuppliersPage from "./pages/InventorySuppliersPage";
import InventoryWarehousesPage from "./pages/InventoryWarehousesPage";
import { findSku } from "./inventoryUtils";

export default function InventoryDashboard() {
  const { loading, error, alerts, skus, suppliers, createSku, adjustStock, refresh } = useInventory();
  const [active, setActive] = useState("overview");
  const [kind, setKind] = useState("fabrics");
  const [drawerSku, setDrawerSku] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSku, setAdjustSku] = useState(null);
  const [poOpen, setPoOpen] = useState(false);
  const [poInitialSku, setPoInitialSku] = useState(null);
  const [newSkuOpen, setNewSkuOpen] = useState(false);
  const [newSkuKind, setNewSkuKind] = useState("fabric");
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDrawerSku(null);
        setAdjustOpen(false);
        setPoOpen(false);
        setNewSkuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (["fabrics", "trims", "apparel"].includes(active)) setKind(active);
  }, [active]);

  const toast = useCallback((msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const openCreatePO = (sku) => {
    setPoInitialSku(sku || null);
    setPoOpen(true);
  };

  const openAdjust = (sku) => {
    setAdjustSku(sku || null);
    setAdjustOpen(true);
  };

  const openNewSku = (k) => {
    const map = { fabrics: "fabric", trims: "trim", apparel: "apparel" };
    setNewSkuKind(map[k] || k || "fabric");
    setNewSkuOpen(true);
  };

  const handleAdjustSubmit = async (data) => {
    const sku = findSku(data.skuId, skus);
    if (!sku?._uuid) {
      toast("SKU not found in database.");
      setAdjustOpen(false);
      return;
    }
    try {
      await adjustStock({
        skuUuid: sku._uuid,
        type: data.type,
        qty: data.qty,
        reason: data.reason || "",
        reference: data.ref || "",
        fromWh: data.fromWh || sku.wh,
        toWh: data.toWh || sku.wh
      });
      setAdjustOpen(false);
      toast(
        `${data.type === "IN" ? "+" : data.type === "OUT" ? "−" : "·"} ${Math.abs(data.qty).toLocaleString()} ${sku?.unit || "pc"} — ${sku?.name || data.skuId} recorded`
      );
    } catch (err) {
      toast(err?.message || "Could not adjust stock.");
    }
  };

  const handlePOSubmit = (data) => {
    const sup = suppliers.find((s) => s.id === data.supplier);
    setPoOpen(false);
    toast(
      `PO sent to ${sup?.name || "supplier"} · ${data.totalQty.toLocaleString()} units · $${data.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    );
  };

  const handleNewSkuSubmit = async (skuKind, record) => {
    try {
      await createSku(skuKind, record);
      setNewSkuOpen(false);
      toast(`Created ${record.id} — ${record.name}${record.color ? ` · ${record.color}` : ""}`);
      setActive(skuKind === "fabric" ? "fabrics" : skuKind === "trim" ? "trims" : "apparel");
    } catch (err) {
      toast(err?.message || "Could not create SKU.");
    }
  };

  const renderPage = () => {
    if (["fabrics", "trims", "apparel"].includes(active)) {
      return (
        <InventoryListPage
          kind={kind}
          setKind={(k) => {
            setKind(k);
            setActive(k);
          }}
          openSku={setDrawerSku}
          openAdjust={openAdjust}
          openCreatePO={openCreatePO}
          openNewSku={openNewSku}
        />
      );
    }

    switch (active) {
      case "overview":
        return (
          <InventoryOverview setActive={setActive} openSku={setDrawerSku} openNewSku={openNewSku} openCreatePO={openCreatePO} />
        );
      case "alerts":
        return <InventoryAlertsPage openCreatePO={openCreatePO} openSku={setDrawerSku} />;
      case "movements":
        return <InventoryMovementsPage openNewSku={openNewSku} />;
      case "pos":
        return <InventoryPurchaseOrdersPage openCreatePO={openCreatePO} />;
      case "suppliers":
        return <InventorySuppliersPage />;
      case "warehouses":
        return <InventoryWarehousesPage />;
      default:
        return <InventoryOverview setActive={setActive} openSku={setDrawerSku} openNewSku={openNewSku} openCreatePO={openCreatePO} />;
    }
  };

  if (loading) {
    return (
      <div className="inventory-dashboard">
        <div className="inv-loading-state">Loading inventory…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="inventory-dashboard">
        <div className="inv-error-state">
          <p>{error}</p>
          <button type="button" className="btn primary" onClick={refresh}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inventory-dashboard">
      <div className="inventory-dashboard-layout">
        <InventorySubNav active={active} onNavigate={setActive} alertCount={alerts.length} />
        <div className="inventory-dashboard-main">{renderPage()}</div>
      </div>

      <SkuDrawer
        sku={drawerSku}
        onClose={() => setDrawerSku(null)}
        onAdjust={(s) => {
          setDrawerSku(null);
          openAdjust(s);
        }}
        onReorder={(s) => {
          setDrawerSku(null);
          openCreatePO(s);
        }}
      />

      {adjustOpen && <AdjustStockModal sku={adjustSku} onClose={() => setAdjustOpen(false)} onSubmit={handleAdjustSubmit} />}

      {poOpen && <CreatePOModal initialSku={poInitialSku} onClose={() => setPoOpen(false)} onSubmit={handlePOSubmit} />}

      {newSkuOpen && (
        <NewSkuModal initialKind={newSkuKind} onClose={() => setNewSkuOpen(false)} onSubmit={handleNewSkuSubmit} />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <InventoryIcon name="check" size={14} stroke={2} />
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
