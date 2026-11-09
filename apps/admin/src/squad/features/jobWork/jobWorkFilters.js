// The original JobWorker tabs follow worker_status, which can differ from the
// general order status in migrated records. Never infer it from the latter.
export function jobWorkFilters({state='pending',search='',priority=false,sort='id_desc'}={}){
 if(!['pending','completed'].includes(state))throw new Error('Choose a job work status.');
 if(!['id_desc','created_desc','due_asc'].includes(sort))throw new Error('Choose an order sort.');
 return {worker_status:state==='completed'?1:0,assignment_kind:'job_worker',search:search.trim(),...(priority?{prime:true}:{}),...(sort!=='id_desc'?{sort}:{})};
}
