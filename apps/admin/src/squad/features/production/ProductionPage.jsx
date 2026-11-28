import React, { useState } from 'react';
import { ArrowLeft, ArrowUpRight, ClipboardCheck, PackageCheck, Scissors, Factory, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Panel, PageHeader, QueryState, CommandState, ReadOnlyNote, Field, Select, Pagination, useCursor, useOperationQuery, useOperationCommand, DateText, Status, DataTable, QuantityEditor, RefreshButton } from './OperationsUI';
import { roleOf, routeId, quantityRows, requireReason, isoDate } from './operationsModel';
import {OperationalItemsPanel} from './TailorWorkPanel';
import RatingsPanel from '../orders/RatingsPanel';
import PersonPicker from './PersonPicker';
import WorkHistory from './WorkHistory';
import ProductionProgress from './ProductionProgress';
import { Deliveries } from '../stock/StockPage';
import { Surface, Card, Badge, Icon } from '../../../scott-one-ui';
import './production.css';
const titles = {
  factory: ['Production', 'Follow work from allocation to dispatch.'],
  cutting: ['Cutting', 'Record sizes as work is completed.'],
  inspection: ['Inspection', 'Review assigned work and record inspected quantities.'],
  dispatch: ['Dispatch', 'Prepare and record partial deliveries.']
};
const pageClass = scott => scott ? 'space-y-4 sc1-prod' : 'space-y-5';
/** Scott One title row with optional refresh and status chips. */
function ScottHead({ title, caption, onRefresh, refreshing, chips, chip, onChip, chipLabel }) {
  return <Surface skin="core" className="sc1-order-toolbar sc1-work-toolbar">
    <div className="sc1-order-heading sc1-flush"><h1 className="sc1-type-page">{title}</h1>
      {onRefresh && <button type="button" className="sc1-icon-button" aria-label="Refresh" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? 'size-5 animate-spin motion-reduce:animate-none' : 'size-5'} aria-hidden="true" /></button>}
    </div>
    {caption && <p className="sc1-caption">{caption}</p>}
    {chips && <div className="sc1-chip-rail" role="group" aria-label={chipLabel}>{chips.map(([value, label]) => <button type="button" key={value} className="sc1-rail-chip" aria-pressed={chip === value} onClick={() => onChip(value)}>{label}</button>)}</div>}
  </Surface>;
}
/** One tappable card per queue row; the whole card opens the record. */
function ScottWorkCard({ title, caption, badges, lines, counts, onOpen }) {
  return <Card as="article" className="sc1-order sc1-order-tap">
    <div className="sc1-order-top">
      <span className="sc1-order-symbol"><Icon name="orders" /></span>
      <div className="sc1-grow">{caption && <p className="sc1-caption">{caption}</p>}
        <h2 className="sc1-prod-card-title"><button type="button" className="sc1-order-open" onClick={onOpen}>{title}</button></h2></div>
      <span className="sc1-order-chevron" aria-hidden="true"><Icon name="chevron-right" size={20} /></span>
    </div>
    {badges && <div className="sc1-prod-badges">{badges}</div>}
    {lines}
    <dl className="sc1-item-counts" data-columns={counts.length}>{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl>
  </Card>;
}
export default function ProductionPage(props) {
  const role = roleOf(props.identity);
  if (String(props.path).includes('/deliveries') && [4, 7, 10].includes(role)) return <div className={pageClass(props.scott)}>{props.scott ? <><ScottHead title="Deliveries" /><div className="sc1-order-actions"><Button variant="outline" onClick={() => props.onNavigate('/squad/production/dispatch')}>Dispatch queue</Button></div></> : <PageHeader title="Deliveries" description="Recorded dispatches and their original destinations."><Button variant="outline" onClick={() => props.onNavigate('/squad/production/dispatch')}>Dispatch queue</Button></PageHeader>}<Deliveries {...props} /></div>;
  if (role === 0) return <AdminProductionOverview {...props} />;
  const defaultMode = role === 9 ? 'cutting' : role === 8 ? 'inspection' : [7, 10].includes(role) ? 'dispatch' : 'factory';
  const parts = String(props.path || '').split('/');
  const mode = parts.find(x => Object.hasOwn(titles, x)) || defaultMode;
  const id = routeId(props.path);
  if (!({
    factory: [2, 4],
    cutting: [4, 9],
    inspection: [2, 4, 7, 8],
    dispatch: [4, 7, 10]
  }[mode] || []).includes(role)) return <QueryState query={{
    error: new Error('This workspace is not available for your role.'),
    refresh: () => props.onNavigate('/squad')
  }} />;
  if (!id && mode === 'inspection') return <div className={pageClass(props.scott)}>{props.scott ? null : <PageHeader title="Inspection" description="Review current assigned work and inspected quantities."/>}<OperationalItemsPanel {...props}/></div>;
  return id ? <ProductionDetail key={`${mode}:${id}`} {...props} mode={mode} id={id} /> : <ProductionQueue key={mode} {...props} mode={mode} />;
}
function ProductionQueue({
  sdk,
  identity,
  environment,
  onNavigate,
  mode,
  scott = false
}) {
  const page = useCursor();
  const [phase, setPhase] = useState(''),
    [completed, setCompleted] = useState(false),[orderSearch,setOrderSearch]=useState(''),[orderId,setOrderId]=useState(null);
  const query = useOperationQuery([environment, identity.id, 'queue', mode, phase, completed, orderId, page.cursor], ({sdk}) => mode === 'factory' ? sdk.factoryQueue({
    phase: phase || undefined
  }, {
    cursor: page.cursor,
    limit: 25
  }) : mode === 'inspection' ? sdk.jobsheets({}, {
    cursor: page.cursor,
    limit: 25
  }) : sdk[mode === 'cutting' ? 'cuttingQueue' : 'dispatchQueue']({
    completed,orderId:orderId||undefined
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  const rows = query.data?.data || [];
  const [title, description] = titles[mode];
  const columns = mode === 'inspection' ? [{
    key: 'item_id',
    label: 'Item',
    render: r => <Button variant="link" className="h-auto p-0" onClick={() => onNavigate(`/squad/production/inspection/${r.item_id}`)}>Item #{r.item_id}<ArrowUpRight /></Button>
  }, {
    key: 'tailor_id',
    label: 'Tailor',
    render: r => `#${r.tailor_id}`
  }, {
    key: 'assigned',
    label: 'Assigned'
  }, {
    key: 'inspected',
    label: 'Inspected'
  }, {
    key: 'picked',
    label: 'Picked'
  }, {
    key: 'occurred_at',
    label: 'Assigned on',
    render: r => <DateText value={r.occurred_at} />
  }] : [{
    key: 'id',
    label: 'Work item',
    render: r => <div><Button variant="link" className="h-auto p-0" onClick={() => onNavigate(`/squad/production/${mode}/${r.id}`)}>Item #{r.id}<ArrowUpRight /></Button><p className="mt-1 text-xs text-muted-foreground">Order #{r.order_id}{r.sample ? ' · Sample' : ''}</p></div>
  }, {
    key: 'due_at',
    label: 'Due',
    render: r => <DateText value={r.due_at} />
  }, {
    key: 'cut',
    label: 'Cut'
  }, {
    key: mode === 'factory' ? 'sewn' : 'inspected',
    label: 'Inspected'
  }, {
    key: 'dispatched',
    label: 'Dispatched'
  }, {
    key: 'state',
    label: 'Status',
    render: r => <div className="flex gap-1">{r.held ? <Status tone="warning">On hold</Status> : <Status>{r.stock_status?.replaceAll('_', ' ') || 'In progress'}</Status>}{r.prime && <Status tone="warning">Priority</Status>}</div>
  }];
  if (scott) {
    const searchable = ['cutting', 'dispatch'].includes(mode);
    const chips = mode === 'factory' ? [['', 'Active work'], ...['unassigned', 'criteria', 'cutting', 'sewing', 'dispatch', 'completed'].map(v => [v, v[0].toUpperCase() + v.slice(1)])] : [['false', 'Pending'], ['true', 'Completed']];
    const canHistory = [4, 7, 10].includes(roleOf(identity));
    return <div className={pageClass(scott)}>
      <ScottHead title={title} onRefresh={query.refresh} refreshing={query.loading} chipLabel={mode === 'factory' ? 'Production phase' : 'Work status'} chips={chips} chip={mode === 'factory' ? phase : String(completed)} onChip={value => {
        if (mode === 'factory') setPhase(value);else setCompleted(value === 'true');
        page.reset();
      }} />
      {searchable && <form className="sc1-prod-search" onSubmit={e => {
        e.preventDefault();
        setOrderId(orderSearch.trim() || null);
        page.reset();
      }}><Input aria-label="Order number" inputMode="numeric" pattern="[1-9][0-9]*" placeholder="Order number" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} /><Button variant="outline" type="submit">Find</Button>{orderId && <Button variant="ghost" type="button" onClick={() => {
          setOrderSearch('');
          setOrderId(null);
          page.reset();
        }}>Clear</Button>}</form>}
      {(mode === 'factory' || canHistory) && <div className="sc1-order-actions">{mode === 'factory' && <Button variant="outline" onClick={() => onNavigate('/squad/orders')}>Order checklists</Button>}{canHistory && <Button variant="outline" onClick={() => onNavigate('/squad/production/deliveries')}>Delivery history</Button>}</div>}
      <QueryState query={query} empty={!rows.length} />
      {!query.loading && !query.error && rows.length > 0 && <Surface skin="core" className="sc1-order-list sc1-prod-list">{rows.map(r => <ScottWorkCard key={r.id} title={`Item #${r.id}`} caption={`Order #${r.order_id}${r.sample ? ' · Sample' : ''}`} onOpen={() => onNavigate(`/squad/production/${mode}/${r.id}`)} badges={<>{r.held ? <Badge tone="warning">On hold</Badge> : <Badge>{r.stock_status ? r.stock_status.charAt(0).toUpperCase() + r.stock_status.slice(1).replaceAll('_', ' ') : 'In progress'}</Badge>}{r.prime && <Badge tone="warning">Priority</Badge>}</>} lines={<p className="sc1-caption">Due <DateText value={r.due_at} /></p>} counts={[['Cut', r.cut], ['Inspected', r[mode === 'factory' ? 'sewn' : 'inspected']], ['Dispatched', r.dispatched]]} />)}</Surface>}
      <Pagination loading={query.loading} cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} />
    </div>;
  }
  return <div className="space-y-5"><PageHeader title={title} description={description}><RefreshButton onClick={query.refresh} disabled={query.loading} />{mode==='factory'&&<Button variant="outline" onClick={()=>onNavigate('/squad/orders')}>Order checklists</Button>}{[4, 7, 10].includes(roleOf(identity)) && <Button variant="outline" onClick={() => onNavigate('/squad/production/deliveries')}>Delivery history</Button>}</PageHeader><Panel title="Work queue" description="Only work available to your account appears here." actions={mode === 'factory' ? <Select aria-label="Production phase" value={phase} onChange={e => {
      setPhase(e.target.value);
      page.reset();
    }}><option value="">Active work</option>{['unassigned', 'criteria', 'cutting', 'sewing', 'dispatch', 'completed'].map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</Select> : mode !== 'inspection' ? <Select aria-label="Work status" value={String(completed)} onChange={e => {
      setCompleted(e.target.value === 'true');
      page.reset();
    }}><option value="false">Pending</option><option value="true">Completed</option></Select> : null}>{['cutting','dispatch'].includes(mode)&&<form className="flex flex-wrap items-end gap-3 p-5" onSubmit={e=>{e.preventDefault();setOrderId(orderSearch.trim()||null);page.reset();}}><label className="min-w-40 space-y-1 text-sm font-medium">Order number<Input aria-label="Order number" inputMode="numeric" pattern="[1-9][0-9]*" placeholder="All orders" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)}/></label><Button variant="outline" type="submit">Find order</Button>{orderId&&<Button variant="ghost" type="button" onClick={()=>{setOrderSearch('');setOrderId(null);page.reset();}}>Clear</Button>}</form>}<QueryState query={query} empty={!rows.length} />{!query.loading && !query.error && rows.length > 0 && <DataTable rows={rows} columns={columns} />}<Pagination loading={query.loading} cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} /></Panel></div>;
}
function ProductionDetail(props) {
  const {
    sdk,
    identity,
    environment,
    onNavigate,
    mode,
    id,
    canWrite,
    scott = false
  } = props;
  const role = roleOf(identity),
    page = useCursor();
  const query = useOperationQuery([environment, identity.id, mode, id, page.cursor], async ({sdk}) => {
    if (mode === 'cutting' || mode === 'dispatch') return sdk[mode === 'cutting' ? 'cuttingDetail' : 'dispatchDetail'](id, {
      quantityCursor: page.cursor,
      limit: 25
    });
    const item = await sdk.orderItem(id, 'quantities', {
      cursor: page.cursor,
      limit: 25
    });
    return {
      ...item,
      quantities: item.records
    };
  });
  const [values, setValues] = useState({});
  const [occurredAt, setOccurredAt] = useState('');
  const command = useOperationCommand(canWrite, () => {
    setValues({});
  });
  const detail = query.data;
  const allowed = mode === 'cutting' && role === 9 || mode === 'dispatch' && [7, 10].includes(role);
  const submit = e => {
    e.preventDefault();
    command.run(JSON.stringify([mode, id, detail.version, values, occurredAt]), key => sdk[mode === 'cutting' ? 'recordCutting' : 'recordDispatch'](id, quantityRows(detail.quantities.data, values, mode), occurredAt ? isoDate(occurredAt) : null, {
      expectedVersion: detail.version,
      idempotencyKey: key
    }));
  };
  const subtitle = detail ? `${detail.product?.name ? detail.product.name + ' · ' : ''}Order #${detail.order_id}${detail.sample || detail.sample_order ? ' · Sample' : ''}` : 'Work details';
  const refresh = () => {
    setValues({});
    query.refresh();
  };
  return <div className={pageClass(scott)}><Button variant="ghost" className={scott ? 'sc1-desktop-only' : undefined} onClick={() => onNavigate(`/squad/production/${mode}`)}><ArrowLeft />Back to {titles[mode][0].toLowerCase()}</Button>{scott ? <ScottHead title={`Item #${id}`} caption={subtitle} onRefresh={refresh} refreshing={query.loading || command.busy} /> : <PageHeader title={`Item #${id}`} description={subtitle}><RefreshButton onClick={refresh} disabled={query.loading || command.busy} /></PageHeader>}<QueryState query={query} />{detail && <>{[2, 4, 9].includes(role) && <ProductionProgress sdk={sdk} orderId={detail.order_id} scott={scott} />}<Panel title="Size breakdown" description={scott ? allowed ? 'Enter only what was completed now.' : undefined : "Record only the quantities completed in this update."}><form onSubmit={submit} className="space-y-4">{mode === 'inspection' ? scott ? <ul className="sc1-item-list sc1-prod-sizes">{detail.quantities.data.map(r => <li key={r.id}><div className="sc1-prod-size-head"><strong>{r.size_name || `#${r.id}`}</strong></div><dl className="sc1-item-counts">{[['Planned', r.quantity], ['Assigned', r.assigned], ['Completed', r.completed], ['Dispatched', r.dispatched]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl></li>)}</ul> : <DataTable rows={detail.quantities.data} columns={[{
            key: 'size_name',
            label: 'Size'
          }, {
            key: 'quantity',
            label: 'Planned'
          }, {
            key: 'assigned',
            label: 'Assigned'
          }, {
            key: 'completed',
            label: 'Completed'
          }, {
            key: 'dispatched',
            label: 'Dispatched'
          }]} /> : <QuantityEditor scott={scott} readOnly={!allowed} rows={detail.quantities.data} values={values} onChange={setValues} mode={mode === 'factory' ? 'assignment' : mode} disabled={!allowed || !canWrite || command.busy} />}<Pagination cursor={detail.quantities.next_cursor} hasPrevious={page.hasPrevious} onPrevious={() => {
            setValues({});
            page.previous();
          }} onNext={() => {
            setValues({});
            page.next(detail.quantities.next_cursor);
          }} /><CommandState command={command} />{allowed && <Field label="Work recorded at" hint="Leave empty to use the current time."><Input type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} disabled={!canWrite || command.busy} /></Field>}{allowed && <Button type="submit" className={scott ? 'sc1-prod-submit' : undefined} disabled={!canWrite || command.busy || detail.stock_status === 'needs_reconciliation'}>{mode === 'cutting' ? <Scissors /> : <PackageCheck />}{command.busy ? 'Saving…' : mode === 'cutting' ? 'Record cutting' : 'Record dispatch'}</Button>}</form></Panel>{mode === 'factory' && <FactoryActions {...props} item={detail} />} {mode === 'inspection' && role === 8 && <Inspection {...props} item={detail} />} {mode === 'dispatch' && role === 7 && <DispatchDestination {...props} orderId={detail.order_id} />} {['factory', 'inspection'].includes(mode) && <Criteria {...props} />} {['factory', 'inspection'].includes(mode) && <WorkHistory sdk={sdk} itemId={id} scott={scott} />} {detail.history && <Panel title="Work history"><DataTable rows={detail.history.data} columns={[{
          key: 'occurred_at',
          label: 'Recorded',
          render: r => <DateText value={r.occurred_at} />
        }, {
          key: 'quantity_id',
          label: 'Size record'
        }, {
          key: 'quantity',
          label: 'Quantity'
        }, {
          key: 'remaining_before',
          label: 'Available before'
        }]} />{detail.history.next_cursor && <History {...props} />}</Panel>}</>}</div>;
}
function History({
  sdk,
  id,
  mode
}) {
  const page = useCursor();
  const query = useOperationQuery(['history', mode, id, page.cursor], ({sdk}) => sdk[mode === 'cutting' ? 'cuttingDetail' : 'dispatchDetail'](id, {
    historyCursor: page.cursor,
    limit: 25
  }));
  return <><QueryState query={query} /><Pagination cursor={query.data?.history.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.history.next_cursor)} />{page.cursor && query.data && <DataTable rows={query.data.history.data} columns={[{
      key: 'occurred_at',
      label: 'Recorded',
      render: r => <DateText value={r.occurred_at} />
    }, {
      key: 'quantity',
      label: 'Quantity'
    }]} />}</>;
}
function FactoryActions({
  sdk,
  identity,
  canWrite,
  environment,
  item,
  scott = false
}) {
  const role = roleOf(identity);
  const [kind, setKind] = useState('factory'),
    [person, setPerson] = useState(''),
    [reason, setReason] = useState(''),
    [due, setDue] = useState(''),
    [completion, setCompletion] = useState(''),
    [values, setValues] = useState({}),
    [tailorRole, setTailorRole] = useState(5);
  const order = useOperationQuery(['allocation-order', item.order_id, item.version], ({sdk}) => sdk.order(item.order_id, {
    limit: 1
  }));
  const command = useOperationCommand(canWrite, () => {
    setValues({});
  });
  const submit = e => {
    e.preventDefault();
    command.run(JSON.stringify([item.version, order.data?.version, kind, person, reason, due, completion, values]), key => {
      if (!person) throw new Error('Choose a person for this assignment.');
      if (role === 2) {
        const c = {
          expectedVersion: order.data.version,
          idempotencyKey: key
        };
        return kind === 'factory' ? sdk.assignFactory(item.order_id, person, requireReason(reason), c) : sdk.assignWorker(item.order_id, person, isoDate(due), requireReason(reason), c);
      }
      const c = {
        expectedVersion: item.version,
        idempotencyKey: key
      };
      if (kind === 'cutter') return sdk.assignCutter(item.id, person, requireReason(reason), c);
      if (new Date(completion) > new Date(due)) throw new Error('Completion target must be on or before the due date.');
      return sdk.assignJobsheet(item.id, quantityRows(item.quantities.data, values, 'assignment').map(r => ({
        ...r,
        tailor_id: person
      })), isoDate(due), isoDate(completion), c);
    });
  };
  const assignmentKind = role === 2 ? kind : kind === 'cutter' ? 'cutter' : 'tailor';
  return <><Panel title={role === 2 ? 'Production assignment' : 'Assign work'} description={scott ? undefined : role === 2 ? 'Choose the factory or job worker responsible for this order.' : 'Assign a cutter or allocate cut quantities to a tailor.'}><form onSubmit={submit} className="space-y-4"><Field label="Assignment"><Select value={assignmentKind} onChange={e => {
            setKind(e.target.value);
            setPerson('');
          }}>{role === 2 ? <><option value="factory">Factory</option><option value="worker">Job worker</option></> : <><option value="tailor">Tailor / subtailor</option><option value="cutter">Cutting master</option></>}</Select></Field>{assignmentKind === 'tailor' && <Field label="Workforce"><Select value={tailorRole} onChange={e => {
            setTailorRole(Number(e.target.value));
            setPerson('');
          }}><option value="5">Tailor</option><option value="6">Subtailor</option></Select></Field>}<PersonPicker key={`${assignmentKind}:${tailorRole}`} sdk={sdk} role={assignmentKind === 'factory' ? 4 : assignmentKind === 'worker' ? 11 : assignmentKind === 'cutter' ? 9 : tailorRole} label={assignmentKind.replace('_', ' ')} value={person} onChange={setPerson} disabled={!canWrite || command.busy} />{assignmentKind === 'tailor' && <QuantityEditor scott={scott} rows={item.quantities.data} values={values} onChange={setValues} mode="assignment" disabled={!canWrite || command.busy} />} {['worker', 'tailor'].includes(assignmentKind) && <div className="grid gap-4 sm:grid-cols-2"><Field label="Due date"><Input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} required /></Field>{assignmentKind === 'tailor' && <Field label="Completion target"><Input type="datetime-local" value={completion} onChange={e => setCompletion(e.target.value)} required /></Field>}</div>}{assignmentKind !== 'tailor' && <Field label="Reason"><Textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} /></Field>}<CommandState command={command} /><Button className={scott ? 'sc1-prod-submit' : undefined} disabled={!canWrite || command.busy || !person || order.loading || !!order.error} type="submit"><Factory />{command.busy ? 'Saving…' : 'Save assignment'}</Button><QueryState query={order} /></form></Panel>{order.data && <RatingsPanel sdk={sdk} identity={identity} environment={environment} canWrite={canWrite} entityKind="Item" entityId={item.id} completed={order.data.status === 1} orderType={order.data.type} scott={scott} />}</>;
}
function Inspection({
  sdk,
  item,
  canWrite,
  scott = false
}) {
  const page = useCursor();
  const query = useOperationQuery(['inspect-work', item.id, item.version, page.cursor], ({sdk}) => sdk.tailorWork({
    itemId: item.id
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  const [values, setValues] = useState({});
  const [occurredAt, setOccurredAt] = useState('');
  const command = useOperationCommand(canWrite, () => {
    setValues({});
  });
  const rows = (query.data?.data || []).map(r => ({
    ...r,
    id: r.item_tailor_quantity_id
  }));
  return <Panel title="Record inspection" description={scott ? 'Completed pieces picked from the tailor.' : "Record completed pieces picked from the tailor, matching the original workflow."}><QueryState query={query} empty={!rows.length} />{rows.length > 0 && <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify([item.version, values, occurredAt]), key => sdk.inspectJobsheet(item.id, quantityRows(rows, values, 'inspection'), occurredAt ? isoDate(occurredAt) : null, {
        expectedVersion: item.version,
        idempotencyKey: key
      }));
    }}><QuantityEditor scott={scott} rows={rows} values={values} onChange={setValues} mode="inspection" disabled={!canWrite || command.busy} /><Field label="Work recorded at" hint="Leave empty to use the current time."><Input type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} disabled={!canWrite || command.busy} /></Field><CommandState command={command} /><Button type="submit" className={scott ? 'sc1-prod-submit' : undefined} disabled={!canWrite || command.busy}><ClipboardCheck />{command.busy ? 'Recording…' : 'Record inspection and pickup'}</Button></form>}<Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={() => {
      setValues({});
      page.previous();
    }} onNext={() => {
      setValues({});
      page.next(query.data?.next_cursor);
    }} /></Panel>;
}
function Criteria({
  sdk,
  identity,
  id,
  canWrite,
  scott = false
}) {
  const page = useCursor(),
    [checks, setChecks] = useState({});
  const role = roleOf(identity);
  const query = useOperationQuery(['criteria', id, page.cursor], ({sdk}) => sdk.orderItem(id, 'criteria', {
    cursor: page.cursor,
    limit: 25
  }));
  const command = useOperationCommand(canWrite, () => {
    setChecks({});
  });
  return <Panel title="Production checklist"><QueryState query={query} empty={!query.data?.records.data.length} />{query.data && <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify([query.data.version, checks]), key => {
        const updates = Object.entries(checks).map(([id, checked]) => ({
          id,
          checked
        }));
        if (!updates.length) throw new Error('Change at least one checklist item.');
        return sdk.saveCriteria(id, updates, {
          expectedVersion: query.data.version,
          idempotencyKey: key
        });
      });
    }}>{query.data.records.data.map(row => <label key={row.id} className={scott ? 'sc1-prod-check' : "flex items-center gap-3 rounded-lg border p-3 text-sm"}><input type="checkbox" checked={checks[row.id] ?? row.checked} disabled={!canWrite || ![2, 4].includes(role) || command.busy} onChange={e => setChecks(v => ({
          ...v,
          [row.id]: e.target.checked
        }))} />{row.name || `Check #${row.id}`}</label>)}<CommandState command={command} />{[2, 4].includes(role) && <Button type="submit" variant={scott ? 'outline' : undefined} className={scott ? 'sc1-prod-submit' : undefined} disabled={!canWrite || command.busy || !Object.keys(checks).length}>Save checklist</Button>}<Pagination cursor={query.data.records.next_cursor} hasPrevious={page.hasPrevious} onPrevious={() => {
        setChecks({});
        page.previous();
      }} onNext={() => {
        setChecks({});
        page.next(query.data.records.next_cursor);
      }} /></form>}</Panel>;
}
function DispatchDestination({
  sdk,
  orderId,
  canWrite,
  scott = false
}) {
  const query = useOperationQuery(['dispatch-destination', orderId], ({sdk}) => sdk.order(orderId, {
    limit: 1
  }));
  const [mode, setMode] = useState(''),
    [reason, setReason] = useState('');
  const command = useOperationCommand(canWrite);
  return <Panel title="Delivery destination"><QueryState query={query} />{query.data && <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify([query.data.version, mode, reason]), key => {
        if (!mode) throw new Error('Choose a destination.');
        return sdk.saveDispatchDestination(orderId, mode, requireReason(reason), {
          expectedVersion: query.data.version,
          idempotencyKey: key
        });
      });
    }}><p className="text-sm text-muted-foreground">Current destination: {query.data.dispatch_destination.mode.replaceAll('_', ' ')}</p>{query.data.dispatch_destination.address && <p className="text-sm">{Object.values(query.data.dispatch_destination.address).slice(1).filter(Boolean).join(', ')}</p>}<Field label="Deliver to"><Select value={mode} onChange={e => setMode(e.target.value)}><option value="">Choose destination</option><option value="customer">Customer order address</option><option value="ho">Head office</option><option value="makali_factory">Makali factory</option></Select></Field><Field label="Reason"><Textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} /></Field><CommandState command={command} /><Button variant={scott ? 'outline' : undefined} className={scott ? 'sc1-prod-submit' : undefined} disabled={!canWrite || command.busy} type="submit">Save destination</Button></form>}</Panel>;
}
function AdminProductionOverview({
  sdk,
  identity,
  environment,
  onNavigate,
  scott = false
}) {
  const page = useCursor();
  const [state, setState] = useState('pending');
  const query = useOperationQuery([environment, identity.id, 'admin-production', state, page.cursor], ({sdk}) => sdk.orders({
    state,
    assignment_kind: 'factory'
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  const rows = query.data?.data || [];
  if (scott) return <div className={pageClass(scott)}>
    <ScottHead title="Production overview" chipLabel="Order status" chips={[['pending', 'Pending'], ['completed', 'Completed']]} chip={state} onChip={value => {
      setState(value);
      page.reset();
    }} />
    <QueryState query={query} empty={!rows.length} />
    {rows.length > 0 && <Surface skin="core" className="sc1-order-list sc1-prod-list">{rows.map(r => <ScottWorkCard key={r.id} title={`Order #${r.id}`} onOpen={() => onNavigate(`/squad/orders/${r.id}`)} badges={r.worker_id ? <Badge tone="warning">Also assigned to job worker #{r.worker_id}</Badge> : null} lines={<p className="sc1-caption">Factory manager #{r.factory_manager_id} · Due <DateText value={r.due_on} /></p>} counts={[['Ordered', r.total_quantity], ['Cut', r.cut_quantity], ['Inspected', r.sewn_quantity], ['Dispatched', r.dispatched_quantity]]} />)}</Surface>}
    <Pagination loading={query.loading} cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} />
  </div>;
  return <div className="space-y-5"><PageHeader title="Production overview" description="Review assigned factory orders and their recorded progress." /><Panel title="Factory orders" description="Allocation and work recording remain with their operational personas." actions={<Select aria-label="Order status" value={state} onChange={e => {
      setState(e.target.value);
      page.reset();
    }}><option value="pending">Pending</option><option value="completed">Completed</option></Select>}><QueryState query={query} empty={!rows.length} />{rows.length > 0 && <DataTable rows={rows} columns={[{
        key: 'id',
        label: 'Order',
        render: r => <Button variant="link" onClick={() => onNavigate(`/squad/orders/${r.id}`)}>#{r.id}<ArrowUpRight /></Button>
      }, {
        key: 'factory_manager_id',
        label: 'Factory manager',
        render: r => <span>#{r.factory_manager_id}{r.worker_id && <Status tone="warning">Also assigned to job worker #{r.worker_id}</Status>}</span>
      }, {
        key: 'due_on',
        label: 'Due',
        render: r => <DateText value={r.due_on} />
      }, {
        key: 'total_quantity',
        label: 'Ordered'
      }, {
        key: 'cut_quantity',
        label: 'Cut'
      }, {
        key: 'sewn_quantity',
        label: 'Inspected / picked'
      }, {
        key: 'dispatched_quantity',
        label: 'Dispatched'
      }]} />}<Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} /></Panel></div>;
}
