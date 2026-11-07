"""Render curated audit tables and check that every inventoried item has a disposition.

Coverage means classified source coverage, NOT executed feature/permission parity.
No app code is executed. No source credentials or customer records are exported.
"""
import csv,html,json,re,collections
from pathlib import Path
import build_inventory as inv
from capabilities import MODULES,ROWS,PERSONAS,ACTORS
OUT=Path(__file__).resolve().parent
SUBJECTS={'PEOPLE.04':'T ST','PEOPLE.05':'T ST','SEW.01':'T ST','SEW.02':'T ST','SEW.03':'T ST','SEW.04':'T ST','METRIC.03':'T ST','DOC.04':'T ST'}
def read(name):return list(csv.DictReader((OUT/name).open()))
def write(name,rows):inv.write(name,rows)
GROUPS={
 'AUTH':'login forgot otp password_success reset_password customer_signup signup_success',
 'PEOPLE':'Factories add_address add_admin add_customer add_cutting_master add_dispatch add_factory add_inspector add_pc add_sc add_tailor admin_customers admin_pc admin_personas admin_sc customer_details customer_preview customers dealers dealers_customers factories_selection factory_details sc_details select_customer select_factory select_sc select_tailors select_user select_user_role tailor_details tailors',
 'LINK':'assign_authorized_brands change_customers_sc customer_onboarding customer_sc_request customer_verification',
 'CAT':'base_product parent_base_product products_category rmp rmp_brands rmp_detail rmp_search',
 'CONFIG':'add_branding create_product create_product_preview fabric fabric_type product_add_ons select_color',
 'ORDER':'completed_order_view coordinator_orders create_order dealer_orders filtered_orders order_successful pending_order_view sc_completed_order_view sc_order_detail sc_pending_order_view search_order',
 'PLAN':'pending_criteria_orders select_cutting_master',
 'CUT':'cutting_item_detail factory_cutting_jobsheets',
 'SEW':'factory_inspector_jobsheets inspector_item_detail inspector_jobsheet jobsheet',
 'DISPATCH':'delivery dispatch_jobsheet dispatch_order_detail dispatch_orders factory_dispatch_orders select_dispatch_location',
 'TASK':'assign_note assign_note_order create_note notes order_notes',
 'GOAL':'create_responsibility responsibilities roles_goals',
 'TARGET':'add_milestone milestone_details',
 'RATE':'ratings',
 'METRIC':'leaderboard_view sc_detail_view sc_details_view_u',
 'DOC':'catalogues create_catalogue delivery_challan',
 'PROMO':'promotional_assets',
 'MEDIA':'pdf_view',
 'INTEGRATE':'sync',
 'APP':'admin_dashboard app_update_view assistant_worker customer_dashboard cutting_dashboard dealer_dashboard dispatch_dashboard drawer factory_dashboard inspector_dashboard jobworker pc_dashboard sc_dashboard splash payment',
 'RETIRED':'no_use_pc_details no_use_pc_orders',
}
VIEW={g:m for m,gs in GROUPS.items() for g in gs.split()}
SERVICES={
 'airtable':'INTEGRATE','assistant_worker':'PEOPLE','auth':'AUTH','catalogue':'DOC','common_ui':'APP','config':'APP',
 'customer':'LINK','cutting_master':'CUT','dispatch':'DISPATCH','factory':'PLAN','inspector':'SEW','job_worker':'JOB',
 'leaderboard':'METRIC','milestone':'TARGET','notes':'TASK','notifications_config':'NOTIFY','order':'ORDER','pc':'PEOPLE',
 'product':'CONFIG','profit':'PRICE','promotion_banners':'PROMO','promotion':'PROMO','rating':'RATE','readymade_product':'CAT',
 'responsibilities':'GOAL','sc':'PEOPLE','shared_preference':'APP','tailor':'PEOPLE',
}
RESOURCES={
 'admins':'AUTH','app_configs':'APP','assistant_workers':'PEOPLE','auth':'AUTH','catalogue':'DOC','customer_requests':'LINK',
 'customers':'LINK','cutting_masters':'CUT','dispatch_incharges':'DISPATCH','factory_managers':'PLAN','inspectors':'SEW',
 'items':'PLAN','job_workers':'JOB','leader_boards':'METRIC','milestones':'TARGET','notifications':'NOTIFY','orders':'ORDER',
 'production_coordinators':'PEOPLE','products':'CONFIG','profit_margins':'PRICE','promotional_banners':'PROMO',
 'promotions':'PROMO','ratings':'RATE','ready_made_products':'CAT','responsibilities':'GOAL','sales_coordinators':'PEOPLE',
 'size_types':'CAT','sync_airtables':'INTEGRATE','tailors':'PEOPLE','tasks':'TASK','zones':'INTEGRATE',
}
ACTION={
 ('customers','stock_infos'):'STOCK',('customers','my_orders'):'ORDER',('customers','register'):'AUTH',
 ('orders','criteria'):'PLAN',('orders','sizes'):'CONFIG',('orders','assign'):'PLAN',('orders','assign_to_worker'):'JOB',
 ('orders','change_due_date'):'JOB',('orders','order_stats'):'METRIC',('orders','bulk_back_orders'):'BACK',('orders','dispatch_to'):'DISPATCH',
 ('items','set_worker_price'):'JOB',('items','set_worker_status'):'JOB',('tailors','get_weekly_report'):'DOC',
 ('sales_coordinators','milestones'):'TARGET',('dispatch_incharges','delivery_challan'):'DOC',
 ('factory_managers','assign_cutting_master'):'PLAN',('factory_managers','assign_job_sheet'):'SEW',('factory_managers','item_detail'):'SEW',
 ('factory_managers','tailor_items'):'SEW',('factory_managers','tailors'):'PEOPLE',('factory_managers','all_tailors'):'PEOPLE',
 ('factory_managers','orders'):'PLAN',
}
def controller(path,method=''):
 r=Path(path).name.removesuffix('_controller.rb')
 if '/concerns/' in path:return 'AUTH' if 'authenticate' in path else 'APP'
 if '/api/dashboard/' in path:
  if r in ('orders','order_reports','rmp_order_reports','tailor_reports','customers'):return 'METRIC'
  return 'INTEGRATE' if method in ('bulk_upload','bulk_upload_status','airtable_sync') else 'MASTER'
 if method in ('create','update','destroy','show','index','update_sub_tailor','destroy_sub_tailor') and r in ('customers','cutting_masters','dispatch_incharges','factory_managers','inspectors','job_workers','assistant_workers','tailors'):
  return 'PEOPLE'
 return ACTION.get((r,method),RESOURCES.get(r,'APP'))
