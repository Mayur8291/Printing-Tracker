// Scott One presentation for order lists and detail. Data, filters and permissions stay with the callers.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Surface, SearchField, Badge, Card, ProgressSteps, Sheet, Button, ChoiceGroup, Icon } from "../../../scott-one-ui";
import { orderParties, ORDER_SEARCH_PLACEHOLDER } from "./orderParties";
import { headerRows } from "./orderDetailModel";
import { orderState, money as orderMoney, dateLabel, ORDER_TYPES } from "./orderModel";
import { date, money } from "../../data/format";

const PAYMENT = ["Paid", "Unpaid", "Partially paid"];
const tone = (status) => (status === "Completed" ? "success" : status === "Cancelled" ? "neutral" : "warning");

/** Same facts as the parity card; money and assignment rows appear only when the server sent them. */
export function Sc1OrderCard({ order, onOpen }) {
  const status = orderState(order);
  const facts = [
    ["Placed on", order.created_on ?? order.created_at ? date(order.created_on ?? order.created_at) : null],
    ["Due date", order.due_on ? date(order.due_on) : null],
    ["Total quantity", order.total_quantity != null ? `${order.total_quantity} pcs` : null],
    ["Factory manager", "factory_manager_id" in order ? (order.factory_manager_id ? "Assigned" : "Yet to be assigned") : null],
  ].filter(([, value]) => value != null);
  const payment = order.payment_status != null ? PAYMENT[order.payment_status] : null;
  return <Card as="article" className="sc1-order sc1-order-tap">
    <div className="sc1-order-top">
      <span className="sc1-order-symbol"><Icon name="orders" /></span>
      <div className="sc1-grow"><p className="sc1-caption">{ORDER_TYPES[order.type] ?? "Order"}{order.is_prime ? " · Priority" : ""}</p>
        <h3><button type="button" className="sc1-order-open" onClick={onOpen}>Order #{order.id}</button></h3></div>
      <Badge tone={tone(status)}>{status}</Badge>
    </div>
    {orderParties(order).map((party, index) => <div className="sc1-order-party" key={`${party.label}-${index}`}>
      <span className="sc1-caption">{party.label}</span><strong>{party.name}</strong>{party.contact && <span className="sc1-caption">{party.contact}</span>}
    </div>)}
    <dl className="sc1-order-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="sc1-order-footer">
      <div>{order.total_amount != null && <strong className="sc1-numeric">{money(order.total_amount)}</strong>}{payment && <p className="sc1-caption">{payment}</p>}</div>
      <span className="sc1-order-chevron" aria-hidden="true"><Icon name="chevron-right" size={20} /></span>
    </div>
  </Card>;
}

export function Sc1OrderList({ rows, onOpen }) {
  return <Surface skin="commerce" className="sc1-order-list">{rows.map((order) => <Sc1OrderCard key={order.id} order={order} onOpen={() => onOpen(order)} />)}</Surface>;
}

/** Title, live search and the filter button in one block, as on the native Orders screen. */
export function Sc1OrderToolbar({ title, onSearch, onRefresh, refreshing, filterCount = 0, onReset, children }) {
  const [text, setText] = useState(""), [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => onSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, onSearch]);
  return <Surface skin="commerce" className="sc1-order-toolbar">
    <div className="sc1-order-heading"><h1 className="sc1-type-page">{title}</h1>
      <button type="button" className="sc1-icon-button" aria-label="Refresh orders" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? "size-5 animate-spin motion-reduce:animate-none" : "size-5"} aria-hidden="true" /></button></div>
    <div className="sc1-order-search">
      <SearchField value={text} onChange={(value) => setText(value.slice(0, 100))} label={ORDER_SEARCH_PLACEHOLDER} />
      <button type="button" className="sc1-filter-button" aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"} onClick={() => setOpen(true)}>
        <Icon name="filter" size={22} />{filterCount > 0 && <span aria-hidden="true">{filterCount}</span>}
      </button>
    </div>
    <Sheet open={open} onOpenChange={setOpen} title="Filter orders" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
      {children}
      {filterCount > 0 && <Button variant="quiet" onClick={onReset}>Reset filters</Button>}
    </Sheet>
  </Surface>;
}

