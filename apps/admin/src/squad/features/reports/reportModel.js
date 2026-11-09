export const SALES_REPORTS = [['customers', 'Customer sales'], ['unique_customers', 'Unique customers'], ['brands', 'Brand sales'], ['classes', 'Product class sales'], ['coordinators', 'Coordinator sales'], ['customer_directory', 'Customer directory'], ['order_items', 'All order items'], ['custom_items', 'Custom items'], ['rmp_items', 'Ready-made items']];
export function reportTabs(role) {
  return [...(role === 0 ? [['sales', 'Sales reports']] : []), ...([0, 1, 2].includes(role) ? [['coordinator', 'Coordinator performance']] : []), ...([0, 2, 4, 7, 8, 9, 11].includes(role) ? [['work', 'Work performance']] : []), ...([0, 2, 4, 7, 8].includes(role) ? [['leaderboard', 'Tailor leaderboard']] : []), ...([0, 2, 4].includes(role) ? [['earnings', 'Tailor earnings']] : [])];
}
export function reportPeriod(from, before) {
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from) || before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('Choose valid report dates.');
  for (const value of [from,before].filter(Boolean)) { const parsed=new Date(value+'T00:00:00Z'); if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value) throw new Error('Choose valid report dates.'); }
  if(from&&before&&(new Date(before)-new Date(from))/86400000>366) throw new Error('Choose a report period of at most 366 days.');
  if (from && before && from >= before) throw new Error('The end date must follow the start date.');
  return {
    ...(from ? {
      from
    } : {}),
    ...(before ? {
      before
    } : {})
  };
}
export function indiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function todayReportPeriod(now = new Date()) {
  const from = indiaDate(now);
  const tomorrow = new Date(from + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {from, before: tomorrow.toISOString().slice(0, 10)};
}
export function validateWeek(value) {
  if (!value) return undefined;
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 6 || value > indiaDate()) throw new Error('Choose a Saturday on or before today.');
  return value;
}
export function salesFilters(values) {
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '' || value === null || value === undefined) continue;
    if (key === 'customer_role') {
      if (!['3', '10', 3, 10].includes(value)) throw new Error('Choose a customer type.');
      result[key] = Number(value);
    } else if (key.endsWith('_id')) {
      if (!/^[1-9]\d*$/.test(String(value))) throw new Error('Record numbers must contain positive digits only.');
      result[key] = String(value);
    } else result[key] = value;
  }
  return result;
}
export function signedDownloadUrl(value, expectedOrigin) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || expectedOrigin && (url.origin !== new URL(expectedOrigin).origin || !/^\/storage\/v1\/object\/sign\/(squad-documents|canto-media)\//.test(url.pathname)) || url.pathname.includes('\\')) throw new Error('The download link is not secure. Request a new link.');
  return url.href;
}
export function csvCell(value) {
  const raw = value == null ? '' : String(value);
  const safe = /^(?:[=+@\-\t\r]|\s+[=+@\-])/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}
