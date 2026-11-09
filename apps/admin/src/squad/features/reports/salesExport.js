import { csvCell } from './reportModel.js';
export const EXPORT_LIMITS = Object.freeze({
  pageSize: 100,
  maxRows: 25000,
  maxBytes: 16 * 1024 * 1024
});
const cell = (key, label = key) => ({
  key,
  label,
  value: r => r[key]
});
export function exportColumns(kind) {
  if (kind === 'unique_customers') return ['total_unique_customers', 'custom_order_customers', 'rmp_order_customers', 'mixed_order_customers'].map(key => cell(key));
  if (kind === 'customer_directory') return [cell('id', 'Customer ID'), cell('name', 'Name'), cell('company_name', 'Company'), cell('email', 'Email'), cell('phone', 'Phone'), cell('approved', 'Approved'), cell('onboarded', 'Onboarded'), {
    key: 'coordinator',
    label: 'Coordinator',
    value: r => r.coordinator?.name
  }, {
    key: 'zone',
    label: 'Zone',
    value: r => r.zone?.name
  }, {
    key: 'address',
    label: 'Address',
    value: r => [r.address?.address, r.address?.city, r.address?.state, r.address?.zip_code].filter(Boolean).join(', ')
  }, cell('last_order_at', 'Last order')];
  if (['order_items', 'custom_items', 'rmp_items'].includes(kind)) return [cell('id', 'Item ID'), cell('order_id', 'Order ID'), {
    key: 'customer',
    label: 'Customer',
    value: r => r.customer?.name
  }, {
    key: 'product',
    label: 'Product',
    value: r => r.product?.name || r.class?.name
  }, {
    key: 'brand',
    label: 'Brand',
    value: r => r.brand?.name
  }, cell('ordered_at', 'Ordered'), cell('due_at', 'Due'), cell('quantity', 'Quantity'), cell('subtotal', 'Subtotal'), cell('branding', 'Branding'), cell('tax', 'Tax'), cell('gross', 'Gross'), cell('provider_status', 'Provider status'), cell('quantity_needs_reconciliation', 'Quantity needs review'), {
    key: 'sizes',
    label: 'Sizes',
    value: r => (r.sizes || []).map(s => `${s.name || s.size_id}: ${s.quantity}`).join('; ')
  }, cell('sizes_truncated', 'Additional sizes not included'), cell('remark_truncated', 'Additional remark not included')];
  return [cell('id', 'Record ID'), cell('name', 'Name'), cell('orders', 'Orders'), cell('quantity', 'Quantity'), cell('subtotal', 'Subtotal'), cell('branding', 'Branding'), cell('tax', 'Tax'), cell('gross', 'Gross'), cell('closed_quantity', 'Closed quantity'), cell('closed_subtotal', 'Closed subtotal'), cell('fill_rate', 'Fill rate (%)'), cell('previous_quantity', 'Previous quantity'), cell('previous_subtotal', 'Previous subtotal'), cell('quantity_growth_percent', 'Quantity growth (%)'), cell('subtotal_growth_percent', 'Subtotal growth (%)'), cell('needs_reconciliation', 'Needs review')];
}
export function newExportState(kind, period, filters) {
  const columns = exportColumns(kind);
  const header = '\uFEFF' + columns.map(c => csvCell(c.label)).join(',') + '\r\n';
  return {
    kind,
    period: {
      ...period
    },
    filters: {
      ...filters
    },
    columns,
    cursor: null,
    rows: 0,
    bytes: new TextEncoder().encode(header).byteLength,
    chunks: [header],
    complete: false,
    started: false,
    seenCursors: new Set()
  };
}
/** Report cursors are server-bound to actor, generation, filters and edit revision.
 * Keep completed pages only to resume uncertain reads; no partial download is published. */
function abortableRead(promise,signal){
 if(signal?.aborted)return Promise.reject(new DOMException('Export cancelled.','AbortError'));
 return new Promise((resolve,reject)=>{const cancel=()=>{cleanup();reject(new DOMException('Export cancelled.','AbortError'));};const timeout=setTimeout(()=>{cleanup();reject(new Error('Report request timed out. Resume the export to retry this page.'));},30000);const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);};signal?.addEventListener('abort',cancel,{once:true});promise.then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)});});
}
export async function continueSalesExport(sdk, state, {
  signal,
  isCurrent = () => true,
  onProgress = () => {},
  limits = EXPORT_LIMITS
} = {}) {
  const check = () => {
    if (signal?.aborted || !isCurrent()) throw new DOMException('Export cancelled because the report or account changed.', 'AbortError');
  };
  while (!state.complete) {
    check();
    const page = await abortableRead(sdk.salesReport(state.kind, state.period, state.filters, {
      cursor: state.cursor,
      limit: limits.pageSize
    }),signal);
    check();
    if (Array.isArray(page.data)&&page.data.length===0&&page.next_cursor)throw new Error('Report response is incomplete. No file was produced.');
    if (!Array.isArray(page.data) || !page.period?.from || !page.period?.before) throw new Error('Report response is incomplete. No file was produced.');
    if (state.started && (state.period.from !== page.period.from || state.period.before !== page.period.before)) throw new Error('Report period changed. Restart the export.');
    const rows = state.kind === 'unique_customers' ? [page.summary] : page.data;
    const chunk = rows.map(row => state.columns.map(column => csvCell(column.value(row))).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
    const bytes = new TextEncoder().encode(chunk).byteLength;
    if (state.rows + rows.length > limits.maxRows || state.bytes + bytes > limits.maxBytes) throw new Error(`This export exceeds ${limits.maxRows.toLocaleString()} rows or ${Math.round(limits.maxBytes / 1048576)} MB. Narrow the filters; no partial file was produced.`);
    if (page.next_cursor && state.seenCursors.has(page.next_cursor)) throw new Error('The report cursor repeated. Restart the export.');
    // Commit a page only after every validation so a retry never duplicates it.
    state.period = {
      from: page.period.from,
      before: page.period.before
    };
    state.started = true;
    state.rows += rows.length;
    state.bytes += bytes;
    state.chunks.push(chunk);
    state.cursor = page.next_cursor || null;
    state.complete = !state.cursor;
    if (state.cursor) state.seenCursors.add(state.cursor);
    onProgress({
      rows: state.rows,
      bytes: state.bytes,
      complete: state.complete
    });
  }
  check();
  return new Blob(state.chunks, {
    type: 'text/csv;charset=utf-8'
  });
}