export function Sc1TypeSort({ type, onType, sort, onSort }) {
  return <>
    <div className="sc1-filter-block"><p className="sc1-type-label">Order type</p>
      <ChoiceGroup label="Order type" value={type} onChange={onType} options={[{ value: "", label: "All" }, ...Object.entries(ORDER_TYPES).map(([value, label]) => ({ value, label }))]} /></div>
    <div className="sc1-filter-block"><p className="sc1-type-label">Sort by</p>
      <ChoiceGroup label="Sort orders" value={sort} onChange={onSort} options={[{ value: "id_desc", label: "Newest number" }, { value: "created_desc", label: "Recently placed" }, { value: "due_asc", label: "Due soonest" }]} /></div>
  </>;
}

/** Ink summary card plus progress. Rows come from headerRows so role gating matches the web header. */
export function Sc1OrderHero({ order, onRefresh }) {
  const status = orderState(order);
  const rows = headerRows(order, status, { date: dateLabel, money: orderMoney })
    .filter(([label]) => !["Order No", "Order Status", "Total Order Value"].includes(label));
  const sentence = (label) => label.charAt(0) + label.slice(1).toLowerCase();
  const payment = PAYMENT[order.payment_status];
  return <Surface skin="commerce" className="sc1-order-detail-head">
    <Card tone="inverse" className="sc1-hero">
      <div className="sc1-order-top">
        <div className="sc1-grow"><p className="sc1-caption">{ORDER_TYPES[order.type] ?? "Order"}{order.is_prime ? " · Priority" : ""}</p><h1 className="sc1-type-section">Order #{order.id}</h1></div>
        <Badge tone={tone(status)}>{status}</Badge>
        <button type="button" className="sc1-icon-button" aria-label="Refresh order" onClick={onRefresh}><RefreshCw className="size-5" aria-hidden="true" /></button>
      </div>
      {orderParties(order).map((party, index) => <div className="sc1-order-party" key={`${party.label}-${index}`}>
        <span className="sc1-caption">{party.label}</span><strong>{party.name}</strong>{party.contact && <span className="sc1-caption">{party.contact}</span>}
      </div>)}
      <dl className="sc1-hero-facts">{rows.map(([label, value]) => <div key={label}><dt className="sc1-caption">{sentence(label)}</dt><dd>{value}</dd></div>)}</dl>
      {order.total_amount !== undefined && <div className="sc1-hero-total"><span className="sc1-caption">Total order value{payment ? ` · ${payment}` : ""}</span><strong className="sc1-type-amount">{orderMoney(order.total_amount)}</strong></div>}
    </Card>
    {status !== "Cancelled" && <ProgressSteps label="Order progress" steps={["Placed", "In progress", "Completed"]} current={status === "Completed" ? 3 : 1} />}
  </Surface>;
}

export function Sc1OrderItems({ items, renderIdentity, onOpen }) {
  if (!items.length) return <p className="p-5 text-sm text-muted-foreground">No items on this page.</p>;
  return <ul className="sc1-item-list">{items.map((item) => <li key={item.id}>
    {renderIdentity(item)}
    <dl className="sc1-item-counts">{[["Ordered", item.total_quantity], ["Cut", item.cut], ["Sewn", item.sewn], ["Dispatched", item.dispatched]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
    <div className="sc1-item-foot">{item.total_amount !== undefined ? <strong>{orderMoney(item.total_amount)}</strong> : <span />}
      <button type="button" onClick={() => onOpen(item.id)}>Sizes &amp; details<Icon name="chevron-right" size={18} /></button></div>
  </li>)}</ul>;
}