def service(path,method=''):
 r=Path(path).name.removesuffix('.dart').removesuffix('_service')
 overrides={'assignOrder':'PLAN','markItemCriteria':'PLAN','assignJobWorker':'JOB','assignJobWorkerPrice':'JOB','updateJobWorkerItemStatus':'JOB','updateOrderDueDateByWorker':'JOB','placeBulkOrder':'BACK','getDeliveryChallan':'DOC','getWeeklyReport':'DOC','setDispatchLocation':'DISPATCH','assignJobSheet':'SEW','getJobSheetByTailor':'SEW','getJobSheetDetails':'SEW','getUpdatedUser':'AUTH','getAllTailors':'PEOPLE','addTailor':'PEOPLE','getFactoryTailors':'PEOPLE','getCustomers':'PEOPLE','addCustomer':'PEOPLE','deleteCustomer':'PEOPLE'}
 if method in overrides:return overrides[method]
 if method.startswith(('addPC','addSC','addFactory','addInspector','addDispatchInCharge','addCuttingMaster','getAllPC','getAllSC','getAllFactories','getInspectors','getDispatchInCharges','getAllCuttingMasters')):return 'PEOPLE'
 return SERVICES[r]
TABLE={}
for m,(_,ts,_) in MODULES.items():
 for t in ts.split():TABLE.setdefault(t,set()).add(m)
TABLE.update({'authorized_brands':{'LINK','CAT','MASTER'},'job_sheet_dispatched_dates':{'DISPATCH','SEW'}})
for table in read('snapshot-tables.csv')+read('legacy-tables.csv'):
 t=table['table']
 if t not in TABLE:
  if t in ('ar_internal_metadata','schema_migrations'):TABLE[t]={'REFRESH'}
  elif t in ('notification_histories',):TABLE[t]={'NOTIFY'}
  elif t.startswith(('add_on','base_','fabric_','part_','rmp_')) or t in ('categories','sc_sizes','size_types'):TABLE[t]={'MASTER','CAT'}
  else:raise ValueError('Unmapped table '+t)

