import { useCallback, useEffect, useState } from "react";
import { useInventory } from "./InventoryDataContext";
import InventorySubNav from "./InventorySubNav";
import AdjustStockModal from "./modals/AdjustStockModal";
import CreatePOModal from "./modals/CreatePOModal";
import NewSkuModal from "./modals/NewSkuModal";
import ImportSkusModal from "./modals/ImportSkusModal";
import NewSupplierModal from "./modals/NewSupplierModal";
import NewWarehouseModal from "./modals/NewWarehouseModal";
import SkuManagementModal from "./modals/SkuManagementModal";
import SkuDrawer from "./modals/SkuDrawer";
import InventoryAlertsPage from "./pages/InventoryAlertsPage";
import InventoryListPage from "./pages/InventoryListPage";
import InventoryMovementsPage from "./pages/InventoryMovementsPage";
import InventoryOverview from "./pages/InventoryOverview";
import InventoryPurchaseOrdersPage from "./pages/InventoryPurchaseOrdersPage";
import InventorySuppliersPage from "./pages/InventorySuppliersPage";
import InventoryWarehousesPage from "./pages/InventoryWarehousesPage";
import { findSku, formatInr } from "./inventoryUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function InventoryDashboard() {
  const { loading, error, alerts, skus, suppliers, createSku, importSkus, adjustStock, removeSku, createSupplier, createWarehouse, refresh, hydrateSkuDetail, loadMovements } = useInventory();
  const [active, setActive] = useState("overview");
  const [kind, setKind] = useState("apparel");
  const [drawerSku, setDrawerSku] = useState(null);
  const [drawerMovements, setDrawerMovements] = useState([]);
  const [drawerDetailLoading, setDrawerDetailLoading] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSku, setAdjustSku] = useState(null);
  const [poOpen, setPoOpen] = useState(false);
  const [poInitialSku, setPoInitialSku] = useState(null);
  const [newSkuOpen, setNewSkuOpen] = useState(false);
  const [importSkusOpen, setImportSkusOpen] = useState(false);
  const [newSkuKind, setNewSkuKind] = useState("fabric");
  const [newSkuInitialParent, setNewSkuInitialParent] = useState(null);
  const [skuMgmtOpen, setSkuMgmtOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [deletingSkuId, setDeletingSkuId] = useState(null);
  const [toasts, setToasts] = useState([]);

  const openSkuDrawer = useCallback(
    (sku) => {
      if (!sku) return;
      setDrawerSku(sku);
      setDrawerMovements([]);
      setDrawerDetailLoading(true);
      void hydrateSkuDetail(sku)
        .then(({ sku: detail, movements }) => {
          setDrawerSku(detail);
          setDrawerMovements(movements);
        })
        .finally(() => setDrawerDetailLoading(false));
    },
    [hydrateSkuDetail]
  );

  const closeSkuDrawer = useCallback(() => {
    setDrawerSku(null);
    setDrawerMovements([]);
    setDrawerDetailLoading(false);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeSkuDrawer();
        setAdjustOpen(false);
        setPoOpen(false);
        setNewSkuOpen(false);
        setNewSkuInitialParent(null);
        setSkuMgmtOpen(false);
        setImportSkusOpen(false);
        setSupplierOpen(false);
        setWarehouseOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSkuDrawer]);

  useEffect(() => {
    if (["fabrics", "trims", "apparel"].includes(active)) setKind(active);
  }, [active]);

  useEffect(() => {
    if (active === "movements") {
      void loadMovements({ silent: false });
    }
  }, [active, loadMovements]);

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

  const openNewSku = (k, parent = null) => {
    const map = { fabrics: "fabric", trims: "trim", apparel: "apparel" };
    setNewSkuKind(map[k] || k || "fabric");
    setNewSkuInitialParent(parent);
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
        reference: data.note || data.ref || "",
        fromWh: data.type === "OUT" ? data.wh || sku.wh : sku.wh,
        toWh: data.type === "IN" ? data.wh || sku.wh : data.type === "TRANSFER" ? data.wh || sku.wh : sku.wh
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
      `PO sent to ${sup?.name || "supplier"} · ${data.totalQty.toLocaleString()} units · ${formatInr(data.total, { maximumFractionDigits: 0 })}`
    );
  };

  const handleNewSkuSubmit = async (skuKind, record) => {
    try {
      await createSku(skuKind, record);
      setNewSkuOpen(false);
      setNewSkuInitialParent(null);
      toast(`Created ${record.id} — ${record.name}${record.color ? ` · ${record.color}` : ""}`);
      setActive(skuKind === "fabric" ? "fabrics" : skuKind === "trim" ? "trims" : "apparel");
    } catch (err) {
      toast(err?.message || "Could not create SKU.");
    }
  };

  const handleSkuMgmtCreated = (created) => {
    const tab = created.kind === "fabric" ? "fabrics" : created.kind === "trim" ? "trims" : "apparel";
    setActive(tab);
    setKind(tab);
    toast(`Added ${created.id} to inventory${created.color ? ` · ${created.color}` : ""}`);
  };

  const handleNewSupplierSubmit = async (record) => {
    try {
      await createSupplier(record);
      setSupplierOpen(false);
      toast(`Added supplier ${record.name} · ${record.id}`);
    } catch (err) {
      toast(err?.message || "Could not add supplier.");
    }
  };

  const handleNewWarehouseSubmit = async (record) => {
    try {
      await createWarehouse(record);
      setWarehouseOpen(false);
      toast(`Added warehouse ${record.name} · ${record.id}`);
    } catch (err) {
      toast(err?.message || "Could not add warehouse.");
    }
  };

  const handleImportSkus = async (records, opts) => {
    try {
      const result = await importSkus("apparel", records, opts);
      setImportSkusOpen(false);
      setActive("apparel");
      toast(`Imported ${result.imported.toLocaleString()} apparel SKUs (supplier left blank).`);
    } catch (err) {
      toast(err?.message || "Could not import SKUs.");
      throw err;
    }
  };

  const handleDeleteSku = async (sku) => {
    if (!sku?._uuid) {
      toast("SKU not found in database.");
      return;
    }
    const stockLabel =
      sku.kind === "apparel"
        ? `${(sku.totalStock ?? 0).toLocaleString()} units on hand`
        : `${(sku.stock ?? 0).toLocaleString()} ${sku.unit || "pc"} on hand`;
    const ok = window.confirm(
      `Delete ${sku.id} — ${sku.name}?\n\nUse this for discontinued or non-working SKUs. Stock history for this item will be removed.\n\n${stockLabel}\n\nThis cannot be undone.`
    );
    if (!ok) return;

    setDeletingSkuId(sku._uuid);
    try {
      await removeSku(sku._uuid);
      if (drawerSku?._uuid === sku._uuid) closeSkuDrawer();
      toast(`Deleted ${sku.id} — ${sku.name}`);
    } catch (err) {
      toast(err?.message || "Could not delete SKU.");
    } finally {
      setDeletingSkuId(null);
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
          openSku={openSkuDrawer}
          openAdjust={openAdjust}
          openCreatePO={openCreatePO}
          openNewSku={openNewSku}
          openImportSkus={() => setImportSkusOpen(true)}
          openSkuManagement={() => setSkuMgmtOpen(true)}
          onDeleteSku={handleDeleteSku}
          deletingSkuId={deletingSkuId}
        />
      );
    }

    switch (active) {
      case "overview":
        return (
          <InventoryOverview setActive={setActive} openSku={openSkuDrawer} openNewSku={openNewSku} openCreatePO={openCreatePO} />
        );
      case "alerts":
        return <InventoryAlertsPage openCreatePO={openCreatePO} openSku={openSkuDrawer} />;
      case "movements":
        return <InventoryMovementsPage openNewSku={openNewSku} />;
      case "pos":
        return <InventoryPurchaseOrdersPage openCreatePO={openCreatePO} />;
      case "suppliers":
        return <InventorySuppliersPage onAddSupplier={() => setSupplierOpen(true)} />;
      case "warehouses":
        return <InventoryWarehousesPage onAddWarehouse={() => setWarehouseOpen(true)} />;
      default:
        return <InventoryOverview setActive={setActive} openSku={setDrawerSku} openNewSku={openNewSku} openCreatePO={openCreatePO} />;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[480px] flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-start gap-4 p-6">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card shadow-sm">
      <InventorySubNav active={active} onNavigate={setActive} alertCount={alerts.length} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{renderPage()}</div>
      </div>
    </div>

      <SkuDrawer
        sku={drawerSku}
        movements={drawerMovements}
        detailLoading={drawerDetailLoading}
        onClose={closeSkuDrawer}
        onAdjust={(s) => {
          closeSkuDrawer();
          openAdjust(s);
        }}
        onReorder={(s) => {
          closeSkuDrawer();
          openCreatePO(s);
        }}
        onDelete={handleDeleteSku}
        deleting={deletingSkuId === drawerSku?._uuid}
      />

      {adjustOpen && <AdjustStockModal sku={adjustSku} onClose={() => setAdjustOpen(false)} onSubmit={handleAdjustSubmit} />}

      {poOpen && <CreatePOModal initialSku={poInitialSku} onClose={() => setPoOpen(false)} onSubmit={handlePOSubmit} />}

      {newSkuOpen && (
        <NewSkuModal
          initialKind={newSkuKind}
          initialParent={newSkuInitialParent}
          onClose={() => {
            setNewSkuOpen(false);
            setNewSkuInitialParent(null);
          }}
          onSubmit={handleNewSkuSubmit}
        />
      )}

      {skuMgmtOpen && (
        <SkuManagementModal
          tabKind={kind}
          onClose={() => setSkuMgmtOpen(false)}
          onSkuCreated={handleSkuMgmtCreated}
          openSku={(sku) => {
            setSkuMgmtOpen(false);
            openSkuDrawer(sku);
          }}
        />
      )}

      {importSkusOpen && (
        <ImportSkusModal
          onClose={() => setImportSkusOpen(false)}
          onImport={handleImportSkus}
          existingSkuCodes={skus.map((s) => s.id)}
        />
      )}

      {supplierOpen && (
        <NewSupplierModal onClose={() => setSupplierOpen(false)} onSubmit={handleNewSupplierSubmit} />
      )}

      {warehouseOpen && (
        <NewWarehouseModal onClose={() => setWarehouseOpen(false)} onSubmit={handleNewWarehouseSubmit} />
      )}

      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg",
              "animate-in slide-in-from-bottom-2 fade-in duration-300"
            )}
          >
            <span className="shrink-0 font-medium text-emerald-600" aria-hidden>✓</span>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
