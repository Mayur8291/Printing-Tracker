export const WORKER_STAGES = ['Fabric ordered', 'In cutting', 'In branding', 'In stitching', 'Ready for dispatch', 'Dispatched'];
export function roleOf(identity) {
  return Number(identity?.role ?? identity?.me?.role);
}
export function routeId(path) {
  const last = String(path || '').split('?')[0].split('/').filter(Boolean).at(-1);
  return /^\d+$/.test(last || '') ? last : null;
}
export function quantityRows(rows, values, mode) {
  const result = [];
  for (const row of rows) {
    const raw = String(values[row.id] ?? '').trim();
    if (!raw || raw === '0') continue;
    if (!/^\d+$/.test(raw)) throw new Error('Enter whole, positive quantities.');
    const quantity = Number(raw),
      max = remainingQuantity(row, mode);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > max) throw new Error(`Quantity for ${row.size_name || row.id} must be between 1 and ${max}.`);
    result.push({
      [mode === 'inspection' ? 'item_tailor_quantity_id' : 'quantity_id']: String(row.id),
      quantity
    });
  }
  if (!result.length) throw new Error('Enter at least one quantity to record.');
  return result;
}
export function remainingQuantity(row, mode) {
  const value = mode === 'cutting' ? Number(row.quantity) - Number(row.cut) : mode === 'assignment' ? Number(row.cut) - Number(row.assigned) : mode === 'inspection' ? Number(row.assigned) - Number(row.inspected) : Number(row.remaining);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function requireReason(reason) {
  if (reason.trim().length < 3) throw new Error('Add a reason with at least 3 characters.');
  return reason.trim();
}
export function isoDate(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error('Choose a valid date and time.');
  return parsed.toISOString();
}
export function workerStageOptions(role, current) {
  return WORKER_STAGES.map((label, value) => ({
    label,
    value
  })).filter(x => role === 2 ? x.value !== current : x.value === (current ?? 0) + 1);
}