def classify(repo,path):
 if repo=='flutter':
  if path.startswith('lib/ui/views/'):
   group=path.split('/')[3];m=VIEW[group]
   if group in ('assistant_worker','jobworker') and 'dashboard' not in path:m='JOB' if group=='jobworker' else 'PEOPLE'
   return m
  if path.startswith('lib/services/'):return service(path)
  if 'notification' in path:return 'NOTIFY'
  if 'calculator' in path:return 'PRICE'
  return 'APP' # DTOs/widgets/generated navigation are support, not claimed independent features.
 if path.startswith('db/migrate/'):return 'OPS'
 if path.startswith('lib/tasks/'):return 'OPS' if path.endswith('.keep') else 'INTEGRATE'
 if path.startswith('app/commands/') or path=='lib/json_web_token.rb':return 'AUTH'
 if path.startswith('app/uploaders/'):return 'MEDIA'
 if path.startswith(('app/mailers/','app/channels/')):return 'NOTIFY'
 if path.startswith('app/controllers/'):return controller(path)
 if 'notification' in path or 'send_f_c_m' in path or 'fcm' in path:return 'NOTIFY'
 if 'airtable' in path or '/uni_commerce/' in path:return 'INTEGRATE'
 if '/dashboard/' in path and '/services/' in path:return 'METRIC' if any(x in path for x in ('stats','report')) else 'INTEGRATE'
 if any(x in path for x in ('catalogue','tailors_payment','weekly_tailor_report')):return 'DOC'
 if '/milestones/' in path or 'milestone' in path:return 'TARGET'
 if 'rating' in path:return 'RATE'
 if 'back_order' in path or 'generate_order_params' in path:return 'BACK'
 if 'stock' in path:return 'STOCK'
 if 'cutting' in path:return 'CUT'
 if 'dispatched' in path or 'dispatch' in path:return 'DISPATCH'
 if 'job_sheet' in path or 'mark_tailor' in path or 'update_tailor_quantity' in path:return 'SEW'
 if 'stats' in path or 'report' in path or 'min_price' in path or 'min_mrp' in path:return 'METRIC'
 if 'bulk' in path or 'import_zone' in path or 'uc_order' in path:return 'INTEGRATE'
 if 'criteria' in path:return 'PLAN'
 if 'price' in path or 'profit' in path:return 'PRICE'
 if 'custom_product' in path:return 'CONFIG'
 if 'order' in path:return 'ORDER'
 if any(x in path for x in ('approval','user_zone','user_price_type','user_dealer','direct_deal','customer_request')):return 'LINK'
 if '/models/' in path or '/serializers/' in path:
  name=Path(path).stem.removesuffix('_serializer')
  # Explicit singular forms for model-to-table joins.
  table='criteria' if name=='criteria' else name[:-1]+'ies' if name.endswith('y') else name+'es' if name.endswith('ss') else name+'s'
  if table in TABLE:return ';'.join(sorted(TABLE[table]))
  return 'PEOPLE' if any(x in path for x in ('user','admin','sales_coordinator')) else 'APP'
 if 'task' in path:return 'TASK'
 if 'responsibilit' in path:return 'GOAL'
 if path.startswith('app/jobs/'):return 'OPS'
 if path in ('config/routes.rb','db/schema.rb') or path.startswith('lib/tasks/'):return 'OPS'
 return 'APP'

def url(repo,path,line=1,sha=None):
 repo_name='scott' if repo=='flutter' else 'scott-international-backend'
 return f'https://github.com/arslan9380/{repo_name}/blob/{sha or inv.BASELINES[repo][1]}/{path}#L{line}'
def evidence(path):
 repo='flutter' if path.startswith('lib/') and path.endswith('.dart') else 'rails'
 inv.source(repo,path) # raises if any evidence source is missing
 return url(repo,path)
