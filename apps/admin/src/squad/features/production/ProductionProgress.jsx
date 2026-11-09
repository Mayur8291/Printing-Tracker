import React from 'react';
import { Panel, QueryState, Status, useOperationQuery, DateText } from './OperationsUI';
export default function ProductionProgress({
  sdk,
  orderId
}) {
  const query = useOperationQuery(['production-progress', orderId], ({sdk}) => sdk.productionProgress(orderId));
  const p = query.data;
  return <Panel title="Order progress" description="Combined progress across this order's items."><QueryState query={query} />{p && <>
  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Cut', p.cut, p.cut_complete], ['Assigned', p.assigned, p.assigned_complete], ['Inspected / picked', p.sewn, p.sewn_complete], ['Dispatched', p.dispatched, p.dispatch_complete]].map(([label, value, complete]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value ?? '—'}</dd><Status tone={complete ? 'success' : 'neutral'}>{complete ? 'Complete' : 'In progress'}</Status></div>)}</dl>
  <p className="mt-4 text-xs text-muted-foreground">{p.item_count} items · Updated <DateText value={p.as_of} /></p>
 </>}</Panel>;
}
