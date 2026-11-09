import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader as SharedPageHeader, SectionCard, StatusBadge, DataTable as SharedDataTable, Field as SharedField } from '@/squad/components';
import { remainingQuantity } from './operationsModel';
import { useSquadQuery, useSquadCommand } from '@/squad/data/hooks';
export function useOperationQuery(key, load, options = {}) {
  const q = useSquadQuery(key, load, options);
  return {
    ...q,
    loading: q.isLoading,
    refresh: q.refetch
  };
}
export function useOperationCommand(canWrite, onSuccess) {
  const command = useSquadCommand();
  const [success, setSuccess] = useState(null);
  const [result, setResult] = useState(null);
  return {
    busy: command.pending,
    error: command.error,
    success,
    result,
    async run(signature, execute) {
      setSuccess(null);
      setResult(null);
      try {
        const result = await command.run(c => {
          if (!canWrite) throw new Error('This action is not available in the current workspace.');
          return execute(c.idempotencyKey);
        }, {
          key: 'operations',
          payload: signature
        });
        setSuccess('Changes saved.');
        setResult(result);
        onSuccess?.(result);
        return result;
      } catch {
        return undefined;
      }
    }
  };
}
export function PageHeader({
  children,
  ...props
}) {
  return <SharedPageHeader {...props} actions={children} />;
}
export function Panel(props) {
  return <SectionCard {...props} />;
}
export function QueryState({
  query,
  empty = false
}) {
  if (query.loading) return <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading workspace…</div>;
  if (query.error) return <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><span className="flex items-center gap-2"><AlertCircle className="size-4 shrink-0" />{query.error.message || 'Unable to load this workspace.'}</span><Button variant="outline" onClick={query.refresh}>Retry</Button></div>;
  if (empty) return <div className="flex min-h-44 flex-col items-center justify-center text-center"><div className="mb-3 rounded-xl border bg-muted/40 p-3"><Inbox className="size-5 text-muted-foreground" /></div><p className="font-medium">Nothing here yet</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">There is no work matching this view in your scope.</p></div>;
  return null;
}
export function CommandState({
  command
}) {
  return <>{command.error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{command.error.message}</p>}{command.success && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" />{command.success}</p>}{command.result?.stock_receipt?.received > 0 && <p className="text-sm text-muted-foreground">{command.result.stock_receipt.received} stock receipt records created.</p>}{command.result?.stock_receipt?.state === 'awaiting_completion' && <p className="text-sm text-muted-foreground">Dealer stock will be received when the purchase order is complete.</p>}{command.result?.stock_allocations?.length > 0 && <div className="text-sm text-muted-foreground"><p>Stock used for this delivery:</p><ul className="mt-1 list-inside list-disc">{command.result.stock_allocations.map(r => <li key={r.id}>Receipt #{r.receipt_id}: {r.quantity} pieces</li>)}</ul></div>}</>;
}
export function ReadOnlyNote({
  canWrite
}) {
  return canWrite ? null : <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">This workspace is available for viewing. Changes have not been enabled.</p>;
}
export function Field(props) {
  return <SharedField {...props} />;
}
export function Select({
  children,
  ...props
}) {
  return <select {...props} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{children}</select>;
}
export function Pagination({
  cursor,
  onNext,
  onPrevious,
  hasPrevious,
  loading
}) {
  return <div className="mt-4 flex items-center justify-between border-t pt-4"><span className="text-xs text-muted-foreground">25 records per page</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={!hasPrevious || loading} onClick={onPrevious}><ArrowLeft />Previous</Button><Button type="button" variant="outline" size="sm" disabled={!cursor || loading} onClick={onNext}>Next<ArrowRight /></Button></div></div>;
}
export function useCursor() {
  const [stack, setStack] = useState([null]);
  return {
    cursor: stack.at(-1),
    hasPrevious: stack.length > 1,
    next: value => {
      if (value) setStack(s => [...s, value]);
    },
    previous: () => setStack(s => s.length > 1 ? s.slice(0, -1) : s),
    reset: () => setStack([null])
  };
}
export function DateText({
  value
}) {
  return value ? <time dateTime={value}>{new Date(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })}</time> : <span className="text-muted-foreground">Not set</span>;
}
export function Status({
  children,
  tone = 'neutral'
}) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}
export function DataTable({
  columns,
  rows,
  rowKey = 'id'
}) {
  return <SharedDataTable columns={columns.map(c => ({
    ...c,
    render: c.render ? (_, row) => c.render(row) : undefined
  }))} rows={rows} getRowKey={row => row[rowKey]} />;
}
export function QuantityEditor({
  rows,
  values,
  onChange,
  mode,
  disabled
}) {
  return <DataTable rows={rows} columns={[{
    key: 'size',
    label: mode === 'inspection' ? 'Assignment' : 'Size',
    render: r => r.size_name || `#${r.id}`
  }, {
    key: 'planned',
    label: mode === 'inspection' ? 'Assigned' : 'Planned',
    render: r => r.quantity ?? r.assigned
  }, {
    key: 'remaining',
    label: 'Available',
    render: r => remainingQuantity(r, mode)
  }, {
    key: 'entry',
    label: 'Quantity to record',
    render: r => <Input aria-label={`Quantity for ${r.size_name || r.id}`} type="number" inputMode="numeric" min="0" step="1" max={remainingQuantity(r, mode)} className="w-28" value={values[r.id] ?? ''} disabled={disabled || remainingQuantity(r, mode) === 0} onChange={e => onChange({
      ...values,
      [r.id]: e.target.value
    })} />
  }]} />;
}
export function RefreshButton({
  onClick,
  disabled
}) {
  return <Button type="button" variant="outline" onClick={onClick} disabled={disabled}><RefreshCw />Refresh</Button>;
}