def names(codes):return '; '.join(PERSONAS[c][0] if c in PERSONAS else {'P':'Printing Tracker admin','G':'Guest','S':'Trusted worker'}[c] for c in codes)
def main():
 ids={r['id'] for r in ROWS};assert len(ids)==len(ROWS)
 for r in ROWS:
  assert r['module'] in MODULES
  assert len(set(r['actors']+r['conditional_actors']))==len(r['actors']+r['conditional_actors'])
  assert set(r['actors']+r['conditional_actors'])<=set(PERSONAS)|{'P','G','S'}
  for p in r['evidence']:evidence(p)
 exported=[]
 for r in ROWS:
  ps=[c for c in r['actors']+r['conditional_actors'] if c in PERSONAS]
  exported.append({'id':r['id'],'master':r['module'],'functionality':r['functionality'],'persona_count':len(ps),'personas':names([p for p in r['actors'] if p in PERSONAS]),'conditional_personas':names(r['conditional_actors']),'managed_subjects':names(SUBJECTS.get(r['id'],'').split()),'other_actors':names([p for p in r['actors'] if p not in PERSONAS]),'shared':len(ps)>1,'proposed_contract':r['api'],'request_fields':r['request'],'result':r['result'],'scope_variations_and_invariants':r['rules'],'source_evidence':';'.join(evidence(p) for p in r['evidence']),'status':'planned; source-backed unless explicitly marked improvement'})
 write('functionality-matrix.csv',exported)
 api_rows=[]
 for name in sorted({name for r in ROWS for name in re.findall(r'\bv1_[a-z_]+',r['api'])}):
  rr=[r for r in ROWS if name in re.findall(r'\bv1_[a-z_]+',r['api'])]
  api_rows.append({'contract':name,'kind':'proposed canto_api RPC','workflow_ids':';'.join(r['id'] for r in rr),'modules':';'.join(sorted({r['module'] for r in rr})),'status':'planned; use workflow input/result and per-action permission rules'})
 write('api-catalog.csv',api_rows)
 masters=[]
 for m,(title,tables,_) in MODULES.items():
  rows=[r for r in ROWS if r['module']==m];ps=sorted({p for r in rows for p in r['actors']+r['conditional_actors'] if p in PERSONAS},key=lambda p:PERSONAS[p][1])
  masters.append({'id':m,'master_functionality':title,'workflow_count':len(rows),'persona_count':len(ps),'personas_including_conditional':names(ps),'canonical_tables':tables,'workflow_ids':';'.join(r['id'] for r in rows)})
 write('master-capabilities.csv',masters)
 personas=[]
 for p,(name,enum) in sorted(PERSONAS.items(),key=lambda x:x[1][1]):
  rows=[r for r in ROWS if p in r['actors'] or p in r['conditional_actors']]
  personas.append({'code':p,'persona':name,'legacy_role_id':enum,'mobile_login_dashboard':p not in ('T','ST'),'workflow_count_including_conditional':len(rows),'shared_workflow_count':sum(sum(c in PERSONAS for c in r['actors']+r['conditional_actors'])>1 for r in rows),'master_capabilities':';'.join(m for m in MODULES if any(r['module']==m for r in rows)),'workflow_ids':';'.join(r['id'] for r in rows),'conditional_workflow_ids':';'.join(r['id'] for r in rows if p in r['conditional_actors']),'managed_subject_modules':'PEOPLE;SEW;METRIC;DOC' if p in ('T','ST') else '', 'managed_subject_workflow_ids':';'.join(k for k,v in SUBJECTS.items() if p in v.split())})
 write('personas.csv',personas)
 for filename in ['source-files.csv','flutter-views.csv','flutter-services.csv','controller-methods.csv','legacy-routes.csv','branch-differences.csv','legacy-tables.csv','snapshot-tables.csv']:
  rows=read(filename)
  for r in rows:
   if filename in ('legacy-tables.csv','snapshot-tables.csv'):r['domain']=';'.join(sorted(TABLE[r['table']]));continue
   if filename=='legacy-routes.csv':
    r['capability']=controller(r['handler'],r['action']);r['disposition']='retain behavior via shared module' if r['implemented']=='True' else 'declared route only; no handler in pinned source; do not invent API'
    continue
   repo=r.get('repository','flutter' if filename.startswith('flutter') else 'rails')
   path=r['path'];m=classify(repo,path)
   if filename=='flutter-services.csv':m=service(path,r['method'])
   if filename=='controller-methods.csv':m=controller(path,r['method'])
   if filename=='branch-differences.csv':
    r['disposition']=('superseded main snapshot; approved Flutter develop baseline governs' if repo=='flutter' else 'reviewed alternate WMS/dashboard branch; preserve adapter capability; deployed parity unproven')
    r['capability']=m if '/webhooks/' not in path and '/dashboard/' not in path and 'wms_router' not in path else 'INTEGRATE';continue
   target='domain' if filename=='source-files.csv' else 'capability';r[target]=m
   r['disposition']='schema provenance; do not replay; see migration-history.csv' if path.startswith('db/migrate/') else 'empty scaffolding; no functional endpoint' if path.endswith('.keep') else 'retire unused legacy screen' if m=='RETIRED' else ('client/model/serialization support; no independent endpoint' if m=='APP' else 'shared module; see curated workflow contracts')
  write(filename,rows)
 # Additional notification mapping, including dynamic recipient method evidence.
 mapping=inv.source('rails','app/services/notifications/strategy_factory.rb');events=[]
 strategy_paths=[p for p in inv.files('rails') if '/notifications/strategies/' in p]
 class_paths={}
 for p in strategy_paths:
  for c in re.findall(r'\bclass\s+(\w+)',inv.source('rails',p)):class_paths[c]=p
 for match in re.finditer(r'"(\d+)"\s*=>\s*Strategies::(\w+)',mapping):
  num,cls=match.groups();path=class_paths[cls];src=inv.source('rails',path)
  resolver=re.search(r'def resolve_recipients',src);line=src[:resolver.start()].count('\n')+1 if resolver else 1
  family=next((family for word,family in [('Cancellation','order.cancelled'),('Cancelled','order.cancelled'),('Edited','order.edited'),('Price','order.price_changed'),('DueDate','order.due_changed'),('Dispatch','dispatch.changed'),('Stitching','production.stitching'),('Cutting','production.cutting'),('Assigned','assignment.changed'),('Registered','customer.registered'),('Processing','order.processing'),('Placed','order.placed'),('Created','order.placed')] if word in cls),'order.progress')
  events.append({'legacy_type':num,'strategy':cls,'proposed_event_family':family,'master':'NOTIFY','recipient_evidence':url('rails',path,line),'template_evidence':url('rails','app/services/notifications/types.rb'),'policy':'Port resolver conditions into recipient rules; class name alone is not permission evidence; event+recipient+channel dedupe'})
 write('notification-events.csv',events)
 jobs=[];effects=[]
 for path in inv.files('rails'):
  src=inv.source('rails',path)
  if path.startswith('app/jobs/'):
   jobs.append({'source':url('rails',path),'job':Path(path).stem,'master':classify('rails',path),'target':'shared durable worker handler' if not path.endswith('application_job.rb') else 'framework base; no handler'})
  for n,l in enumerate(src.splitlines(),1):
   kinds=[k for term,k in [('SendFCMService.call','push'),('.deliver_later','email'),('.deliver_now','email'),('.perform_later','job_enqueue'),('after_create','model_callback'),('after_update','model_callback'),('after_save','model_callback')] if term in l and not l.lstrip().startswith('#')]
   if kinds:effects.append({'source':url('rails',path,n),'kinds':';'.join(kinds),'master':classify('rails',path),'target':'transactional outbox or deterministic in-transaction derived update; suppress during import'})
 write('background-jobs.csv',jobs);write('side-effects.csv',effects)
 migrations=[]
 for path in inv.files('rails'):
  if not path.startswith('db/migrate/'):continue
  src=inv.source('rails',path)
  ops=sorted(set(re.findall(r'\b(create_table|drop_table|add_column|remove_column|rename_column|add_index|add_reference|add_foreign_key|change_column|rename_table|execute)\b',src)))
  tables=sorted(set(re.findall(r'(?:create_table|drop_table|add_column|remove_column|rename_column|add_index|add_reference|add_foreign_key|change_column)\s+[:\"\'](\w+)',src)))
  migrations.append({'source':url('rails',path),'migration':Path(path).stem,'operations':';'.join(ops) or 'Ruby data/structure migration','table_names':';'.join(tables),'disposition':'schema provenance; do not replay legacy migrations onto Supabase'})
 write('migration-history.csv',migrations)
 alternate=[];alt_sha='058ffb160c323ca329aea2228af8b92477275a3c'
 for r in read('branch-differences.csv'):
  path=r['path']
  if r['repository']!='rails' or not path.endswith('.rb'):continue
  src=inv.source('rails',path,alt_sha)
  for method,line in inv.methods(src,'rails'):
   alternate.append({'source':url('rails',path,line,alt_sha),'method':method,'capability':r['capability'],'disposition':r['disposition']})
 write('alternate-branch-methods.csv',alternate)
 # Validate classifications, not claimed behavioral correctness.
 checks={}
 for name,key in [('source-files.csv','domain'),('flutter-views.csv','capability'),('flutter-services.csv','capability'),('controller-methods.csv','capability'),('legacy-routes.csv','capability'),('branch-differences.csv','capability'),('snapshot-tables.csv','domain'),('legacy-tables.csv','domain')]:
  data=read(name);assert all(r[key] and set(r[key].split(';'))<=set(MODULES)|{'RETIRED'} for r in data),name
  assert all(r.get('disposition') or key=='domain' for r in data),name
  checks[name]=len(data)
 routes=read('legacy-routes.csv');unique={(r['verb'],r['path']) for r in routes};implemented={(r['verb'],r['path']) for r in routes if r['implemented']=='True'}
 checks.update(master_capabilities=len(masters),workflows=len(ROWS),shared_workflows=sum(r['shared'] for r in exported),proposed_rpc_contract_names=len(api_rows),notification_types=len(events),background_job_files=len(jobs),side_effect_call_sites=len(effects),migration_files=len(migrations),alternate_branch_methods=len(alternate),unique_route_signatures=len(unique),implemented_unique_routes=len(implemented),unimplemented_route_declarations=sum(r['implemented']=='False' for r in routes),unclassified=0)
 (OUT/'coverage.json').write_text(json.dumps(checks,indent=2)+'\n')
 render(masters,personas,exported,checks)
 print(json.dumps(checks,indent=2))

