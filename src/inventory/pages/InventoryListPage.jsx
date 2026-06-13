import { useState } from "react";
import SizeDots from "../components/SizeDots";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";
import { statusOf } from "../inventoryUtils";

function SortIcon({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <InventoryIcon name="chev_ud" size={10} stroke={1.8} className="sort-ind" />;
  return (
    <InventoryIcon name={sortDir === "asc" ? "chev_u" : "chev_d"} size={10} stroke={1.8} className="sort-ind" />
  );
}

function FabricTrimTable({ kind, rows, selected, toggleSel, openSku, openAdjust, Th, suppliers, settings }) {
  const supplierOf = (id) => suppliers.find((s) => s.id === id);

  return (
    <table className="t">
      <thead>
        <tr>
          <th className="col-checkbox">
            <input type="checkbox" aria-label="select all" />
          </th>
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
          <th>Stock level</th>
          <Th col="cost" right>
            Unit cost
          </Th>
          <Th col="value" right>
            Value
          </Th>
          <th>Warehouse</th>
          <th>Supplier</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const st = statusOf(r, settings);
          const pct = Math.min(100, Math.round((r.stock / Math.max(r.reorder * 2, 1)) * 100));
          const barCls = st.kind === "danger" ? "danger" : st.kind === "warning" ? "warn" : "";
          return (
            <tr key={r.id} onClick={() => openSku(r)} className={selected.has(r.id) ? "selected" : ""}>
              <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} />
              </td>
              <td className="mono">{r.id}</td>
              <td>
                <div className="cell-name">
                  <strong>{r.name}</strong>
                  <small>{r.composition || r.size}</small>
                </div>
              </td>
              {kind === "fabrics" ? (
                <>
                  <td className="num">{r.gsm}</td>
                  <td className="num">{r.width}</td>
                </>
              ) : (
                <td>
                  {r.type} · {r.size}
                </td>
              )}
              <td>
                <span className="cell-with-swatch">
                  <span className="swatch" style={{ background: r.hex }} />
                  {r.color}
                </span>
              </td>
              <td className="num">
                <b>{r.stock.toLocaleString()}</b> <span style={{ color: "var(--text-faint)" }}>{r.unit}</span>
              </td>
              <td>
                <span className={`stock-bar ${barCls}`}>
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className={`badge ${st.kind}`} style={{ verticalAlign: "middle" }}>
                  <span className="dot" />
                  {st.label}
                </span>
              </td>
              <td className="num">${r.cost.toFixed(2)}</td>
              <td className="num">${(r.stock * r.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td className="mono" style={{ fontSize: 11.5 }}>
                {r.wh} <span style={{ color: "var(--text-faint)" }}>· {r.bin}</span>
              </td>
              <td>{supplierOf(r.supplier)?.name}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <button type="button" className="icon-btn" onClick={() => openAdjust(r)} title="Adjust stock">
                  <InventoryIcon name="edit" size={13} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ApparelTable({ rows, selected, toggleSel, openSku, openAdjust, Th, settings }) {
  return (
    <table className="t">
      <thead>
        <tr>
          <th className="col-checkbox">
            <input type="checkbox" aria-label="select all" />
          </th>
          <Th col="id">SKU</Th>
          <Th col="name">Style</Th>
          <Th col="category">Category</Th>
          <Th col="season">Season</Th>
          <Th col="color">Colorway</Th>
          <th>Size distribution</th>
          <Th col="stock" right>
            Total units
          </Th>
          <th>Status</th>
          <Th col="cost" right>
            Unit cost
          </Th>
          <Th col="retail" right>
            Retail
          </Th>
          <Th col="value" right>
            Inventory value
          </Th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const st = statusOf(r, settings);
          return (
            <tr key={r.id} onClick={() => openSku(r)} className={selected.has(r.id) ? "selected" : ""}>
              <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} />
              </td>
              <td className="mono">{r.id}</td>
              <td>
                <strong>{r.name}</strong>
              </td>
              <td>
                <span className="badge neutral">{r.category}</span>
              </td>
              <td>{r.season}</td>
              <td>
                <span className="cell-with-swatch">
                  <span className="swatch" style={{ background: r.hex }} />
                  {r.color}
                </span>
              </td>
              <td>
                <SizeDots sizes={r.sizes} />
              </td>
              <td className="num">
                <b>{r.totalStock.toLocaleString()}</b>
              </td>
              <td>
                <span className={`badge ${st.kind}`}>
                  <span className="dot" />
                  {st.label}
                </span>
              </td>
              <td className="num">${r.cost.toFixed(2)}</td>
              <td className="num">${r.retail}</td>
              <td className="num">${(r.totalStock * r.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <button type="button" className="icon-btn" onClick={() => openAdjust(r)} title="Adjust stock">
                  <InventoryIcon name="edit" size={13} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function InventoryListPage({ kind, setKind, openSku, openAdjust, openCreatePO, openNewSku }) {
  const { fabrics, trims, apparel, suppliers, warehouses, settings } = useInventory();
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
    const st = statusOf(r, settings);
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

  const Th = ({ col, children, right, w }) => (
    <th
      className={`sortable${sortBy === col ? " sorted" : ""}${right ? " right" : ""}`}
      onClick={() => toggleSort(col)}
      style={w ? { width: w } : null}
    >
      {children}
      <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
    </th>
  );

  const toggleSel = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tabs = [
    { id: "fabrics", label: "Fabrics", count: fabrics.length },
    { id: "trims", label: "Trims", count: trims.length },
    { id: "apparel", label: "Apparel", count: apparel.length }
  ];

  const statusLabels = { success: "In stock", warning: "Low", danger: "Critical" };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">All raw materials and finished goods, real-time across warehouses.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => openAdjust(null)}>
            <InventoryIcon name="edit" size={13} /> Adjust stock
          </button>
          <button type="button" className="btn" onClick={() => openCreatePO()}>
            <InventoryIcon name="cart" size={13} /> Create PO
          </button>
          <button type="button" className="btn primary" onClick={() => openNewSku(kind)}>
            <InventoryIcon name="plus" size={13} /> New {kind === "apparel" ? "style" : kind === "trims" ? "trim" : "fabric"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div className="table-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`table-tab${kind === t.id ? " active" : ""}`}
                onClick={() => setKind(t.id)}
              >
                {t.label}
                <span className="tab-count">{t.count}</span>
              </button>
            ))}
          </div>

          <div className="search-input">
            <InventoryIcon name="search" size={12} stroke={1.8} />
            <input placeholder={`Search ${kind}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <button
            type="button"
            className={`filter-chip${warehouseFilter !== "all" ? " active" : ""}`}
            onClick={() => {
              const opts = ["all", ...warehouses.map((w) => w.id)];
              const idx = opts.indexOf(warehouseFilter);
              setWarehouseFilter(opts[(idx + 1) % opts.length]);
            }}
            title="Click to cycle warehouses"
          >
            <InventoryIcon name="building" size={11} />
            Warehouse
            {warehouseFilter !== "all" && (
              <span className="chip-value">{warehouses.find((w) => w.id === warehouseFilter)?.name}</span>
            )}
          </button>

          <button
            type="button"
            className={`filter-chip${statusFilter !== "all" ? " active" : ""}`}
            onClick={() => {
              const opts = ["all", "success", "warning", "danger"];
              const idx = opts.indexOf(statusFilter);
              setStatusFilter(opts[(idx + 1) % opts.length]);
            }}
            title="Click to cycle status"
          >
            <InventoryIcon name="filter" size={11} />
            Status
            {statusFilter !== "all" && <span className="chip-value">{statusLabels[statusFilter]}</span>}
          </button>

          {(warehouseFilter !== "all" || statusFilter !== "all" || query) && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setQuery("");
                setWarehouseFilter("all");
                setStatusFilter("all");
              }}
            >
              Clear
            </button>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()}
              {selected.size > 0 && ` · ${selected.size} selected`}
            </span>
            <button type="button" className="btn ghost sm">
              <InventoryIcon name="download" size={12} /> Export
            </button>
          </div>
        </div>

        <div className="table-wrap">
          {kind === "apparel" ? (
            <ApparelTable
              rows={sorted}
              selected={selected}
              toggleSel={toggleSel}
              openSku={openSku}
              openAdjust={openAdjust}
              Th={Th}
              settings={settings}
            />
          ) : (
            <FabricTrimTable
              kind={kind}
              rows={sorted}
              selected={selected}
              toggleSel={toggleSel}
              openSku={openSku}
              openAdjust={openAdjust}
              Th={Th}
              suppliers={suppliers}
              settings={settings}
            />
          )}
        </div>

        <div className="table-footer">
          <span>
            Showing 1–{sorted.length} of {rows.length}
          </span>
          <div className="pager">
            <button type="button" className="btn ghost sm" disabled>
              <InventoryIcon name="chev_l" size={12} />
            </button>
            <span style={{ padding: "0 6px" }}>Page 1 of 1</span>
            <button type="button" className="btn ghost sm" disabled>
              <InventoryIcon name="chev_r" size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
