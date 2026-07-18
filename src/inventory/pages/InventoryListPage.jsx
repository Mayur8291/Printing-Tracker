import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import SizeDots from "../components/SizeDots";
import ColorSwatch from "../components/ColorSwatch";
import SkuMetricInput from "../components/SkuMetricInput";
import { useInventory } from "../InventoryDataContext";
import { ExpandToggle, PageHeader, SortIndicator, StockStatusBadge } from "../inventoryUiUtils";
import { formatInr, statusOf } from "../inventoryUtils";
import { apparelMatchesQuery, buildApparelTopLevelEntries, groupSkusByParent, mergeEmptyStyleParents, skuMatchesQuery } from "../inventorySkuGrouping";
import { exportSkusCsv, exportSkuFilename } from "../inventorySkuExportUtils";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "../../orderPagination";

const INV_HEAD = "h-11 whitespace-nowrap px-4 text-xs font-medium text-muted-foreground";
const INV_CELL = "px-4 py-3 align-middle";
const INV_METRIC_CELL = "min-w-[6.5rem] px-4 py-3 text-right align-middle";
const INV_ACTIONS_CELL = "min-w-[9rem] px-4 py-3 text-right align-middle";

/** Reserved/available from facility stock; falls back to stock_qty when the map is missing an SKU. */
function availabilityOf(r, availabilityBySku) {
  const base = Number(r.stock ?? r.totalStock ?? 0);
  const entry = availabilityBySku?.[r.id];
  if (!entry) return { reserved: 0, available: base };
  return { reserved: entry.reserved, available: entry.available };
}

/** Row shim so status/low-stock checks compare reorder point against available, not stock_qty. */
function withAvailableStock(r, availabilityBySku) {
  const { available } = availabilityOf(r, availabilityBySku);
  return r.totalStock !== undefined ? { ...r, totalStock: available, stock: available } : { ...r, stock: available };
}

function ReservedQty({ reserved }) {
  if (!(reserved > 0)) return <span className="text-muted-foreground">0</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default font-medium text-amber-600">{reserved.toLocaleString()}</span>
      </TooltipTrigger>
      <TooltipContent>Held for open orders — not available to sell</TooltipContent>
    </Tooltip>
  );
}

