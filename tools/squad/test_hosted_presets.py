"""Staging configure/quote/order journey, rolled back with sequences restored."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
from hosted_lifecycle import exercise

def run(production=False):
 checks=[]
 tables=['products','product_parts','product_part_add_ons','colors','fabric_colors','orders','items','quantities','extra_quantities','brandings','item_criteria','criteria','sizes','mark_cuttings','mark_cutting_quantities','item_tailors','item_tailor_quantities','job_sheet_assign_dates','job_sheet_assign_quantities','job_sheet_assign_tailors','job_sheet_tailor_mark_dates','job_sheet_mark_tailors','mark_tailor_quantities','job_sheet_dispatched_dates','dispatched_quantities']
 sequences=['sa_snapshot_20261019.sa_'+t+'_id_seq' for t in tables]+['sa_domain.audit_id_seq','sa_domain.quotes_ledger_id_seq']
 with connect('staging') as c:
  c.execute("SET track_functions='pl'")
  stats_before={row[0]:row[1:] for row in c.execute("SELECT funcid,calls,total_time,self_time FROM pg_stat_user_functions WHERE schemaname='sa_domain'")}
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/write is active'
  before={name:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone() for name in sequences}
  try:
   with c.transaction():
    actor=c.execute("""SELECT sc.id,m.auth_user_id,u.id,a.id FROM sa_snapshot_20261019.sa_users sc JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=sc.id
     JOIN sa_snapshot_20261019.sa_users u ON u.created_by_id=sc.id AND u.role=3 AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE
     JOIN sa_snapshot_20261019.sa_addresses a ON a.user_id=u.id AND a.deleted_at IS NULL AND length(btrim(a.state))>0
     WHERE sc.role=1 AND m.enrollment_state='ready' AND sc.deleted_at IS NULL AND sc.disabled IS NOT TRUE
     AND (%s=false OR u.is_direct_deal IS TRUE) ORDER BY sc.id,u.id,a.id LIMIT 1""",(bool(production),)).fetchone()
    assert actor,'Eligible coordinator/customer/address required'
    config=c.execute("""SELECT b.id,f.id,col.id,cat.id FROM sa_snapshot_20261019.sa_base_products b
     JOIN sa_snapshot_20261019.sa_base_product_fabrics bf ON bf.base_product_id=b.id AND bf.is_deleted IS NOT TRUE
     JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=bf.fabric_id AND f.is_deleted IS NOT TRUE
     JOIN sa_snapshot_20261019.sa_fabric_colors fc ON fc.fabric_id=f.id AND fc.is_deleted IS NOT TRUE
     JOIN sa_snapshot_20261019.sa_colors col ON col.id=fc.color_id AND col.is_deleted IS NOT TRUE AND col.created_by_id IS NULL
     JOIN sa_snapshot_20261019.sa_base_product_categories bc ON bc.base_product_id=b.id AND bc.is_deleted IS NOT TRUE
     JOIN sa_snapshot_20261019.sa_categories cat ON cat.id=bc.category_id WHERE b.is_deleted IS NOT TRUE ORDER BY b.id,f.id,col.id,cat.id LIMIT 1""").fetchone()
    size=c.execute('SELECT id FROM sa_snapshot_20261019.sa_sizes ORDER BY id LIMIT 1').fetchone()[0]
    session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session,actor[1]))
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor[1]),'session_id':str(session)}),));c.execute('SET LOCAL ROLE sa_app')
    color=c.execute("SELECT canto_api.v1_color_save('fabric',%s,'Rollback-only color','#A101D3',%s)",(config[1],uuid.uuid4())).fetchone()[0]
    config=dict(zip(['base_product_id','fabric_id','fabric_color_id','category_id'],map(str,config)));config['fabric_color_id']=color['id']
    p=c.execute('SELECT canto_api.v1_product_configure(%s,%s,%s,%s)',(Jsonb(config),'Rollback-only preset','Acceptance test',uuid.uuid4())).fetchone()[0]
    reused=c.execute('SELECT canto_api.v1_product_configure(%s,%s,%s,%s)',(Jsonb(config),'Rollback-only preset','Acceptance test',uuid.uuid4())).fetchone()[0]
    assert p['id']==reused['id'] and reused['reused'];checks.append('private color and canonical preset reuse')
    renamed=c.execute('SELECT canto_api.v1_preset_rename(%s,%s,%s,%s)',(int(p['id']),'Rollback rename',p['version'],uuid.uuid4())).fetchone()[0]
    assert renamed['version']!=p['version'];checks.append('scoped coordinator rename')
    quote_request={'customer_id':str(actor[2]),'address_id':str(actor[3]),'lines':[{'kind':'custom','configuration':config,'quantities':[{'size_id':str(size),'quantity':6}]}]}
    q=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb(quote_request),)).fetchone()[0]
    key=uuid.uuid4();args=(uuid.UUID(q['quote_id']),1,90,'Rollback-only price exception',q['version'],key)
    overridden=c.execute('SELECT canto_api.v1_quote_override(%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
    assert overridden['version']!=q['version']
    assert c.execute('SELECT canto_api.v1_quote_override(%s,%s,%s,%s,%s,%s)',args).fetchone()[0]==overridden
    checks.append('server quote override, totals and exact retry')
    details={'due_at':'2026-12-01T12:30:00+05:30','line_settings':{'1':{'product_id':p['id']}},'payment':{'status':'partial','paid_amount':'10.01'}}
    args=(uuid.UUID(q['quote_id']),overridden['version'],Jsonb(details),uuid.uuid4())
    samples=[]
    for _ in range(11):
     with c.transaction():
      plan=c.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_order_place(%s,%s,%s,%s)',args).fetchone()[0][0]
      samples.append(plan['Execution Time']);raise psycopg.Rollback()
    evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
     'scenario':'SC custom preset, quote override, partial payment, single-line order acceptance',
     'samples_ms':samples[1:],'p95_ms':max(samples[1:]),'target_ms':500,
     'scope':'warm database execution; rollback-only, not a concurrent load or maximum-size request guarantee'}
    (ROOT/'docs/squad-one-audit/implementation-evidence/staging-order-acceptance-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
    assert evidence['p95_ms']<evidence['target_ms'],evidence
    checks.append('representative order acceptance DB p95 below 500ms')
    placed=c.execute('SELECT canto_api.v1_order_place(%s,%s,%s,%s)',args).fetchone()[0]
    assert len(placed['orders'])==1 and len(placed['orders'][0]['items'])==1
    assert placed==c.execute('SELECT canto_api.v1_order_place(%s,%s,%s,%s)',args).fetchone()[0]
    assert placed['total_amount']==overridden['total'];checks.append('order acceptance, partial payment and exact retry')
    order=c.execute('SELECT canto_api.v1_order_get(%s)',(int(placed['orders'][0]['id']),)).fetchone()[0]
    assert order['id']==placed['orders'][0]['id'];checks.append('created order visible through scoped detail')
    if production:
     from hosted_production import exercise as production_journey
     production_journey(c,placed['orders'][0],checks,execution=production=='execution')
    else:exercise(c,placed['orders'][0],checks)
    raise psycopg.Rollback()
  finally:
   c.execute('SET ROLE postgres')
   for name,(value,called) in before.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(name,value,called))
   assert all(c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()==state for name,state in before.items())
   c.execute('SELECT pg_stat_force_next_flush()');c.execute('SELECT pg_stat_clear_snapshot()')
   stats=[]
   for oid,name,calls,total,own in c.execute("SELECT funcid,funcname,calls,total_time,self_time FROM pg_stat_user_functions WHERE schemaname='sa_domain'"):
    b=stats_before.get(oid,(0,0,0));delta_calls=calls-b[0]
    if delta_calls:stats.append({'function':name,'calls':delta_calls,'total_ms':round(total-b[1],2),'self_ms':round(own-b[2],2)})
   (ROOT/'docs/squad-one-audit/implementation-evidence/staging-command-profile.json').write_text(json.dumps(sorted(stats,key=lambda x:-x['self_ms']),indent=2)+'\n')
  print(json.dumps({'environment':'staging','passed':checks,'all_rows_rolled_back':True,'sequences_restored':True}))
if __name__=='__main__':run()