def render(masters,personas,rows,checks):
 text=['# Squad One — functionality and persona matrix','', 'Generated from the curated source audit. **Planned access is not deployed authorization or proven runtime parity.** Conditional roles count toward reuse only when their feature grant is enabled. `P` (Printing Tracker admin), guest and service workers are separate actors and are excluded from persona counts. Tailor/SubTailor are managed subjects, not missing implementation rows.','', 'Source: approved Flutter develop `5d55d946`; Rails main `14277820` plus reviewed WMS branch `058ffb16`. The role-rule CSV records literal legacy UI lists; the following matrix is the proposed server-enforced policy.','',f"**{len(masters)} shared modules · {len(rows)} workflow rows · {checks['shared_workflows']} workflows reused by two or more personas.**",'', '## Personas','', '| Role | Stored ID | Dashboard | Workflows* | Shared* | Modules |','|---|---:|---|---:|---:|---|']
 for p in personas:text.append(f"| {p['persona']} | {p['legacy_role_id']} | {'Yes' if p['mobile_login_dashboard'] else 'Managed subject'} | {p['workflow_count_including_conditional']} | {p['shared_workflow_count']} | {p['master_capabilities'] or p['managed_subject_modules']} |")
 text+=['','*Includes conditional grants and explicitly proposed improvements. Counts are not a claim that every row is an existing visible screen.','', '## Shared master functions','', '| ID | Master functionality | Workflows | Persona reuse count | Personas (including conditional) |','|---|---|---:|---:|---|']
 for m in masters:text.append(f"| {m['id']} | {m['master_functionality']} | {m['workflow_count']} | {m['persona_count']} | {m['personas_including_conditional'] or 'Platform/service only'} |")
 for m in masters:
  text+=['',f"## {m['id']} — {m['master_functionality']}",'','Canonical business tables (within the existing snapshot, with `sa_` prefixes): '+m['canonical_tables']+'.','', '| ID | Unique workflow | Personas | Conditional | Reuse count | Other actors |','|---|---|---|---|---:|---|']
  for r in [r for r in rows if r['master']==m['id']]:text.append(f"| {r['id']} | {r['functionality']} | {r['personas'] or '—'} | {r['conditional_personas'] or '—'} | {r['persona_count']} | {r['other_actors'] or '—'} |")
  for r in [r for r in rows if r['master']==m['id']]:
   text+=['',f"### {r['id']} — {r['functionality']}",'',f"- Contract: `{r['proposed_contract']}`",f"- Input: {r['request_fields']}",f"- Result: {r['result']}",f"- Rules: {r['scope_variations_and_invariants']}",f"- Managed workforce subjects: {r['managed_subjects'] or 'None'}",'- Evidence: '+', '.join(f'[source {i+1}]({u})' for i,u in enumerate(r['source_evidence'].split(';')))]
 (OUT/'FUNCTIONALITY_MATRIX.md').write_text('\n'.join(text)+'\n')
 # Offline artifact; all text escaped. No network, credentials, analytics or runtime application dependencies.
 data=json.dumps(rows).replace('<','\\u003c')
 opts=''.join(f'<option>{html.escape(name)}</option>' for name,_ in PERSONAS.values())
 page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Squad One capability audit</title><style>