function StockBar({ pct, kind }) {
  return (
    <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          kind === "danger" ? "bg-red-500" : kind === "warning" ? "bg-amber-500" : "bg-emerald-500"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function FabricTrimTable({ kind, rows, selected, toggleSel, openSku, openAdjust, onDelete, deletingSkuId, Th, suppliers, settings, availabilityBySku }) {
  const supplierOf = (id) => suppliers.find((s) => s.id === id);

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead className={cn(INV_HEAD, "w-12")}>
            <Checkbox aria-label="select all" />
          </TableHead>
          <Th col="id">SKU</Th>
          <Th col="name">{kind === "fabrics" ? "Fabric" : "Trim"}</Th>
          {kind === "fabrics" ? (
            <>
              <Th col="gsm" right>
                GSM
              </Th>
              <Th col="width" right>
                Width (cm)
              </Th>
            </>
          ) : (
            <Th col="type">Type / Size</Th>
          )}
          <Th col="color">Color</Th>
          <Th col="stock" right>
            On hand
          </Th>
          <Th col="reserved" right>
            Reserved
          </Th>
          <Th col="available" right>
            Available
          </Th>
          <TableHead className={INV_HEAD}>Stock level</TableHead>
          <Th col="cost" right>
            Unit cost
          </Th>
          <Th col="retail" right>
            Sale price
          </Th>
          <Th col="reorder" right>
            Reorder
          </Th>
          <Th col="doc" right>
            DOC
          </Th>
          <Th col="drr" right>
            DRR
          </Th>
          <Th col="value" right>
            Value
          </Th>
          <TableHead className={INV_HEAD}>Warehouse</TableHead>
          <TableHead className={INV_HEAD}>Supplier</TableHead>
          <TableHead className={cn(INV_HEAD, INV_ACTIONS_CELL)} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const avail = availabilityOf(r, availabilityBySku);
          const st = statusOf(withAvailableStock(r, availabilityBySku), settings);
          const pct = Math.min(100, Math.round((avail.available / Math.max(r.reorder * 2, 1)) * 100));
          return (
            <TableRow key={r.id} onClick={() => openSku(r)} className={cn("cursor-pointer", selected.has(r.id) && "bg-muted/50")}>
              <TableCell className={cn(INV_CELL, "w-12")} onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSel(r.id)} />
              </TableCell>
              <TableCell className={cn(INV_CELL, "font-mono text-xs")}>{r.id}</TableCell>
              <TableCell className={cn(INV_CELL, "min-w-[12rem]")}>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.composition || r.size}</div>
              </TableCell>
              {kind === "fabrics" ? (
                <>
                  <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>{r.gsm}</TableCell>
                  <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>{r.width}</TableCell>
                </>
              ) : (
                <TableCell className={INV_CELL}>
                  {r.type} · {r.size}
                </TableCell>
              )}
              <TableCell className={cn(INV_CELL, "min-w-[8rem]")}>
                <span className="inline-flex items-center gap-2">
                  <ColorSwatch color={r.color} hex={r.hex} />
                  {r.color}
                </span>
              </TableCell>
              <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
                <strong>{r.stock.toLocaleString()}</strong>{" "}
                <span className="text-muted-foreground">{r.unit}</span>
              </TableCell>
              <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
                <ReservedQty reserved={avail.reserved} />
              </TableCell>
              <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
                <strong>{avail.available.toLocaleString()}</strong>
              </TableCell>
              <TableCell className={cn(INV_CELL, "min-w-[8rem]")}>
                <StockBar pct={pct} kind={st.kind} />
                <StockStatusBadge status={st} />
              </TableCell>
              <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
                {formatInr(r.cost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
                {formatInr(r.retail, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className={INV_METRIC_CELL}>
                <SkuMetricInput sku={r} field="reorder" value={r.reorder} />
              </TableCell>
              <TableCell className={INV_METRIC_CELL}>
                <SkuMetricInput sku={r} field="doc" value={r.doc} step="0.01" />
              </TableCell>
              <TableCell className={INV_METRIC_CELL}>
                <SkuMetricInput sku={r} field="drr" value={r.drr} step="0.01" />
              </TableCell>
              <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
                {formatInr(r.stock * r.cost, { maximumFractionDigits: 0 })}
              </TableCell>
              <TableCell className={cn(INV_CELL, "font-mono text-xs")}>
                {r.wh} <span className="text-muted-foreground">· {r.bin}</span>
              </TableCell>
              <TableCell className={INV_CELL}>{supplierOf(r.supplier)?.name || "—"}</TableCell>
              <TableCell className={INV_ACTIONS_CELL} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => openAdjust(r)} title="Adjust stock">
                    Adjust
                  </Button>
                  {onDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(r)}
                      disabled={deletingSkuId === r._uuid}
                      title="Delete discontinued SKU"
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ApparelSkuRow({ r, selected, toggleSel, openSku, openAdjust, onDelete, deletingSkuId, settings, availabilityBySku, indent }) {
  const avail = availabilityOf(r, availabilityBySku);
  const st = statusOf(withAvailableStock(r, availabilityBySku), settings);
  return (
    <TableRow key={r.id} onClick={() => openSku(r)} className={cn("cursor-pointer", selected.has(r.id) && "bg-muted/50")}>
      <TableCell className={cn(INV_CELL, "w-12")} onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSel(r.id)} />
      </TableCell>
      <TableCell className={cn(INV_CELL, "font-mono text-xs", indent && "pl-10")}>{r.id}</TableCell>
      <TableCell className={cn(INV_CELL, "min-w-[12rem] font-medium", indent && "pl-6")}>
        {indent ? r.color || r.name : r.name}
      </TableCell>
      <TableCell className={INV_CELL}>
        <Badge variant="secondary">{r.category}</Badge>
      </TableCell>
      <TableCell className={INV_CELL}>{r.season}</TableCell>
      <TableCell className={cn(INV_CELL, "min-w-[8rem]")}>
        <span className="inline-flex items-center gap-2">
          <ColorSwatch color={r.color} hex={r.hex} />
          {r.color}
        </span>
      </TableCell>
      <TableCell className={INV_CELL}>
        <SizeDots sizes={r.sizes} />
      </TableCell>
      <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
        <strong>{r.totalStock.toLocaleString()}</strong>
      </TableCell>
      <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
        <ReservedQty reserved={avail.reserved} />
      </TableCell>
      <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
        <strong>{avail.available.toLocaleString()}</strong>
      </TableCell>
      <TableCell className={INV_CELL}>
        <StockStatusBadge status={st} />
      </TableCell>
      <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
        {formatInr(r.cost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
        {formatInr(r.retail, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className={INV_METRIC_CELL}>
        <SkuMetricInput sku={r} field="reorder" value={r.reorder} />
      </TableCell>
      <TableCell className={INV_METRIC_CELL}>
        <SkuMetricInput sku={r} field="doc" value={r.doc} step="0.01" />
      </TableCell>
      <TableCell className={INV_METRIC_CELL}>
        <SkuMetricInput sku={r} field="drr" value={r.drr} step="0.01" />
      </TableCell>
      <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
        {formatInr(r.totalStock * r.cost, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className={INV_ACTIONS_CELL} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => openAdjust(r)} title="Adjust stock">
            Adjust
          </Button>
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(r)}
              disabled={deletingSkuId === r._uuid}
              title="Delete discontinued SKU"
            >
              Delete
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ApparelTable({
  rows,
  visibleGroups: visibleGroupsProp,
  visibleStandalone: visibleStandaloneProp,
  selected,
  toggleSel,
  openSku,
  openAdjust,
  onDelete,
  deletingSkuId,
  Th,
  settings,
  query,
  supplierOf,
  styleParents,
  availabilityBySku
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const { visibleGroups, visibleStandalone } = useMemo(() => {
    if (visibleGroupsProp != null && visibleStandaloneProp != null) {
      return { visibleGroups: visibleGroupsProp, visibleStandalone: visibleStandaloneProp };
    }
    const { groups, standalone } = groupSkusByParent(rows);
    const allGroups = mergeEmptyStyleParents(groups, styleParents, "apparel");
    const visibleGroupsInner = allGroups.filter((g) => apparelMatchesQuery(g, query, supplierOf));
    const visibleStandaloneInner = !query
      ? standalone
      : standalone.filter((r) => skuMatchesQuery(r, String(query).toLowerCase(), supplierOf));
    return { visibleGroups: visibleGroupsInner, visibleStandalone: visibleStandaloneInner };
  }, [visibleGroupsProp, visibleStandaloneProp, rows, styleParents, query, supplierOf]);

  const toggleGroup = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isExpanded = (id) => query.length > 0 || !collapsed.has(id);

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead className={cn(INV_HEAD, "w-12")}>
            <Checkbox aria-label="select all" />
          </TableHead>
          <Th col="id">SKU</Th>
          <Th col="name">Style / variant</Th>
          <Th col="category">Category</Th>
          <Th col="season">Season</Th>
          <Th col="color">Colorway</Th>
          <TableHead className={INV_HEAD}>Size distribution</TableHead>
          <Th col="stock" right>
            Total units
          </Th>
          <Th col="reserved" right>
            Reserved
          </Th>
          <Th col="available" right>
            Available
          </Th>
          <TableHead className={INV_HEAD}>Status</TableHead>
          <Th col="cost" right>
            Unit cost
          </Th>
          <Th col="retail" right>
            Sale price
          </Th>
          <Th col="reorder" right>
            Reorder
          </Th>
          <Th col="doc" right>
            DOC
          </Th>
          <Th col="drr" right>
            DRR
          </Th>
          <Th col="value" right>
            Inventory value
          </Th>
          <TableHead className={cn(INV_HEAD, INV_ACTIONS_CELL)} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {visibleGroups.map((group) => {
          const open = isExpanded(group.id);
          const groupAvail = group.children.reduce(
            (acc, child) => {
              const a = availabilityOf(child, availabilityBySku);
              return { reserved: acc.reserved + a.reserved, available: acc.available + a.available };
            },
            { reserved: 0, available: 0 }
          );
          return (
            <Fragment key={`group-${group.id}`}>
              <TableRow className="bg-muted/30 hover:bg-muted/50">
                <TableCell className={INV_CELL} onClick={(e) => e.stopPropagation()} />
                <TableCell className={cn(INV_CELL, "min-w-[16rem]")} colSpan={2}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left font-medium"
                    onClick={() => toggleGroup(group.id)}
                  >
                    {open ? <ExpandToggle open /> : <ExpandToggle open={false} />}
                    <span className="font-mono text-xs text-muted-foreground">{group.parentSkuCode}</span>
                    <span>{group.styleName}</span>
                    <Badge variant="outline" className="ml-1 font-normal">
                      {group.variantCount} variant{group.variantCount === 1 ? "" : "s"}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell className={INV_CELL} colSpan={4} />
                <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
                  <strong>{group.totalStock.toLocaleString()}</strong>
                </TableCell>
                <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
                  <ReservedQty reserved={groupAvail.reserved} />
                </TableCell>
                <TableCell className={cn(INV_CELL, "text-right tabular-nums")}>
                  <strong>{groupAvail.available.toLocaleString()}</strong>
                </TableCell>
                <TableCell className={INV_CELL} />
                <TableCell className={INV_CELL} colSpan={5} />
                <TableCell className={cn(INV_CELL, "text-right tabular-nums whitespace-nowrap")}>
                  {formatInr(group.totalValue, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className={INV_CELL} />
              </TableRow>
              {open
                ? group.children.map((r) => (
                    <ApparelSkuRow
                      key={r.id}
                      r={r}
                      selected={selected}
                      toggleSel={toggleSel}
                      openSku={openSku}
                      openAdjust={openAdjust}
                      onDelete={onDelete}
                      deletingSkuId={deletingSkuId}
                      settings={settings}
                      availabilityBySku={availabilityBySku}
                      indent
                    />
                  ))
                : null}
            </Fragment>
          );
        })}
        {visibleStandalone.map((r) => (
          <ApparelSkuRow
            key={r.id}
            r={r}
            selected={selected}
            toggleSel={toggleSel}
            openSku={openSku}
            openAdjust={openAdjust}
            onDelete={onDelete}
            deletingSkuId={deletingSkuId}
            settings={settings}
            availabilityBySku={availabilityBySku}
          />
        ))}
      </TableBody>
    </Table>
  );
}

export default function InventoryListPage({
  kind,
  setKind,
  openSku,
  openAdjust,
  openCreatePO,
  openNewSku,
  openImportSkus,
  openSkuManagement,
  onDeleteSku,
  deletingSkuId
}) {
  const { fabrics, trims, apparel, suppliers, warehouses, settings, styleParents, availabilityBySku } = useInventory();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState("asc");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(() => new Set());

  const rows = kind === "fabrics" ? fabrics : kind === "trims" ? trims : apparel;
  const supplierOf = (id) => suppliers.find((s) => s.id === id);

  const filtered = rows.filter((r) => {
    if (warehouseFilter !== "all" && r.wh !== warehouseFilter) return false;
    const st = statusOf(withAvailableStock(r, availabilityBySku), settings);
    if (statusFilter !== "all" && st.kind !== statusFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.id.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.color || "").toLowerCase().includes(q) ||
      (r.composition || r.type || r.category || "").toLowerCase().includes(q) ||
      (supplierOf(r.supplier)?.name || "").toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let va;
    let vb;
    if (sortBy === "stock") {
      va = a.stock ?? a.totalStock;
      vb = b.stock ?? b.totalStock;
    } else if (sortBy === "reserved") {
      va = availabilityOf(a, availabilityBySku).reserved;
      vb = availabilityOf(b, availabilityBySku).reserved;
    } else if (sortBy === "available") {
      va = availabilityOf(a, availabilityBySku).available;
      vb = availabilityOf(b, availabilityBySku).available;
    } else if (sortBy === "value") {
      va = (a.stock ?? a.totalStock) * a.cost;
      vb = (b.stock ?? b.totalStock) * b.cost;
    } else {
      va = a[sortBy];
      vb = b[sortBy];
    }
    if (va == null) va = "";
    if (vb == null) vb = "";
    if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const Th = ({ col, children, right }) => (
    <TableHead
      className={cn(
        INV_HEAD,
        "cursor-pointer select-none",
        right && "text-right",
        sortBy === col && "text-foreground"
      )}
      onClick={() => toggleSort(col)}
    >
      {children}
      <SortIndicator col={col} sortBy={sortBy} sortDir={sortDir} />
    </TableHead>
  );

  const toggleSel = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function handleExportSkus() {
    const exportRows =
      selected.size > 0 ? sorted.filter((r) => selected.has(r.id)) : sorted;
    exportSkusCsv({
      skus: exportRows,
      suppliers,
      warehouses,
      filename: exportSkuFilename(kind)
    });
  }

  const paginationResetKey = `${kind}|${query}|${warehouseFilter}|${statusFilter}|${sortBy}|${sortDir}`;

  const apparelTopLevel = useMemo(() => {
    if (kind !== "apparel") return [];
    return buildApparelTopLevelEntries(sorted, styleParents, query, supplierOf);
  }, [kind, sorted, styleParents, query, supplierOf]);

  const paginationSource = kind === "apparel" ? apparelTopLevel : sorted;

  const {
    visible: pageItems,
    total: paginationTotal,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(paginationSource, `inventory-${kind}`, paginationResetKey, 25);

  const paginatedApparel = useMemo(() => {
    if (kind !== "apparel") return { visibleGroups: [], visibleStandalone: [] };
    const visibleGroups = pageItems.filter((e) => e.kind === "group").map((e) => e.group);
    const visibleStandalone = pageItems.filter((e) => e.kind === "standalone").map((e) => e.sku);
    return { visibleGroups, visibleStandalone };
  }, [kind, pageItems]);

  const paginatedFabricTrimRows = kind === "apparel" ? [] : pageItems;

  const tabs = [
    { id: "apparel", label: "Apparel", count: apparel.length },
    { id: "fabrics", label: "Fabrics", count: fabrics.length },
    { id: "trims", label: "Trims", count: trims.length }
  ];

  const statusLabels = { success: "In stock", warning: "Low", danger: "Critical" };

  const cycleWarehouse = () => {
    const opts = ["all", ...warehouses.map((w) => w.id)];
    const idx = opts.indexOf(warehouseFilter);
    setWarehouseFilter(opts[(idx + 1) % opts.length]);
  };

  const cycleStatus = () => {
    const opts = ["all", "success", "warning", "danger"];
    const idx = opts.indexOf(statusFilter);
    setStatusFilter(opts[(idx + 1) % opts.length]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="All raw materials and finished goods, real-time across warehouses."
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => openAdjust(null)}>
              Adjust stock
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openCreatePO()}>
              Create PO
            </Button>
            {kind === "apparel" && openImportSkus ? (
              <Button type="button" variant="outline" size="sm" onClick={openImportSkus}>
                Import SKUs
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => openNewSku(kind)}>
              New {kind === "apparel" ? "style" : kind === "trims" ? "trim" : "fabric"}
            </Button>
          </>
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col border shadow-sm">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="flex shrink-0 flex-col gap-4 border-b bg-muted/30 p-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6 lg:gap-y-3">
            <Tabs value={kind} onValueChange={setKind} className="shrink-0">
              <TabsList>
                {tabs.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
                    {t.label}
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                      {t.count}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="relative w-full lg:w-60 lg:shrink-0">
              <Input placeholder={`Search ${kind}…`} value={query} onChange={(e) => setQuery(e.target.value)} className="h-9" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={warehouseFilter !== "all" ? "secondary" : "outline"}
                size="sm"
                onClick={cycleWarehouse}
                title="Click to cycle warehouses"
              >
                Warehouse
                {warehouseFilter !== "all" && (
                  <Badge variant="outline" className="ml-2 font-normal">
                    {warehouses.find((w) => w.id === warehouseFilter)?.name}
                  </Badge>
                )}
              </Button>

              <Button
                type="button"
                variant={statusFilter !== "all" ? "secondary" : "outline"}
                size="sm"
                onClick={cycleStatus}
                title="Click to cycle status"
              >
                Status
                {statusFilter !== "all" && (
                  <Badge variant="outline" className="ml-2 font-normal">
                    {statusLabels[statusFilter]}
                  </Badge>
                )}
              </Button>

              {(warehouseFilter !== "all" || statusFilter !== "all" || query) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setWarehouseFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3 lg:ml-auto">
              <span className="text-xs text-muted-foreground">
                {sorted.length.toLocaleString()} of {rows.length.toLocaleString()}
                {selected.size > 0 && ` · ${selected.size} selected`}
              </span>
              {openSkuManagement ? (
                <Button type="button" variant="outline" size="sm" onClick={openSkuManagement}>
                  SKU management
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={handleExportSkus}>
                Export
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="min-w-[72rem] overflow-hidden rounded-md border">
              {kind === "apparel" ? (
                <ApparelTable
                  rows={sorted}
                  visibleGroups={paginatedApparel.visibleGroups}
                  visibleStandalone={paginatedApparel.visibleStandalone}
                  selected={selected}
                  toggleSel={toggleSel}
                  openSku={openSku}
                  openAdjust={openAdjust}
                  onDelete={onDeleteSku}
                  deletingSkuId={deletingSkuId}
                  Th={Th}
                  settings={settings}
                  query={query}
                  supplierOf={supplierOf}
                  styleParents={styleParents}
                  availabilityBySku={availabilityBySku}
                />
              ) : (
                <FabricTrimTable
                  kind={kind}
                  rows={paginatedFabricTrimRows}
                  selected={selected}
                  toggleSel={toggleSel}
                  openSku={openSku}
                  openAdjust={openAdjust}
                  onDelete={onDeleteSku}
                  deletingSkuId={deletingSkuId}
                  Th={Th}
                  suppliers={suppliers}
                  settings={settings}
                  availabilityBySku={availabilityBySku}
                />
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <OrdersPerPageControl
              idPrefix={`inventory-${kind}-per-page`}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
            <OrdersPagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={paginationTotal}
              pageSize={pageSize}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
