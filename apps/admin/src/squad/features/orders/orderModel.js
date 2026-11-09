export const ORDER_STATES = [['pending', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['overdue', 'Overdue'], ['critical', 'Critical']];
export const ORDER_TYPES = {0: 'Ready-made', 1: 'Custom', 2: 'Mixed'};
export function orderState(order) {
  if (order.provider_status === 'CANCELLED') return 'Cancelled';
  if (order.status === 1) return 'Completed';
  return 'In progress';
}
export function orderActions(identity, order) {
  const role = Number(identity.role), open = orderState(order) === 'In progress' && !order.pending_change;
  return {
    priority: !order.pending_change && order.provider_status!=='CANCELLED' && [0, 1, 2].includes(role), due: open && [0, 1, 2].includes(role),
    payment: role === 1 && !order.pending_change && order.provider_status !== 'CANCELLED',
    cancel: open && Number(order.dispatched_quantity) === 0 && (role === 1 || (role === 10 && String(order.customer_id) !== String(identity.id))),
    delete: open && role === 1 && Number(order.dispatched_quantity) === 0,
    complete: open && role === 0,
    edit: open && role === 1 && Number(order.dispatched_quantity) === 0,
    destination: open && [0, 1, 2, 7].includes(role),
  };
}
export function money(value) {
  if (value === null || value === undefined) return '—';
  // Formatting only; calculations and mutation amounts remain server-owned decimal strings.
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 2}).format(amount) : '—';
}
export function dateLabel(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'}).format(date);
}
export function paymentAmount(status, amount, total) {
  if (status === 'paid') return String(total);
  if (status === 'unpaid') return '0';
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) >= Number(total)) throw new Error('Enter a partial payment greater than zero and below the order total.');
  return amount;
}
