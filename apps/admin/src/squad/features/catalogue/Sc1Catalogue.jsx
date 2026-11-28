// Scott One presentation for product browsing. Queries, pricing and permissions stay with CataloguePage.
import { useState } from "react";
import { Share2 } from "lucide-react";
import { Surface, SearchField, Sheet, Button, Card, Badge, Icon } from "../../../scott-one-ui";
import { useSquadQuery } from "../../data/hooks";
import { money } from "../orders/orderModel";

export function Sc1ProductToolbar({ search, onSearchChange, onSearch, filterCount = 0, filters, cartCount, checkout, onCheckout, sharing, onToggleShare }) {
  const [open, setOpen] = useState(false);
  return <Surface skin="core" className="sc1-order-toolbar">
    <div className="sc1-order-heading"><h1 className="sc1-type-page">Products</h1>
      <div className="sc1-heading-actions">
        {onToggleShare && <button type="button" className="sc1-icon-button" aria-pressed={sharing} aria-label={sharing ? "Stop selecting for sharing" : "Select products to share"} onClick={onToggleShare}><Share2 className="size-5" aria-hidden="true" /></button>}
        <button type="button" className="sc1-text-action" disabled={!cartCount} onClick={onCheckout}>{checkout ? "Back to products" : `Selection (${cartCount})`}</button>
      </div></div>
    {!checkout && <div className="sc1-order-search">
      <SearchField value={search} onChange={(value) => { onSearchChange(value); if (!value) onSearch(""); }} onSubmit={(value) => onSearch(value.trim())} label="Search products" placeholder="Find a product" />
      {filters && <button type="button" className="sc1-filter-button" aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"} onClick={() => setOpen(true)}>
        <Icon name="filter" size={22} />{filterCount > 0 && <span aria-hidden="true">{filterCount}</span>}
      </button>}
    </div>}
    <Sheet open={open} onOpenChange={setOpen} title="Filter products" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>{filters}</Sheet>
  </Surface>;
}

/** One compact row for whose prices and stock are shown; the full picker opens in a sheet. */
export function Sc1CustomerContext({ sdk, identity, environment, customerId, kind, children }) {
  const [open, setOpen] = useState(false);
  const person = useSquadQuery(["catalogue-context-name", environment, identity.id, customerId], ({ sdk }) => sdk.person(customerId), { enabled: !!customerId });
  const name = customerId ? person.data?.company_name || person.data?.name || `#${customerId}` : null;
  return <Surface skin="core" className="sc1-context">
    <button type="button" className="sc1-context-row" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Icon name="account" size={22} />
      <span><small>{name ? `Ordering for ${kind.toLowerCase()}` : "Prices and stock"}</small><strong>{name ?? `Choose a ${kind.toLowerCase()}`}</strong></span>
      <Icon name="chevron-right" size={20} />
    </button>
    <Sheet open={open} onOpenChange={setOpen} title="Order for" description="Prices, addresses and stock visibility follow the selected account's commercial rules." footer={<Button onClick={() => setOpen(false)}>Done</Button>}>{children}</Sheet>
  </Surface>;
}

export function Sc1ProductGrid({ children }) {
  return <Surface skin="core" className="sc1-product-grid">{children}</Surface>;
}

export function Sc1ProductTile({ name, caption, media, onOpen, openLabel, select, extra }) {
  return <Card as="article" className="sc1-product sc1-product-tile sc1-order-tap">
    <div className="sc1-product-media">{media}</div>
    {select}
    <div className="sc1-product-copy">
      <p className="sc1-caption">{caption}</p>
      <h2><button type="button" className="sc1-order-open" onClick={onOpen} aria-label={`${openLabel} ${name}`}>{name}</button></h2>
      {extra}
    </div>
  </Card>;
}

/** Ready-made variants as cards with a stepper, replacing the wide table on phones. */
export function Sc1VariantList({ rows, quantities, onChange, canCalculate }) {
  const onQuantity = (id, value) => onChange((current) => ({ ...current, [id]: value }));
  // Functional update so quick repeated taps are all counted.
  const step = (id, by) => onChange((current) => ({ ...current, [id]: String(Math.min(100000, Math.max(0, (Number(current[id]) || 0) + by))) }));
  return <ul className="sc1-item-list">{rows.map((row) => {
    const disabled = !row.price || !canCalculate;
    return <li key={row.id}>
      <div className="sc1-variant-head"><div><strong>{row.name}</strong>{row.size_name && <p>Size {row.size_name}</p>}</div><strong>{money(row.price?.unit_price)}</strong></div>
      <Surface skin="core" className="sc1-variant-stock"><Badge tone={row.availability?.status === "ready" ? "success" : "warning"}>{row.availability?.status?.replaceAll("_", " ") ?? "Unknown"}</Badge><span className="sc1-caption">1 day: {row.availability?.one_day ?? "—"} · 3 days: {row.availability?.three_day ?? "—"}</span></Surface>
      <div className="sc1-stepper">
        <button type="button" aria-label={`Decrease ${row.name} quantity`} disabled={disabled || !Number(quantities[row.id])} onClick={() => step(row.id, -1)}>−</button>
        <input type="number" inputMode="numeric" min="0" max="100000" step="1" placeholder="0" aria-label={`${row.name} quantity`} disabled={disabled} value={quantities[row.id] ?? ""} onChange={(event) => onQuantity(row.id, event.target.value)} />
        <button type="button" aria-label={`Increase ${row.name} quantity`} disabled={disabled} onClick={() => step(row.id, 1)}>+</button>
      </div>
    </li>;
  })}</ul>;
}
