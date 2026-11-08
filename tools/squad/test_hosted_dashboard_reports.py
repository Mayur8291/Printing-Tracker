"""Verify this migration in a rolled-back staging transaction; no release or business writes."""
import datetime,json,sys,uuid,time,os
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from delta_sync import check_catalog
from deploy import statements
MIGRATIONS=[ROOT/'supabase/migrations'/name for name in ('20261108125302_squad_dashboard_customers_reports.sql','20261108145821_squad_dashboard_rmp_search_projection.sql','20261108154028_squad_dashboard_customer_type_summary.sql')]
def run():
 results=[];scenarios=[];reconciliation=[]
 with connect('staging') as c:
  check_catalog(c,'staging')
  before=public_structure(c)
  with c.transaction():
   c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
   c.execute("SET LOCAL lock_timeout='3s'")
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Refresh/write active; retry later'
   assert c.execute('SELECT environment,active_job FROM sa_sync.environment_state').fetchone()==('staging',None)
   for migration in MIGRATIONS:
    if not c.execute('SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=%s',(migration.name.split('_')[0],)).fetchone():
     c.execute(';'.join(statements(migration.read_text())))
   assert public_structure(c)==before
   actor=c.execute("SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.role='admin' AND u.role='authenticated' AND(u.banned_until IS NULL OR u.banned_until<now()) ORDER BY p.id LIMIT 1").fetchone()[0]
   sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,actor))
   c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'authenticated','sub':str(actor),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE authenticated')
   c.execute("SET LOCAL statement_timeout='30s'")
   for report,tab in [('customers',''),('order_reports',''),('rmp_order_reports',''),('tailor_reports',''),('order_tracking',''),('rmp_sales','overview'),('rmp_sales','brand'),('rmp_sales','class'),('rmp_sales','coordinator'),('customer_performance',''),('unique_customers',''),('total_inventory','')][:0 if os.getenv('DASHBOARD_SCENARIOS_ONLY') else None]:
    args={'report':report,'tab':tab,'filters':{'from':'2026-01-01','before':'2026-11-09','from_b':'2025-01-01','before_b':'2025-11-09'},'query':{'items':20}}
    if report in ('customers','order_reports','rmp_order_reports','tailor_reports'):args['filters']={}
    samples=[]
    for i in range(3):
     samples.append(c.execute("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.dashboard('query',%s)",(Jsonb(args),)).fetchone()[0][0]['Execution Time'])
    payload=c.execute("SELECT canto_api.dashboard('query',%s)",(Jsonb(args),)).fetchone()[0]
    assert len(payload['data'])<=20
    assert payload['summary']['count']==payload['totalCount']
    c.execute('SET LOCAL ROLE postgres')
    base=" FROM sa_snapshot_20261019.sa_orders o JOIN sa_snapshot_20261019.sa_users u ON u.id=o.customer_id LEFT JOIN sa_snapshot_20261019.sa_items i ON i.order_id=o.id WHERE o.deleted_at IS NULL AND o.is_deleted IS NOT TRUE"
    period=" AND coalesce(o.created_on,o.created_at)>='2025-12-31 18:30:00' AND coalesce(o.created_on,o.created_at)<'2026-11-08 18:30:00'"
    source_sql=None
    if report in ('customers','customer_performance'):source_sql="SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE role=3 AND deleted_at IS NULL"
    elif report in ('order_reports','rmp_order_reports'):source_sql='SELECT count(*)'+base+' AND i.item_type='+('0' if report=='order_reports' else '1')
    elif report=='tailor_reports':source_sql='SELECT count(DISTINCT i.id)'+base+' AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d WHERE d.item_id=i.id)'
    elif report=='order_tracking':source_sql='SELECT count(DISTINCT o.id)'+base+period
    elif report=='rmp_sales' and tab=='overview':source_sql='SELECT count(DISTINCT o.id)'+base+period+' AND o.order_item_type=0 AND i.item_type=1'
    elif report=='total_inventory':source_sql='SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_skus WHERE NOT is_deleted'
    if source_sql:
     count=c.execute(source_sql).fetchone()[0];assert count==payload['totalCount'],(report,count,payload['totalCount']);reconciliation.append({'report':report,'tab':tab,'sourceCount':count,'matched':True,'revision':payload['revision']})
    if report=='rmp_sales' and tab=='overview':
     from decimal import Decimal
     typed_base=base.replace(' WHERE ', ' LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id WHERE ',1)
     invalid="bool_or(i.total_quantity IS NULL OR i.total_quantity<0 OR i.total_amount IS NULL OR i.total_amount<0 OR i.total_amount>='Infinity'::numeric)"
     sql="SELECT coalesce(nullif(btrim(pt.name),''),'Unknown'),CASE WHEN NOT "+invalid+" THEN sum(i.total_quantity) END,CASE WHEN NOT "+invalid+" THEN sum(i.total_amount) END"+typed_base+period+" AND o.order_item_type=0 AND i.item_type=1 GROUP BY coalesce(nullif(btrim(pt.name),''),'Unknown')"
     expected={t:(qty,amount) for t,qty,amount in c.execute(sql)}
     actual={x['type']:tuple(Decimal(x[k]) if x[k] is not None else None for k in ('qty','amount')) for x in payload['summary']['customerTypeBreakdown']}
     assert actual==expected,'Customer-type summary differs from source'
     reconciliation[-1].update(customerTypeSummaryMatched=True,customerTypes=len(actual))
    c.execute('SET LOCAL ROLE authenticated')
    row={'report':report,'tab':tab,'cold_ms':samples[0],'warm_ms':samples[1:],'summary_cache':'revision_keyed_5_minutes' if report=='rmp_order_reports' else 'none','total':payload['totalCount'],'revision':payload['revision'],'target_ms':200}
    results.append(row);print(json.dumps(row),flush=True)
   for label,args in [
    ('rmp_deep_page',{'report':'rmp_order_reports','query':{'page':4000,'items':20}}),
    ('rmp_search',{'report':'rmp_order_reports','query':{'search':'OD-S-','items':20}}),
    ('rmp_boolean_search',{'report':'rmp_order_reports','query':{'search':'true','items':20}}),
    ('rmp_amount_sort',{'report':'rmp_order_reports','query':{'sort':{'key':'total_amount','direction':'desc','numeric':True},'items':20}}),
    ('customer_search',{'report':'customers','query':{'search':'company','items':20}}),
   ]:
    started=time.monotonic();payload=c.execute("SELECT canto_api.dashboard('query',%s)",(Jsonb(args),)).fetchone()[0]
    elapsed=(time.monotonic()-started)*1000
    assert len(payload['data'])<=20 and payload['totalCount']==payload['summary']['count']
    scenario={'scenario':label,'elapsed_ms':round(elapsed,2),'count':payload['totalCount']};scenarios.append(scenario);print(json.dumps(scenario),flush=True)
   c.execute('SET LOCAL ROLE postgres');assert public_structure(c)==before
   raise psycopg.Rollback()
  assert public_structure(c)==before
 evidence={'environment':'staging','dashboard_migrations':[p.name for p in MIGRATIONS],'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'migration_and_sessions_rolled_back':True,'public_structure_unchanged':True,'results':results,'scenarios':scenarios,'source_reconciliation':reconciliation}
 if not os.getenv('DASHBOARD_SCENARIOS_ONLY'):(ROOT/'docs/squad-one-audit/implementation-evidence/staging-dashboard-reports.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(max(x['warm_ms'])<200 for x in results),'Performance targets not met; inspect evidence'
if __name__=='__main__':run()
