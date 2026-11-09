// Business dates follow the same Asia/Kolkata convention as the dashboard labels.
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(`${value}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;}
export function dashboardPeriod(from='',through=''){
  if((from&&!validDate(from))||(through&&!validDate(through)))throw new Error('Choose valid calendar dates.');
  if(from&&through&&from>through)throw new Error('The end date must be on or after the start date.');
  const filters={};if(from)filters.created_from=`${from}T00:00:00+05:30`;
  if(through){const next=new Date(new Date(`${through}T00:00:00Z`).getTime()+86400000).toISOString().slice(0,10);filters.created_before=`${next}T00:00:00+05:30`;}
  return filters;
}
