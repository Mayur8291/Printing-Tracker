import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CommandDialog } from '@/squad/components';
import { Panel, QueryState, DataTable, Status, DateText, Field, Pagination, CommandState, useCursor, useOperationQuery, useOperationCommand } from '../production/OperationsUI';
import PersonPicker from '../production/PersonPicker';
import { roleOf, requireReason } from '../production/operationsModel';
export default function StockReconciliationPanel(props) {
  const [dealer, setDealer] = useState('');
  if (roleOf(props.identity) !== 0) return <QueryState query={{
    error: new Error('Stock reconciliation requires an administrator.')
  }} />;
  return <div className="space-y-5"><Panel title="Dealer stock reconciliation" description="Review receipt evidence and correct only counters the server identifies as safe to rebuild."><PersonPicker sdk={props.sdk} role={10} value={dealer} onChange={setDealer} label="Dealer" /></Panel>{dealer && <DealerReview key={dealer} {...props} dealerId={dealer} />}</div>;
}
function DealerReview({
  sdk,
  dealerId,
  canWrite
}) {
  const page = useCursor();
  const [receipt, setReceipt] = useState(''),
    [filter, setFilter] = useState(''),
    [tab, setTab] = useState('review'),
    [selected, setSelected] = useState(null),
    [reason, setReason] = useState('');
  const query = useOperationQuery(['stock-reconciliation', dealerId, filter, tab, page.cursor], ({sdk}) => tab === 'review' ? sdk.reviewStock(dealerId, filter ? {
    receipt_id: filter
  } : {}, {
    cursor: page.cursor,
    limit: 25
  }) : sdk.stockReconciliationHistory(dealerId, filter || null, {
    cursor: page.cursor,
    limit: 25
  }));
  const command = useOperationCommand(canWrite, () => {
    setSelected(null);
    setReason('');
  });
  const rows = query.data?.data || [];
  return <Panel title={tab === 'review' ? 'Receipt evidence' : 'Counter correction history'} description={tab === 'review' ? 'Only the current page is summarized. Missing or conflicting source evidence requires manual review.' : 'Every correction retains its reason and before/after values.'} actions={<div className="flex gap-2">{['review', 'history'].map(t => <Button key={t} variant={tab === t ? 'default' : 'outline'} disabled={command.busy} onClick={() => {
      setTab(t);
      page.reset();
    }}>{t === 'review' ? 'Review' : 'History'}</Button>)}</div>}>
  <form className="mb-4 flex max-w-md gap-2" onSubmit={e => {
      e.preventDefault();
      setFilter(receipt.trim());
      page.reset();
    }}><Input aria-label="Receipt number" placeholder="Receipt number (optional)" pattern="[0-9]*" value={receipt} onChange={e => setReceipt(e.target.value)} /><Button variant="outline">Filter</Button></form>
  <QueryState query={query} empty={!rows.length} />
  {query.data?.summary_scope === 'current_page' && <p className="mb-4 text-sm text-muted-foreground">{query.data.requires_review} receipts need review on this page.</p>}
  {rows.length > 0 && <DataTable rows={rows} columns={tab === 'review' ? [{
      key: 'id',
      label: 'Receipt',
      render: r => `#${r.id}`
    }, {
      key: 'order_id',
      label: 'Order'
    }, {
      key: 'size_id',
      label: 'Size record'
    }, {
      key: 'received',
      label: 'Received'
    }, {
      key: 'consumed',
      label: 'Evidence consumed'
    }, {
      key: 'counter',
      label: 'Stored counter'
    }, {
      key: 'issues',
      label: 'Review',
      render: r => <div className="space-y-1"><Status tone={r.status === 'ready' ? 'success' : 'warning'}>{r.status === 'ready' ? 'Ready' : 'Needs review'}</Status>{r.issues.map(issue => <p className="text-xs text-muted-foreground" key={issue}>{issue.replaceAll('_', ' ')}</p>)}</div>
    }, {
      key: 'action',
      label: 'Action',
      render: r => r.safe_action === 'rebuild_counter' ? <Button variant="outline" disabled={!canWrite || command.busy} onClick={() => {
        setSelected(r);
        setReason('');
      }}>Review correction</Button> : <span className="text-xs text-muted-foreground">{r.status === 'ready' ? 'No correction needed' : 'Source review required'}</span>
    }] : [{
      key: 'receipt_id',
      label: 'Receipt'
    }, {
      key: 'created_at',
      label: 'Corrected',
      render: r => <DateText value={r.created_at} />
    }, {
      key: 'before',
      label: 'Before'
    }, {
      key: 'after',
      label: 'After'
    }, {
      key: 'reason',
      label: 'Reason'
    }]} />}
  <CommandState command={command} /><Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} />
  <CommandDialog open={!!selected} onOpenChange={open => {
      if (!open && !command.busy) setSelected(null);
    }} title="Rebuild stock counter" description="This corrects the stored consumed counter using verified dispatch evidence. It does not add or remove stock receipts." pending={command.busy} error={command.error} submitLabel="Rebuild counter" disabled={!canWrite || reason.trim().length < 3} onSubmit={() => command.run(JSON.stringify([dealerId, selected?.id, selected?.version, reason]), key => sdk.rebuildStockCounters(dealerId, [{
      id: selected.id,
      expectedVersion: selected.version
    }], requireReason(reason), key))}>
   {selected && <><p className="text-sm">Receipt #{selected.id}: <strong>{selected.counter ?? 'Unknown'}</strong> → <strong>{selected.consumed}</strong> consumed pieces.</p><Field label="Reason" required><Textarea value={reason} minLength={3} required onChange={e => setReason(e.target.value)} /></Field></>}
  </CommandDialog>
 </Panel>;
}
