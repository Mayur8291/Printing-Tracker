import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Select, QueryState, useOperationQuery, useCursor } from '../production/OperationsUI';
export default function ReportScopePicker({
  sdk,
  kind,
  label,
  value,
  onChange
}) {
  const page = useCursor();
  const [search, setSearch] = useState(''),
    [term, setTerm] = useState('');
  const query = useOperationQuery(['report-filter', kind, term, page.cursor], ({sdk}) => kind === 'zone' ? sdk.settings('zones', {
    cursor: page.cursor,
    limit: 25
  }) : kind === 'class' ? sdk.readyMade({
    search: term
  }, null, {
    cursor: page.cursor,
    limit: 25
  }) : sdk.catalogueOptions('brands', null, {
    cursor: page.cursor,
    limit: 25
  }));
  const rows = query.data?.data || [];
  return <div className="space-y-2">{kind === 'class' && <div className="flex gap-2"><Input aria-label="Search product classes" value={search} placeholder="Find product class…" onChange={e => setSearch(e.target.value)} /><Button type="button" variant="outline" onClick={() => {
        setTerm(search.trim());
        page.reset();
      }}>Find</Button></div>}<Field label={label}><Select value={value || ''} onChange={e => onChange(e.target.value)}><option value="">All {label.toLowerCase()}</option>{value && !rows.some(r => r.id === value) && <option value={value}>Selected #{value}</option>}{rows.map(row => <option key={row.id} value={row.id}>{row.name || `#${row.id}`}</option>)}</Select></Field>{query.error && <QueryState query={query} />}<div className="flex gap-2">{page.hasPrevious && <Button type="button" variant="ghost" size="sm" onClick={page.previous}>Previous options</Button>}{query.data?.next_cursor && <Button type="button" variant="ghost" size="sm" onClick={() => page.next(query.data.next_cursor)}>More options</Button>}</div></div>;
}
