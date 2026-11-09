import React, { lazy, Suspense, useState } from 'react';
import { ArrowRight, FileDown, Package, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, Panel, QueryState, ReadOnlyNote, DataTable, DateText, Status, Pagination, useCursor, useOperationQuery, useOperationCommand, CommandState, Field, Select, RefreshButton } from '../production/OperationsUI';
import {initialPurchaseQuantities,purchaseKey,purchaseQuantities,purchaseQuantitiesChanged} from './backorderModel';
import { roleOf, isoDate } from '../production/operationsModel';
const DealerDispatchPage = lazy(() => import('../production/ProductionPage'));
export default function StockPage(props) {
  const role = roleOf(props.identity);
  const tab = String(props.path || '').includes('backorders') ? 'backorders' : String(props.path || '').includes('deliveries') ? 'deliveries' : 'balances';
  if (role !== 10) return <QueryState query={{
    error: new Error('Dealer inventory is available to dealer accounts.'),
    refresh: () => props.onNavigate('/squad')
  }} />;
  // Reuse the scoped dispatch workflow inside the Dealer's stock workspace.
  // Production remains a separate route permission; this does not grant it.
  if (/^\/squad\/stock\/dispatch(?:\/\d+)?\/?$/.test(String(props.path || ''))) {
    const onNavigate = next => props.onNavigate(next
      .replace(/^\/squad\/production\/dispatch(?=\/|$)/, '/squad/stock/dispatch')
      .replace(/^\/squad\/production\/deliveries(?=\/|$)/, '/squad/stock/deliveries'));
    return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading dispatch…</p>}><DealerDispatchPage {...props} path={props.path.replace('/squad/stock/dispatch', '/squad/production/dispatch')} onNavigate={onNavigate} /></Suspense>;
  }
  return <div className="space-y-5"><PageHeader title="Dealer inventory" description="Your stock, customer demand and delivery history." /><div className="flex flex-wrap gap-2" role="group" aria-label="Inventory views">{[['balances', 'Stock balances'], ['backorders', 'Backorders'], ['deliveries', 'Deliveries']].map(([key, label]) => <Button key={key} variant={key === tab ? 'default' : 'outline'} onClick={() => props.onNavigate(`/squad/stock/${key}`)}>{label}</Button>)}</div>{tab === 'balances' ? <Balances {...props} /> : tab === 'backorders' ? <Backorders {...props} /> : <Deliveries {...props} />}</div>;
}
function Balances({
  sdk,
  identity,
  environment,
  onNavigate
}) {
  const page = useCursor();
  const [kind, setKind] = useState('');
  const query = useOperationQuery([environment, identity.id, 'stock', kind, page.cursor], ({sdk}) => sdk.dealerStock(kind ? {
    kind
  } : {}, {}, {
    cursor: page.cursor,
    limit: 25
  }));
  return <Panel title="Available stock" description="Balances are calculated from received stock and recorded consumption." actions={<div className="flex gap-2"><Select aria-label="Product kind" value={kind} onChange={e => {
      setKind(e.target.value);
      page.reset();
    }}><option value="">All products</option><option value="custom">Custom</option><option value="rmp">Ready-made</option></Select><RefreshButton onClick={query.refresh} /></div>}><QueryState query={query} empty={!query.data?.data.length} />{query.data?.data.length > 0 && <DataTable rows={query.data.data} columns={[{
      key: 'product',
      label: 'Product',
      render: r => <div><p className="font-medium">{r.product_name || (r.kind === 'custom' ? `Custom product #${r.product_id}` : `Ready-made class #${r.rmp_class_id}`)}</p><p className="text-xs text-muted-foreground">{r.size_name || `Size #${r.size_id}`}</p></div>
    }, {
      key: 'received',
      label: 'Received'
    }, {
      key: 'consumed',
      label: 'Consumed'
    }, {
      key: 'available',
      label: 'Available',
      render: r => r.available == null ? 'Needs review' : r.available
    }, {
      key: 'status',
      label: 'Status',
      render: r => <Status tone={r.status === 'ready' ? 'success' : 'warning'}>{r.status === 'ready' ? 'Available' : 'Reconciliation required'}</Status>
    }]} />}<Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} /><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => onNavigate('/squad/stock/dispatch')}><Truck />Fulfill customer orders<ArrowRight /></Button><Button variant="outline" onClick={() => onNavigate('/squad/orders')}><Package />My purchases</Button></div></Panel>;
}
function Backorders({
  sdk,
  identity,
  environment,
  canWrite,
  onNavigate
}) {
  const page = useCursor(),
    [selected, setSelected] = useState([]),
    [address, setAddress] = useState(''),
    [due, setDue] = useState(''),
    [preview, setPreview] = useState(null),[purchases,setPurchases]=useState({});
  const orders = useOperationQuery([environment, identity.id, 'backorder-demand', page.cursor], ({sdk}) => sdk.orders({
    state: 'pending'
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  const self = useOperationQuery([environment, identity.id, 'dealer-addresses'], ({sdk}) => sdk.person(identity.id));
  const command = useOperationCommand(canWrite, result => {
    if (Array.isArray(result?.requirements)) {setPreview(result);setPurchases(initialPurchaseQuantities(result.requirements));} else {
      setSelected([]);
      setPreview(null);
      if (result?.orders?.[0]?.id) onNavigate(`/squad/orders/${result.orders[0].id}`);
    }
  });
  const rows = (orders.data?.data || []).filter(o => o.customer_id !== identity.id);
  function changeSelection(id, checked) {
    setPreview(null);
    setSelected(s => checked ? [...s, id] : s.filter(x => x !== id));
  }
  return <div className="space-y-5"><Panel title="Customer demand" description="Select customer orders to calculate shortages. Your own purchases are excluded."><QueryState query={orders} empty={!rows.length} />{rows.length > 0 && <DataTable rows={rows} columns={[{
        key: 'select',
        label: 'Select',
        render: r => <input aria-label={`Select order ${r.id}`} type="checkbox" checked={selected.includes(r.id)} disabled={!canWrite || command.busy || !selected.includes(r.id) && selected.length >= 50} onChange={e => changeSelection(r.id, e.target.checked)} />
      }, {
        key: 'id',
        label: 'Order',
        render: r => `#${r.id}`
      }, {
        key: 'customer_id',
        label: 'Customer',
        render: r => `#${r.customer_id}`
      }, {
        key: 'total_quantity',
        label: 'Ordered'
      }, {
        key: 'dispatched_quantity',
        label: 'Dispatched'
      }, {
        key: 'due_on',
        label: 'Due',
        render: r => <DateText value={r.due_on} />
      }]} />}<div className="px-5"><Pagination cursor={orders.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(orders.data?.next_cursor)} /></div><div className="mt-5 space-y-4 px-5 pb-5"><p className="text-sm text-muted-foreground">{selected.length} order{selected.length === 1 ? '' : 's'} selected across pages</p><QueryState query={self} /><Field label="Delivery address for the purchase"><Select value={address} disabled={!canWrite || command.busy} onChange={e => {
            setAddress(e.target.value);
            setPreview(null);
          }}><option value="">Choose your address</option>{(self.data?.addresses || []).map(a => <option key={a.id} value={a.id}>{[a.address, a.city, a.state, a.zip_code].filter(Boolean).join(', ')}</option>)}</Select></Field><Button disabled={!canWrite || command.busy || !selected.length || !address} onClick={() => command.run(JSON.stringify(['preview', selected, address]), () => sdk.previewBackorder(selected, address))}>{command.busy ? 'Calculating…' : 'Review shortages'}</Button><CommandState command={{...command,success:command.result?.requirements?null:command.success}} /></div></Panel>{preview && <Panel title="Shortage review" description="This preview does not reserve stock. Quantities and prices are checked again when the order is placed."><DataTable rows={preview.requirements.map(r => ({
        ...r,
        row_key: `${r.key}:${r.size_id}`
      }))} rowKey="row_key" columns={[{
        key: 'kind',
        label: 'Product kind'
      }, {
        key: 'size_id',
        label: 'Size'
      }, {
        key: 'required',
        label: 'Required'
      }, {
        key: 'available',
        label: 'Available'
      }, {
        key: 'shortage',
        label: 'Shortage',
        render: r => r.shortage == null ? 'Needs review' : r.shortage
      },{key:'purchase_quantity',label:'Purchase quantity',render:r=><Input type="number" inputMode="numeric" min="0" max="1000000" step="1" className="min-w-28" aria-label={`Purchase quantity for ${r.kind} size ${r.size_id}`} value={purchases[purchaseKey(r)]??''} disabled={!canWrite||command.busy||preview.status==='needs_reconciliation'} onChange={e=>setPurchases(v=>({...v,[purchaseKey(r)]:e.target.value}))}/>}]} /><div className="px-5 pb-5">{preview.excluded.length > 0 && <div className="my-4 rounded-lg border bg-muted/30 p-3 text-sm"><p className="font-medium">Excluded from this purchase</p>{preview.excluded.map(e => <p key={e.order_id}>Order #{e.order_id}: {e.reason.replaceAll('_', ' ')}</p>)}</div>}<p className="my-4 text-sm">{preview.status === 'no_shortage' ? 'No shortage remains for these orders.' : preview.status === 'needs_reconciliation' ? 'Stock inconsistencies must be reconciled before placing this purchase.' : `Quoted total: ₹${preview.quote?.total ?? '—'}`}</p>{preview.status!=='needs_reconciliation'&&<div className="mb-4 space-y-3"><p className="text-sm text-muted-foreground">Purchase quantities can differ from the shortage. Zero omits a size. Customer demand stays unchanged; remaining demand still needs fulfillment.</p>{purchaseQuantitiesChanged(preview.requirements,purchases)&&<><p className="text-sm font-medium">Quantities changed. Update the quote before placing this purchase.</p><Button variant="outline" disabled={!canWrite||command.busy} onClick={()=>command.run(JSON.stringify(['edited-preview',selected,address,purchases]),()=>sdk.previewBackorder(selected,address,purchaseQuantities(preview.requirements,purchases)))}>Update purchase quote</Button></>}</div>}{preview.status === 'ready' && <form className="space-y-4" onSubmit={e => {
        e.preventDefault();
        command.run(JSON.stringify(['place-backorder', preview.preview_id, preview.version, due]), key => {
          if(purchaseQuantitiesChanged(preview.requirements,purchases)) throw new Error('Update the purchase quote after changing quantities.');
          if (new Date(preview.expires_at) <= new Date()) throw new Error('This preview has expired. Review shortages again.');
          return sdk.placeBackorder(preview.preview_id, isoDate(due), {
            expectedVersion: preview.version,
            idempotencyKey: key
          });
        });
      }}><Field label="Requested due date"><Input type="datetime-local" value={due} required onChange={e => setDue(e.target.value)} /></Field><Button disabled={!canWrite || command.busy || purchaseQuantitiesChanged(preview.requirements,purchases)} type="submit">Place backorder</Button></form>}</div></Panel>}</div>;
}
export function Deliveries({
  sdk,
  identity,
  environment,
  canWrite,
  onNavigate
}) {
  const page = useCursor();
  const [order, setOrder] = useState(''),
    [filter, setFilter] = useState('');
  const query = useOperationQuery([environment, identity.id, 'deliveries', filter, page.cursor], ({sdk}) => sdk.deliveries(filter ? {
    order_id: filter
  } : {}, {
    cursor: page.cursor,
    limit: 25
  }));
  const command = useOperationCommand(canWrite, result => {
    if (result?.id) onNavigate(`/squad/documents/${result.id}`);
  });
  return <Panel title="Delivery history" description="Recorded deliveries retain their original destination snapshot."><form className="mb-4 flex max-w-md gap-2" onSubmit={e => {
      e.preventDefault();
      setFilter(order.trim());
      page.reset();
    }}><Input aria-label="Filter by order number" placeholder="Order number" pattern="[0-9]*" value={order} onChange={e => setOrder(e.target.value)} /><Button variant="outline">Filter</Button></form><QueryState query={query} empty={!query.data?.data.length} />{query.data?.data.length > 0 && <DataTable rows={query.data.data} columns={[{
      key: 'id',
      label: 'Delivery',
      render: r => `#${r.id}`
    }, {
      key: 'order_id',
      label: 'Order',
      render: r => `#${r.order_id}`
    }, {
      key: 'occurred_at',
      label: 'Date',
      render: r => <DateText value={r.occurred_at} />
    }, {
      key: 'quantity',
      label: 'Quantity'
    }, {
      key: 'destination',
      label: 'Destination',
      render: r => <div><p>{r.destination.mode.replaceAll('_', ' ')}</p>{r.destination.address && <p className="text-xs text-muted-foreground">{[r.destination.address.address, r.destination.address.city].filter(Boolean).join(', ')}</p>}{r.destination_basis === 'current_order_only' && <Status tone="warning">Original address not recorded</Status>}</div>
    }, {
      key: 'document',
      label: 'Challan',
      render: r => <Button variant="outline" size="sm" disabled={!canWrite || command.busy} onClick={() => command.run(JSON.stringify(['challan', r.item_id, r.id]), key => sdk.requestDocument('delivery_challan', {
        item_id: r.item_id,
        dispatch_id: r.id,
        delivery: 'download'
      }, key))}><FileDown />Generate</Button>
    }]} />}<CommandState command={command} /><Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} /></Panel>;
}
