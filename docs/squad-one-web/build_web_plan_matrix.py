"""Render web planning traceability; this does not implement or approve workflows."""
import csv,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
AUDIT=ROOT/'docs/squad-one-audit'
OUT=Path(__file__).resolve().parent
# module: delivery wave, shared UI family, default route
MODULES={
'AUTH':('1','Session and account forms','/login'),
'PEOPLE':('2','People directory and person editor','/squad/people'),
'LINK':('2','Customer onboarding and relationship editor','/squad/customers'),
'CAT':('3','Product catalogue and variant selector','/squad/catalogue'),
'CONFIG':('3','Shared product configurator','/squad/configurator'),
'PRICE':('3','Quote and authorized price breakdown','/squad/orders/new'),
'ORDER':('3','Order workspace and command dialogs','/squad/orders/:orderId'),
'PLAN':('4','Production allocation workspace','/squad/production'),
'CUT':('4','Size quantity grid and cutting queue','/squad/cutting'),
'SEW':('4','Job sheets and inspection workspace','/squad/job-sheets'),
'DISPATCH':('4','Dispatch workspace and delivery timeline','/squad/dispatch'),
'JOB':('4','Job-work workspace and stage controls','/squad/job-work'),
'STOCK':('5','Dealer stock and reconciliation','/squad/stock'),
'BACK':('5','Shortage preview and back-order wizard','/squad/back-orders'),
'TASK':('6','Shared work-item editor and task views','/squad/tasks'),
'GOAL':('6','Responsibility and goal views','/squad/responsibilities'),
'TARGET':('6','Milestone editor and progress','/squad/targets'),
'RATE':('6','Scoped feedback form and history','/squad/orders/:orderId/feedback'),
'METRIC':('7','Shared metric cards and report workspace','/squad/reports'),
'DOC':('7','Document request wizard and job viewer','/squad/documents'),
'PROMO':('7','Promotion browser and media viewer','/squad/promotions'),
'MEDIA':('1+7','Media picker, upload and secure viewer','Embedded in authorized resource pages'),
'NOTIFY':('1+7','Notification inbox and authorized deep links','/squad/notifications'),
'MASTER':('8','Existing Masters presentation and settings','Existing Tracker Masters; /squad/admin/settings'),
'INTEGRATE':('8','Integration status and transfer workspace','/squad/admin/integrations'),
'REFRESH':('8','Existing Data Refresh operator page','Existing Tracker Data Refresh'),
'APP':('1','Application gateway, shell and preferences','/squad/home'),
'OPS':('8','Jobs, audit and operator retry','/squad/admin/operations'),
}
OVERRIDES={
'AUTH.02':'/account/recovery (email proof and password replacement)','AUTH.03':'/account/register; /account/confirm','AUTH.04':'/squad/profile','AUTH.05':'/squad/admin/accounts; authorized Tracker account tools','AUTH.06':'No impersonation route',
'PEOPLE.03':'/squad/factories/:factoryId/team','PEOPLE.04':'/squad/factories/:factoryId/workforce','PEOPLE.06':'Shared address editor on authorized person/profile/order pages',
'LINK.01':'/squad/customers/approvals','LINK.04':'/squad/my-coordinator','LINK.05':'/squad/admin/coordinator-requests',
'CONFIG.04':'/squad/presets','PRICE.01':'Configurator quote preview/shared quote panel; checkout only for ORDER.02-authorized actors','PRICE.03':'Order line quote override dialog','PRICE.04':'Catalogue wizard pricing step',
'ORDER.01':'/squad/orders; /squad/orders/:orderId','ORDER.02':'/squad/orders/new','ORDER.08':'Order progress and immutable history display',
'PLAN.02':'Order item readiness checklist','PLAN.03':'Order item cutting allocation','CUT.03':'Order item progress panel','SEW.04':'/squad/reports/tailor-earnings',
'DISPATCH.03':'Dispatch destination editor','DISPATCH.04':'/squad/deliveries',
'JOB.01':'/squad/admin/people/:personId/capabilities','JOB.02':'Production order allocation dialog','JOB.03':'Authorized worker cost panel',
'STOCK.01':'/squad/stock (Dealer ledger); /squad/catalogue product details (Customer and Sales Coordinator scoped availability)',
'STOCK.02':'Stock receipt history after eligible completion','STOCK.03':'Stock ledger attached to customer dispatch','STOCK.04':'/squad/administration/stock',
'TARGET.03':'Milestone progress reconciliation status','METRIC.01':'/squad/home','METRIC.02':'/squad/reports/work','METRIC.03':'/squad/reports/tailor-leaderboard','METRIC.04':'/squad/reports/sales','METRIC.05':'/squad/reports/coordinator',
'DOC.01':'/squad/documents/new/catalogue','DOC.03':'Delivery challan action in authorized dispatch/delivery detail','DOC.04':'Tailor weekly report action and document history','DOC.05':'Document expired state and operator cleanup status',
'MEDIA.04':'Existing Data Refresh media exceptions; missing-file state in resource views','NOTIFY.02':'Recipient inbox and authorized destination page','NOTIFY.03':'/squad/admin/operations/delivery-failures',
'MASTER.01':'Existing Tracker Masters with current staff authority','MASTER.02':'Existing Tracker Masters bulk/import/export tools',
'INTEGRATE.01':'Warehouse availability in catalogue/order flows; integration status for operators','INTEGRATE.02':'Provider state on order/customer detail','INTEGRATE.03':'Webhook evidence in integration audit; no browser webhook action','INTEGRATE.05':'Excluded: no Airtable screen','INTEGRATE.06':'/squad/admin/transfers',
'REFRESH.02':'Existing refresh reconciliation and media exceptions','REFRESH.03':'Existing guarded platform-admin ownership flow; separate from routine persona menus',
'APP.03':'Preferences plus shared preview/download/share controls','APP.04':'Order payment instructions and acknowledgement','OPS.01':'Job progress display; no browser queue-claim action','OPS.03':'Operator schedule/status view; no client scheduler',
}
DERIVED={'ORDER.08','STOCK.02','STOCK.03','TARGET.03'}
BACKGROUND={'DOC.05','NOTIFY.02','INTEGRATE.02','INTEGRATE.03','OPS.01','OPS.03'}
rows=list(csv.DictReader((AUDIT/'functionality-matrix.csv').open()))
coverage={r['id']:r for r in json.loads((AUDIT/'release-coverage.json').read_text())['workflow_coverage']}
assert len(rows)==115 and len({r['id'] for r in rows})==115
result=[]
for r in rows:
 ident=r['id'];master=ident.split('.')[0];wave,component,route=MODULES[master]
 disposition='interactive_web_workflow'
 if ident in DERIVED:disposition='derived_state_visible_in_parent_flow'
 if ident in BACKGROUND:disposition='background_work_with_visible_result_or_status'
 if ident=='AUTH.06':disposition='retired_unsafe_impersonation_not_implemented'
 if ident=='INTEGRATE.05':disposition='excluded_by_user_airtable'
 if ident=='REFRESH.03':disposition='separate_guarded_ownership_operation'
 c=coverage[ident]
 row={
 'workflow_id':ident,'module':master,'functionality':r['functionality'],'web_disposition':disposition,
 'delivery_wave':wave,'proposed_web_entry':OVERRIDES.get(ident,route),'shared_ui_family':component,
 'persona_count_including_conditional':r['persona_count'],'personas':r['personas'],
 'conditional_personas':r['conditional_personas'],'managed_subjects':r['managed_subjects'],'other_actors':r['other_actors'],
 'audited_backend_contract':r['proposed_contract'],'backend_review_classification':c['implementation_review'],
 'existing_test_scenarios':';'.join(c.get('acceptance_scenarios',[])),
 'required_business_invariants':r['scope_variations_and_invariants'],
 'source_evidence':r['source_evidence'],
 'web_acceptance_id':'WEB-'+ident,
 'web_acceptance_required':'Disposition verified; no route/control can enable retired or excluded action' if ident in {'AUTH.06','INTEGRATE.05'} else 'Actual login; correct scope and values; complete action/result; foreign-resource denial; relevant stale/retry/empty/error states; declared provider limitations; evidence at deployed build',
 'web_acceptance_status':'planned_not_accepted',
 }
 if ident == 'AUTH.02':
  row['source_evidence'] += '; Flutter develop5d55d946 auth_service.dart:45 updatePassword has zero lib callers; actual forgot/otp/reset_password views use proof recovery. See docs/squad-one-web/ui-review.md (Account route source disposition). No authenticated password screen is claimed.'
 result.append(row)
