import React, { useState } from 'react';
import { Surface } from '../../../scott-one-ui';
import { Panel, QueryState, DataTable, DateText, Select, Pagination, useCursor, useOperationQuery } from './OperationsUI';

/** Assignment events and inspected/picked events are distinct, bounded server views. */
export default function WorkHistory({
  sdk,
  itemId,
  scott = false
}) {
  const [view, setView] = useState('assignments');
  const page = useCursor();
  const query = useOperationQuery(['item-work-history', itemId, view, page.cursor], ({sdk}) => view === 'assignments' ? sdk.jobsheets({
    itemId
  }, {
    cursor: page.cursor,
    limit: 25
  }) : sdk.tailorWork({
    itemId,
    history: true
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  const rows = query.data?.data || [];
  const choose = value => {
    setView(value);
    page.reset();
  };
  return <Panel title="Tailor work history" description={scott ? undefined : "Assignments and completed work retain their original recorded dates."} actions={scott ? null : <Select aria-label="Work history type" value={view} onChange={e => {
    setView(e.target.value);
    page.reset();
  }}><option value="assignments">Assignments</option><option value="completed">Inspected / picked</option></Select>}>
    {scott && <Surface skin="core" className="sc1-prod-chips" role="group" aria-label="Work history type">{[['assignments', 'Assignments'], ['completed', 'Inspected / picked']].map(([value, label]) => <button type="button" key={value} className="sc1-rail-chip" aria-pressed={view === value} onClick={() => choose(value)}>{label}</button>)}</Surface>}
    <QueryState query={query} empty={!rows.length} />
    {rows.length > 0 && <DataTable rows={rows} columns={[{
      key: 'occurred_at',
      label: 'Recorded',
      render: r => <DateText value={r.occurred_at} />
    }, {
      key: 'tailor_id',
      label: 'Tailor',
      render: r => `#${r.tailor_id}`
    }, {
      key: 'quantity_id',
      label: 'Size record'
    }, ...(view === 'assignments' ? [{
      key: 'assigned',
      label: 'Assigned'
    }] : []), {
      key: 'inspected',
      label: 'Inspected'
    }, {
      key: 'picked',
      label: 'Picked'
    }]} />}
    <Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} />
  </Panel>;
}
