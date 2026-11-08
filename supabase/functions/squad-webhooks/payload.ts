/** Existing dashboard-stock-api event contract, with bounded strict validation. */
export class WebhookError extends Error {constructor(readonly code:string,readonly status:number){super(code);}}
export type DashboardEventType='order.status_changed'|'stock.level_changed'|'stock.low_threshold';
export type OrderStatus='CREATED'|'PENDING'|'PROCESSING'|'COMPLETE'|'CANCELLED'|'FAILED';
export type DashboardEvent={event:DashboardEventType;event_id:string;occurred_at:string}&Record<string,unknown>;
export const EVENT_TYPES:DashboardEventType[]=['order.status_changed','stock.level_changed','stock.low_threshold'];
const statuses:OrderStatus[]=['CREATED','PENDING','PROCESSING','COMPLETE','CANCELLED','FAILED'];
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new WebhookError('INVALID_EVENT',400);return value as Record<string,unknown>;}
function fields(value:Record<string,unknown>,allowed:string[]){if(Object.keys(value).some(k=>!allowed.includes(k)))throw new WebhookError('INVALID_EVENT',400);}
function text(value:unknown,min:number,max:number){if(typeof value!=='string'||value.length<min||value.length>max||value.trim()!==value||/[\u0000-\u001f\u007f]/u.test(value))throw new WebhookError('INVALID_EVENT',400);return value;}
function date(value:unknown,now:number){const v=text(value,20,35),match=v.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/);if(!match||!Number.isFinite(Date.parse(v))||Date.parse(v)>now+60000||new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10)!==match[1])throw new WebhookError('INVALID_EVENT_TIME',400);return v;}
function amount(value:unknown,nonnegative=false){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12||nonnegative&&value<0||Math.abs(value*100-Math.round(value*100))>.001)throw new WebhookError('INVALID_EVENT',400);}
function stockRows(value:unknown,kind:'change'|'low'){
 if(!Array.isArray(value)||value.length<1||value.length>250)throw new WebhookError('INVALID_EVENT',400);const seen=new Set<string>();
 for(const entry of value){const row=object(entry);fields(row,kind==='change'?['sku_code','previous_stock','current_stock']:['sku_code','available','threshold']);const sku=text(row.sku_code,1,200);if(seen.has(sku))throw new WebhookError('INVALID_EVENT',400);seen.add(sku);
  if(kind==='change'){amount(row.previous_stock);amount(row.current_stock);}else{amount(row.available);amount(row.threshold,true);}
 }
}
export function dashboardEvent(value:unknown,now=Date.now(),expected?:DashboardEventType):DashboardEvent {
 const event=object(value),kind=event.event as DashboardEventType;
 if(!EVENT_TYPES.includes(kind)||expected&&kind!==expected)throw new WebhookError('INVALID_EVENT',400);
 const common=['event','event_id','occurred_at'];
 if(typeof event.event_id!=='string'||!/^evt_([a-f0-9]{12}|[a-f0-9]{32})$/.test(event.event_id))throw new WebhookError('INVALID_EVENT',400);
 date(event.occurred_at,now);
 if(kind==='order.status_changed'){
  fields(event,[...common,'dashboard_order_id','order_code','previous_status','status','dispatched_at']);
  if(!/^ord_[a-zA-Z0-9_-]{1,76}$/.test(text(event.dashboard_order_id,5,80)))throw new WebhookError('INVALID_EVENT',400);
  text(event.order_code,1,200);if(!statuses.includes(event.status as OrderStatus)||event.previous_status!==null&&!statuses.includes(event.previous_status as OrderStatus))throw new WebhookError('INVALID_EVENT',400);
  if(event.status==='CREATED'&&event.previous_status!==null)throw new WebhookError('INVALID_EVENT',400);
  if(event.dispatched_at!==undefined){if(event.status!=='COMPLETE')throw new WebhookError('INVALID_EVENT',400);date(event.dispatched_at,now);}
 }else{
  fields(event,[...common,'facility_code',...(kind==='stock.level_changed'?['trigger','changed_skus']:['low_stock_items'])]);
  if(!/^[a-zA-Z0-9_.:-]+$/.test(text(event.facility_code,1,128)))throw new WebhookError('INVALID_EVENT',400);
  if(kind==='stock.level_changed'){if(!['RESERVATION','RELEASE','FULFILLMENT','ADJUST'].includes(String(event.trigger)))throw new WebhookError('INVALID_EVENT',400);stockRows(event.changed_skus,'change');}else stockRows(event.low_stock_items,'low');
 }
 return event as DashboardEvent;
}
