/** Positive policy for the final existing-staff Tracker smoke, not Squad access.
 * The caller must separately disable WebSocket transport before navigation.
 * Unknown reads fail closed; do not broaden this from observed failures alone. */
export const STAGING = 'https://scvojtvgnkmbupvyslmb.supabase.co';
const TABLES = new Set('profiles admin_emails orders outward_challans contact_book_entries owners coordinators sales_incharges profile_order_permissions hr_user_presence team_chat_conversation_members team_chat_messages team_chat_message_reactions team_chat_conversations order_assignment_notifications enquiry_assignment_notifications inward_entry_notifications printing_dept_inventory_notifications user_goal_task_notifications order_status_notifications ops_briefing_notifications'.split(' '));
const AUTO_WRITES = new Set(['set_my_dashboard_presence', 'promote_stale_new_orders_to_pending']);
// Existing Tracker startup helpers, reviewed against their exact source selects.
// These are deliberately not general-purpose table allowances.
function auxiliaryRead(table,params){
 const keys=[...params.keys()];if(new Set(keys).size!==keys.length)return false;
 const select=(params.get('select')??'').replace(/\s/g,'');
 if(table==='support_admins')return keys.length===1&&select==='user_id';
 if(table==='sample_job_sheet_settings')return keys.length===2&&select==='default_sla_days,default_sla_hours,warn_hours,urgent_hours'&&params.get('id')==='eq.1';
 if(table==='inventory_skus')return keys.length===4&&keys.every(k=>['select','order','offset','limit'].includes(k))&&select==='id,sku_code,kind,name,color,hex_color,stock_qty,reorder_point,unit,unit_cost,supplier_id,warehouse_id,extra'&&params.get('order')==='name.asc,sku_code.asc'&&params.get('limit')==='1000'&&/^(0|[1-9]\d*)$/.test(params.get('offset')??'')&&Number.isSafeInteger(Number(params.get('offset')))&&Number(params.get('offset'))%1000===0;
 return false;
}
export function approvedFrontend(base) {
  let u; try { u = new URL(base); } catch { return false; }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return false;
  return (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) ||
    (u.protocol === 'https:' && (u.hostname === 'scottdashboard.vercel.app' || /^scottdashboard-[a-z0-9-]+-mayur8291s-projects\.vercel\.app$/.test(u.hostname)));
}
export function trackerReadDecision({url, method, body, headers = {}}, base) {
  if (!approvedFrontend(base)) return 'deny';
  let u; try { u = new URL(url); } catch { return 'deny'; }
  if (u.username || u.password) return 'deny';
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) return ['GET', 'HEAD'].includes(method) ? 'local' : 'deny';
  if (u.origin === new URL(base).origin) return ['GET', 'HEAD'].includes(method) ? 'local' : 'deny';
  if (u.origin !== STAGING) return 'deny';
  const p = u.pathname, h = Object.fromEntries(Object.entries(headers).map(([k,v]) => [k.toLowerCase(),v]));
  if (method === 'OPTIONS') return 'preflight'; // Preflight cannot authorize the subsequent operation.
  if (p === '/auth/v1/user' && method === 'GET') return 'identity';
  // Password/refresh/logout operations are deliberately parent-owned, outside this read browser.
  if (p.startsWith('/rest/v1/') && !p.includes('/rpc/') && ['GET', 'HEAD'].includes(method)) {
    const table = p.slice('/rest/v1/'.length);
    return (TABLES.has(table)||auxiliaryRead(table,u.searchParams)) && (!h['accept-profile'] || h['accept-profile'] === 'public') ? 'read' : 'deny';
  }
  let payload; try { payload = JSON.parse(body ?? '{}'); } catch { return 'deny'; }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return 'deny';
  if (p.startsWith('/rest/v1/rpc/') && method === 'POST') {
    const rpc = p.slice('/rest/v1/rpc/'.length);
    if (AUTO_WRITES.has(rpc)) return 'blocked-automatic-write';
    if (rpc === 'list_team_chat_directory' && (!h['content-profile'] || h['content-profile'] === 'public') && Object.keys(payload).length === 0) return 'read';
    if (h['content-profile'] !== 'canto_api') return 'deny';
    if (rpc === 'dashboard' && ['capabilities', 'query', 'customer_options', 'export_read'].includes(payload.p_action)) return 'read';
    if (rpc === 'masters' && payload.resource === 'authorized_brands' && ['list', 'get'].includes(payload.action)) return 'read';
    if (rpc === 'media_status' && Object.keys(payload).length === 0) return 'read';
  }
  if (p === '/functions/v1/canto-refresh' && method === 'POST' && payload.action === 'status' && payload.environment === 'staging' && Object.keys(payload).every(k => ['action', 'environment'].includes(k))) return 'read';
  if (p === '/storage/v1/object/sign/canto-media' && method === 'POST' && Number.isInteger(payload.expiresIn) && payload.expiresIn > 0 && payload.expiresIn <= 3600 && Array.isArray(payload.paths) && payload.paths.length > 0 && payload.paths.length <= 100 && payload.paths.every(path => typeof path === 'string' && path.length <= 1024 && !path.startsWith('/') && !path.includes('..') && !path.includes('://'))) return 'read';
  if (p.startsWith('/storage/v1/object/sign/canto-media/') && method === 'GET') return 'read';
  return 'deny';
}
