import React, { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, Panel, QueryState, ReadOnlyNote, DataTable, DateText, Status, Pagination, useCursor, useOperationQuery, useOperationCommand, CommandState, Field, Select, RefreshButton } from '../production/OperationsUI';
import WorkerCommitmentHistory from './WorkerCommitmentHistory';
import {jobWorkFilters} from './jobWorkFilters';
import RatingsPanel from '../orders/RatingsPanel';
import { roleOf, routeId, WORKER_STAGES, workerStageOptions, requireReason, isoDate } from '../production/operationsModel';
import { Surface, SearchField, Sheet, Button as KitButton, ChoiceGroup, Checkbox, Card, Badge, Icon } from '../../../scott-one-ui';
import './sc1JobWork.css';
const SORTS = [{ value: 'id_desc', label: 'Newest orders' }, { value: 'due_asc', label: 'Due soonest' }, { value: 'created_desc', label: 'Recently created' }];
export default function JobWorkPage(props) {
  const role = roleOf(props.identity);
  if (![0, 2, 11].includes(role)) return <QueryState query={{
    error: new Error('Job work is not available for your role.'),
    refresh: () => props.onNavigate('/squad')
  }} />;
  const id = routeId(props.path);
  return id ? <JobDetail key={id} {...props} id={id} /> : <JobQueue {...props} />;
}
function JobQueue({
  sdk,
  identity,
  environment,
  onNavigate,
  scott
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [state, setState] = useState('pending'),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState(''),
    [priority,setPriority] = useState(false),[sort,setSort] = useState('id_desc');
  const page = useCursor();
  const query = useOperationQuery([environment, identity.id, 'job-orders', state, term, priority, sort, page.cursor], ({sdk}) => sdk.orders(jobWorkFilters({state,search:term,priority,sort}), {
    cursor: page.cursor,
    limit: 25
  }));
  if (scott) {
    const filterCount = (priority ? 1 : 0) + (sort !== 'id_desc' ? 1 : 0);
    const rows = query.data?.data || [];
    return <div className="sc1-job space-y-4">
      <Surface skin="commerce" className="sc1-order-toolbar sc1-work-toolbar">
        <div className="sc1-order-heading sc1-flush"><h1 className="sc1-type-page">Job work</h1>
          <button type="button" className="sc1-icon-button" aria-label="Refresh job work" disabled={query.loading} onClick={query.refresh}><RefreshCw className="size-5" aria-hidden="true" /></button></div>
        <div className="sc1-order-search">
          <SearchField value={search} onChange={value => {
            setSearch(value);
            if (!value && term) {
              setTerm('');
              page.reset();
            }
          }} onSubmit={value => {
            setTerm(value.trim());
            page.reset();
          }} label="Search orders" placeholder="Search orders" />
          <button type="button" className="sc1-filter-button" aria-haspopup="dialog" aria-label={filterCount ? `Filters, ${filterCount} active` : 'Filters'} onClick={() => setFiltersOpen(true)}><Icon name="filter" size={22} />{filterCount > 0 && <span aria-hidden="true">{filterCount}</span>}</button>
        </div>
        <div className="sc1-chip-rail" role="group" aria-label="Order status">{[['pending', 'Pending'], ['completed', 'Completed']].map(([value, label]) => <button type="button" key={value} className="sc1-rail-chip" aria-pressed={state === value} onClick={() => {
          if (state === value) return;
          setState(value);
          page.reset();
        }}>{label}</button>)}</div>
        <p className="sc1-caption">{roleOf(identity) === 11 ? 'My orders' : 'Order assignments'}{roleOf(identity) === 2 ? ' · Factory assignments remain in Production.' : ''}</p>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filters" footer={<KitButton onClick={() => setFiltersOpen(false)}>Done</KitButton>}>
          <Checkbox label="Priority only" checked={priority} onChange={e => {
            setPriority(e.target.checked);
            page.reset();
          }} />
          <div className="sc1-filter-block"><p className="sc1-type-label">Sort by</p><ChoiceGroup label="Sort job orders" value={sort} options={SORTS} onChange={value => {
            setSort(value);
            page.reset();
          }} /></div>
        </Sheet>
      </Surface>
      <QueryState query={query} empty={!rows.length} />
      {rows.length > 0 && <Surface skin="commerce" className="sc1-order-list">{rows.map(r => <Card as="article" className="sc1-order sc1-order-tap" key={r.id}>
        <div className="sc1-order-top">
          <span className="sc1-order-symbol"><Icon name="orders" /></span>
          <div className="sc1-grow"><h3><button type="button" className="sc1-order-open" onClick={() => onNavigate(`/squad/job-work/${r.id}`)}>Order #{r.id}</button></h3></div>
          <Badge tone={r.worker_status === 1 ? 'success' : 'warning'}>{r.worker_status === 1 ? 'Completed' : 'In progress'}</Badge>
        </div>
        <div className="sc1-order-party"><span className="sc1-caption">Assignment</span><strong>{r.worker_id ? `Job worker #${r.worker_id}` : 'Not assigned to job work'}</strong></div>
        {r.worker_id && r.factory_manager_id && <div><Badge tone="warning">Factory assignment also present</Badge></div>}
        <dl className="sc1-order-facts"><div><dt>Due date</dt><dd><DateText value={r.due_on} /></dd></div><div><dt>Quantity</dt><dd>{r.total_quantity ?? '—'}</dd></div></dl>
      </Card>)}</Surface>}
      <div className="sc1-job-pager"><Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} /></div>
    </div>;
  }
  return <div className="space-y-5"><PageHeader title="Job work" description="Follow assigned production through its six stages."><RefreshButton onClick={query.refresh} /></PageHeader><Panel title={roleOf(identity) === 11 ? 'My orders' : 'Order assignments'} description={roleOf(identity) === 2 ? 'Open an assigned job-work order to manage its progress. Factory assignments remain in Production.' : null} actions={<Select aria-label="Order status" value={state} onChange={e => {
      setState(e.target.value);
      page.reset();
    }}><option value="pending">Pending</option><option value="completed">Completed</option></Select>}><form className="mb-4 flex flex-wrap items-center gap-2 p-5" onSubmit={e => {
        e.preventDefault();
        setTerm(search.trim());
        page.reset();
      }}><Input aria-label="Search orders" placeholder="Search orders…" value={search} onChange={e => setSearch(e.target.value)} /><Button variant="outline">Search</Button><label className="flex items-center gap-2 text-sm"><Input type="checkbox" className="size-4" checked={priority} onChange={e=>{setPriority(e.target.checked);page.reset();}}/>Priority only</label><div className="min-w-44"><Select aria-label="Sort job orders" value={sort} onChange={e=>{setSort(e.target.value);page.reset();}}><option value="id_desc">Newest orders</option><option value="due_asc">Due soonest</option><option value="created_desc">Recently created</option></Select></div></form><QueryState query={query} empty={!query.data?.data.length} />{query.data?.data.length > 0 && <DataTable rows={query.data.data} columns={[{
        key: 'id',
        label: 'Order',
        render: r => <Button variant="link" className="h-auto p-0" onClick={() => onNavigate(`/squad/job-work/${r.id}`)}>#{r.id}<ArrowUpRight /></Button>
      }, {
        key: 'due_on',
        label: 'Due',
        render: r => <DateText value={r.due_on} />
      }, {
        key: 'total_quantity',
        label: 'Quantity'
      }, {
        key: 'worker_id',
        label: 'Assignment',
        render: r => r.worker_id ? <span>Job worker #{r.worker_id}{r.factory_manager_id && <Status tone="warning">Factory assignment also present</Status>}</span> : <span className="text-muted-foreground">Not assigned to job work</span>
      }, {
        key: 'worker_status',
        label: 'Status',
        render: r => <Status tone={r.worker_status === 1 ? 'success' : 'neutral'}>{r.worker_status === 1 ? 'Completed' : 'In progress'}</Status>
      }]} />}<Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} /></Panel></div>;
}
function JobDetail({
  sdk,
  identity,
  environment,
  canWrite,
  id,
  onNavigate,
  scott
}) {
  const page = useCursor();
  const query = useOperationQuery([environment, identity.id, 'job-order', id, page.cursor], ({sdk}) => sdk.order(id, {
    cursor: page.cursor,
    limit: 25
  }));
  const role = roleOf(identity);
  const [due, setDue] = useState(''),
    [reason, setReason] = useState('');
  const command = useOperationCommand(canWrite);
  const order = query.data;
  return <div className={scott ? 'sc1-job space-y-4' : 'space-y-5'}><Button variant="ghost" className={scott ? 'sc1-desktop-only' : undefined} onClick={() => onNavigate('/squad/job-work')}><ArrowLeft />Back to job work</Button><PageHeader title={`Order #${id}`} description={order ? `${order.total_quantity} pieces · ${order.worker_id ? 'Assigned job work' : 'No job worker assigned'}` : 'Order details'} /><QueryState query={query} />{order && <>{order.worker_id && order.factory_manager_id && <Panel title="Assignment needs review"><p className="text-sm text-muted-foreground">This source order has both a factory and a job worker assignment. Ask the Production Coordinator to resolve the assignment before recording job work.</p></Panel>}<Panel title="Delivery commitment" description="Due-date changes retain the original commitment and reason."><p className="mb-4 text-sm">Current due date: <DateText value={order.due_on} /></p>{order.worker_id && !order.factory_manager_id && [2, 11].includes(role) && order.worker_due_change_allowed === true && !order.pending_change && <form onSubmit={e => {
          e.preventDefault();
          command.run(JSON.stringify([order.version, due, reason]), key => sdk.saveWorkerDue(id, isoDate(due), requireReason(reason), {
            expectedVersion: order.version,
            idempotencyKey: key
          }));
        }} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="New due date"><Input type="datetime-local" required value={due} onChange={e => setDue(e.target.value)} /></Field><Field label="Reason for change"><Input required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field></div><CommandState command={command} /><Button variant={scott ? 'outline' : undefined} disabled={!canWrite || command.busy} type="submit">Update commitment</Button></form>}{role===11&&order.worker_id&&!order.factory_manager_id&&order.worker_due_change_allowed===false&&<p className="text-sm text-muted-foreground">Your first due-date change is already recorded or this job is complete. Ask the Production Coordinator to review further changes.</p>}</Panel>{order.worker_id&&!order.factory_manager_id&&<WorkerCommitmentHistory key={`${order.id}:${order.version}`} sdk={sdk} identity={identity} environment={environment} order={order} scott={scott}/>} {order.items.data.map(item => <JobItem key={`${item.id}:${item.version}`} scott={scott} sdk={sdk} item={item} role={role} canWrite={canWrite && [2, 11].includes(role) && !!order.worker_id && !order.factory_manager_id} />)}<RatingsPanel sdk={sdk} identity={identity} environment={environment} canWrite={canWrite} entityKind="Order" entityId={order.id} completed={order.status === 1} orderType={order.type} /><Pagination cursor={order.items.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(order.items.next_cursor)} /></>}</div>;
}
function JobItem({
  sdk,
  item,
  role,
  canWrite,
  scott
}) {
  const [stage, setStage] = useState(''),
    [reason, setReason] = useState(''),
    [cost, setCost] = useState(item.worker_unit_cost ?? '');
  const command = useOperationCommand(canWrite);
  const options = workerStageOptions(role, item.worker_stage);
  return <Panel title={`Item #${item.id}`} description={`${item.total_quantity} pieces${item.sample_order ? ' · Sample' : ''}`}><ol aria-label="Job work stages" className={scott ? 'sc1-stages mb-4 grid gap-2' : 'mb-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-6'}>{WORKER_STAGES.map((label, index) => <li key={label} aria-current={item.worker_stage === index ? 'step' : undefined} className={`rounded-lg border p-3 ${index === item.worker_stage ? 'border-primary bg-primary/5' : index < item.worker_stage ? 'bg-muted/40' : 'opacity-70'}`}><div className="mb-2 flex size-6 items-center justify-center rounded-full border text-xs">{index < item.worker_stage ? <Check className="size-3" /> : index + 1}</div><span className="text-xs font-medium">{label}</span></li>)}</ol>{item.worker_stage_changed_at&&<p className="mb-4 text-sm text-muted-foreground">Stage updated: <DateText value={item.worker_stage_changed_at}/></p>}{item.worker_stage == null && <p className="mb-4 text-sm text-muted-foreground">No stage recorded in the source.</p>}{[2, 11].includes(role) && <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify([item.version, stage, reason]), key => {
        if (stage === '') throw new Error('Choose the next stage.');
        return sdk.saveWorkerStage(item.id, Number(stage), requireReason(reason), {
          expectedVersion: item.version,
          idempotencyKey: key
        });
      });
    }}><div className="grid gap-4 sm:grid-cols-2"><Field label={role === 2 ? 'Update stage' : 'Next stage'}><Select value={stage} disabled={!canWrite || command.busy || !options.length} onChange={e => setStage(e.target.value)}><option value="">Choose stage</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field><Field label="Progress note"><Input value={reason} required minLength={3} onChange={e => setReason(e.target.value)} /></Field></div><CommandState command={command} /><Button type="submit" disabled={!canWrite || command.busy || stage === ''}>Save progress<ArrowRight /></Button></form>}{role === 2 && <form className="mt-6 space-y-4 border-t pt-5" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify([item.version, cost, reason]), key => {
        if (!/^\d+(\.\d{1,3})?$/.test(cost) || Number(cost) > 1000000) throw new Error('Enter a cost between 0 and 1,000,000 with at most 3 decimal places.');
        return sdk.saveWorkerCost(item.id, cost, requireReason(reason), {
          expectedVersion: item.version,
          idempotencyKey: key
        });
      });
    }}><div className="grid gap-4 sm:grid-cols-2"><Field label="Worker cost per piece (₹)"><Input inputMode="decimal" required value={cost} onChange={e => setCost(e.target.value)} /></Field><Field label="Cost change reason"><Textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field></div><Button variant="outline" type="submit" disabled={!canWrite || command.busy}>Save worker cost</Button></form>}</Panel>;
}