with (OUT/'workflow-web-coverage.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(result[0]));w.writeheader();w.writerows(result)
personas=list(csv.DictReader((AUDIT/'personas.csv').open()))
with (OUT/'persona-web-coverage.csv').open('w',newline='') as f:
 fields=list(personas[0])+['proposed_landing','web_acceptance_status']
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for p in personas:
  p['proposed_landing']='/squad/home' if p['mobile_login_dashboard']=='True' else 'Managed workforce detail; no standalone login'
  p['web_acceptance_status']='planned_not_accepted';w.writerow(p)
summary={'purpose':'Web planning coverage only; no implementation, runtime acceptance, or production cutover claim',
 'workflow_count':len(result),'module_count':len(MODULES),'stored_roles':len(personas),
 'login_personas':sum(p['mobile_login_dashboard']=='True' for p in personas),
 'shared_workflows':sum(r['shared']=='True' for r in rows),
 'dispositions':{s:sum(r['web_disposition']==s for r in result) for s in sorted({r['web_disposition'] for r in result})},
 'missing_workflow_ids':sorted(set(coverage)-{r['workflow_id'] for r in result}),
 'missing_module_mappings':sorted({r['master'] for r in rows}-set(MODULES))}
# shared uses a source CSV string; maintain source truth, without truthiness of nonempty "False".
summary['shared_workflows']=json.loads((AUDIT/'coverage.json').read_text())['shared_workflows']
gaps=[{'gap_id':'WEB-GAP-01','parent_workflow':'AUTH.05','functionality':'Customer self-service account closure',
 'persona':'Customer (stored role 3)','proposed_web_entry':'/squad/profile → Close my account confirmation',
 'delivery_wave':'1','status':'required_source_variation_backend_and_browser_acceptance_pending',
 'source_evidence':'Flutter develop 5d55d946: lib/ui/views/drawer/drawer_view.dart:506; lib/ui/widgets/delete_account_widget.dart:25; lib/services/customer_service.dart:109; Rails14277820: app/controllers/api/v1/customers_controller.rb:288',
 'implementation_gap':'Current account_user_status and v1_person_archive reject self-targeting; do not repurpose or broaden admin endpoints',
 'acceptance':'Verify exact legacy closure semantics; implement scoped self-only identity flow with appropriate reauthentication, explicit confirmation, history retention and session revocation; deny foreign identity; honor mirror/rehearsal ownership; verify retry and login denial'}]
with (OUT/'source-discovered-web-gaps.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(gaps[0]));w.writeheader();w.writerows(gaps)
summary['source_discovered_variations']=len(gaps)
summary['source_discovered_variation_ids']=[g['gap_id'] for g in gaps]
assert not summary['missing_workflow_ids'] and not summary['missing_module_mappings']
(OUT/'coverage-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
