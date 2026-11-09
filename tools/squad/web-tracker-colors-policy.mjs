import {trackerReadDecision,STAGING} from './web-tracker-read-policy.mjs';
const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===expected.slice().sort().join(',');
export function colorsDecision(request,base,scope){
 const ordinary=trackerReadDecision(request,base);
 if(ordinary!=='deny')return ordinary;
 let u,b;try{u=new URL(request.url);b=JSON.parse(request.body??'{}');}catch{return 'deny';}
 const headers=Object.fromEntries(Object.entries(request.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
 if(u.origin!==STAGING||u.search||u.hash||request.method!=='POST'||headers['content-profile']!=='canto_api')return 'deny';
 if(u.pathname==='/rest/v1/rpc/account_master_capabilities'&&keys(b,[]))return 'read';
 if(u.pathname==='/rest/v1/rpc/masters'&&keys(b,['resource','action','payload'])&&b.resource==='colors'){
  const p=b.payload;
  if(b.action==='list'&&keys(p,['page','items','search','includeInactive','filters'])&&Number.isInteger(p.page)&&p.page>=1&&p.page<=10&&Number.isInteger(p.items)&&p.items>=1&&p.items<=1000&&typeof p.search==='string'&&p.search.length<=200&&typeof p.includeInactive==='boolean'&&keys(p.filters,[]))return 'read';
  if(b.action==='get'&&keys(p,['id'])&&scope.id&&String(p.id)===scope.id)return 'read';
  if(b.action==='delete'&&scope.phase==='delete'&&keys(p,['id'])&&scope.id&&String(p.id)===scope.id)return 'mutation';
 }
 if(u.pathname!=='/rest/v1/rpc/account_master_save'||!keys(b,['p_resource','p_action','p_payload','p_upload_ids','p_idempotency_key'])||b.p_resource!=='colors'||!['create','update'].includes(scope.phase)||b.p_action!==scope.phase||!Array.isArray(b.p_upload_ids)||b.p_upload_ids.length||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.p_idempotency_key))return 'deny';
 const p=b.p_payload,editing=scope.phase==='update';
 if(!keys(p,editing?['id','values','relations','expectedUpdatedAt']:['values','relations'])||!keys(p.relations,[])||!keys(p.values,['name','hex_code','is_deleted']))return 'deny';
 if(p.values.name!==(editing?scope.editedName:scope.name)||p.values.hex_code!==(editing?'#196B45':'#2457AA')||p.values.is_deleted!=='false')return 'deny';
 if(editing&&(!scope.id||String(p.id)!==scope.id||p.expectedUpdatedAt!==scope.updatedAt))return 'deny';
 return 'mutation';
}
