import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, QueryState, Pagination, useCursor, useOperationQuery } from '../production/OperationsUI';
export default function FactoryScopePicker({
  sdk,
  value,
  onChange
}) {
  const page = useCursor();
  const [search, setSearch] = useState(''),
    [term, setTerm] = useState('');
  const query = useOperationQuery(['report-factories', term, page.cursor], ({sdk}) => sdk.factories(term, {
    cursor: page.cursor,
    limit: 25
  }));
  return <div className="space-y-2"><div className="flex gap-2"><Input aria-label="Search factories" placeholder="Search factories…" value={search} onChange={e => setSearch(e.target.value)} /><Button type="button" variant="outline" onClick={() => {
        setTerm(search.trim());
        page.reset();
      }}>Find</Button></div><Select aria-label="Factory scope" value={value} onChange={e => onChange(e.target.value)}><option value="">All authorized factories</option>{value && !(query.data?.data || []).some(r => r.id === value) && <option value={value}>Factory #{value}</option>}{(query.data?.data || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>{query.error && <QueryState query={query} />}<Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} /></div>;
}
