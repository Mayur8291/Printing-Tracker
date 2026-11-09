import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, useOperationQuery, useCursor, QueryState } from './OperationsUI';
export default function PersonPicker({
  sdk,
  role,
  value,
  onChange,
  label = 'Person',
  disabled
}) {
  const [search, setSearch] = useState(''),
    [term, setTerm] = useState('');
  const page = useCursor();
  const query = useOperationQuery(['operations-people', role, term, page.cursor], ({sdk}) => sdk.people({
    role,
    search: term,
    disabled: false
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  return <div className="space-y-2"><div className="flex gap-2"><Input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={e => setSearch(e.target.value)} disabled={disabled} /><Button type="button" variant="outline" disabled={disabled} onClick={() => {
        page.reset();
        setTerm(search.trim());
      }}>Find</Button></div><Select aria-label={label} value={value} onChange={e => onChange(e.target.value)} disabled={disabled || query.loading}><option value="">Choose {label.toLowerCase()}</option>{value && !(query.data?.data || []).some(p => p.id === value) && <option value={value}>Selected {label.toLowerCase()} #{value}</option>}{(query.data?.data || []).map(p => <option key={p.id} value={p.id}>{p.name || p.company_name || `Person #${p.id}`}</option>)}</Select>{query.error && <QueryState query={query} />}<div className="flex gap-2">{page.hasPrevious && <Button type="button" variant="ghost" size="sm" onClick={page.previous}>Previous results</Button>}{query.data?.next_cursor && <Button type="button" variant="ghost" size="sm" onClick={() => page.next(query.data.next_cursor)}>More results</Button>}</div></div>;
}