body{font:15px system-ui;margin:0;color:#1b2637;background:#f5f7fb}header{padding:28px 32px;background:#0c2744;color:white}h1{margin:0 0 10px;font-size:28px}main{padding:24px 32px}input,select{font:inherit;padding:10px;border:1px solid #abbacc;border-radius:6px;margin:0 8px 12px 0}input{width:340px;max-width:80%}.note{max-width:1000px;line-height:1.6}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th,td{padding:12px;text-align:left;border-bottom:1px solid #dce3ed;vertical-align:top}th{position:sticky;top:0;background:#e7eef7}td small{display:block;margin-top:8px;color:#516174}details{max-width:640px}summary{cursor:pointer;color:#12578a}a{color:#12578a}code{overflow-wrap:anywhere}#count{margin-bottom:14px}.table-wrap{overflow:auto}footer{padding:24px;color:#516174}</style>
<header><h1>Squad One — capability audit</h1><div>28 shared modules · WORKFLOWS unique workflow rows · SHARED reused across multiple personas</div></header><main><p class="note">Plan based on the approved local Flutter develop source. Counts include conditional access; this is proposed server authorization, not proof of deployed behavior. Tailor and SubTailor are managed workforce subjects. Printing Tracker admin is a separate actor. Use the plan and contract details before implementation.</p><label>Search <input id="search" placeholder="Order, cutting, PDF, stock…"></label><label>Persona <select id="persona"><option value="">All personas</option>OPTIONS</select></label><label>Sharing <select id="shared"><option value="">All workflows</option><option value="yes">Shared by 2+ personas</option><option value="no">Single persona or platform</option></select></label><div id="count" aria-live="polite"></div><div class="table-wrap"><table><thead><tr><th>ID / master</th><th>Functionality and contract</th><th>Personas</th><th>Reuse</th></tr></thead><tbody id="rows"></tbody></table></div></main><footer>Source audit 2026-11-07. See FUNCTIONALITY_MATRIX.md, coverage.json and SQUAD_ONE_BACKEND_PLAN.md. No application/database changes are performed by this file.</footer><script>
const DATA=DATA_JSON;const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){const q=document.querySelector('#search').value.toLowerCase(),p=document.querySelector('#persona').value,s=document.querySelector('#shared').value;const rows=DATA.filter(r=>(!q||JSON.stringify(r).toLowerCase().includes(q))&&(!p||(r.personas+'; '+r.conditional_personas+'; '+r.managed_subjects).split('; ').includes(p))&&(!s||(s==='yes'?r.shared:!r.shared)));document.querySelector('#count').textContent=`${rows.length} of ${DATA.length} workflows`;document.querySelector('#rows').innerHTML=rows.map(r=>`<tr><td>${esc(r.id)}<small>${esc(r.master)}</small></td><td><strong>${esc(r.functionality)}</strong><details><summary>Contract, rules and evidence</summary><p><code>${esc(r.proposed_contract)}</code></p><p><b>Input:</b> ${esc(r.request_fields)}</p><p><b>Result:</b> ${esc(r.result)}</p><p>${esc(r.scope_variations_and_invariants)}</p>${r.source_evidence.split(';').map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener">Source ${i+1}</a>`).join(' · ')}</details></td><td>${esc(r.personas||'—')}${r.conditional_personas?`<small>Conditional: ${esc(r.conditional_personas)}</small>`:''}${r.managed_subjects?`<small>Managed subjects: ${esc(r.managed_subjects)}</small>`:''}${r.other_actors?`<small>Other: ${esc(r.other_actors)}</small>`:''}</td><td>${r.persona_count}</td></tr>`).join('');}document.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',render));render();
</script></html>'''.replace('WORKFLOWS',str(len(rows))).replace('SHARED',str(checks['shared_workflows'])).replace('OPTIONS',opts).replace('DATA_JSON',data)
 (OUT/'matrix.html').write_text(page)

if __name__=='__main__':main()
