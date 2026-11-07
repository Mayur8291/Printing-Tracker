"""Real staging quote/read contracts and timings; all sessions/cache rows roll back."""
import datetime,decimal,json,math,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
from psycopg.types.json import Jsonb
import psycopg
D=decimal.Decimal

def run():
 results=[]
 with connect('staging') as c:
  with c.transaction():
   c.execute("SET LOCAL statement_timeout='10s'")
   actor=c.execute("""SELECT u.id,m.auth_user_id,a.id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id
    JOIN sa_snapshot_20261019.sa_addresses a ON a.user_id=u.id AND a.deleted_at IS NULL AND length(btrim(a.state))>0
    WHERE u.role=3 AND m.enrollment_state='ready' AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE
    ORDER BY u.id,a.is_primary DESC,a.id LIMIT 1""").fetchone()
   assert actor,'Eligible staging customer/address required'
   config=c.execute("""SELECT b.id,f.id,col.id,cat.id FROM sa_snapshot_20261019.sa_base_products b
    JOIN sa_snapshot_20261019.sa_base_product_fabrics bf ON bf.base_product_id=b.id AND bf.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=bf.fabric_id AND f.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_fabric_colors fc ON fc.fabric_id=f.id AND fc.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_colors col ON col.id=fc.color_id AND col.is_deleted IS NOT TRUE AND col.created_by_id IS NULL
    JOIN sa_snapshot_20261019.sa_base_product_categories bc ON bc.base_product_id=b.id AND bc.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_categories cat ON cat.id=bc.category_id WHERE b.is_deleted IS NOT TRUE ORDER BY b.id,f.id,col.id,cat.id LIMIT 1""").fetchone()
   size=c.execute('SELECT id FROM sa_snapshot_20261019.sa_sizes ORDER BY id LIMIT 1').fetchone()[0]
   before=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
   session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session,actor[1]))
   c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor[1]),'session_id':str(session)}),));c.execute('SET LOCAL ROLE sa_app')
   classes=c.execute("SELECT canto_api.v1_rmp_search('{}',NULL,NULL,30)").fetchone()[0]['data'];sku=None
   for cl in classes:
    variants=c.execute('SELECT canto_api.v1_rmp_variants(%s)',(int(cl['id']),)).fetchone()[0]['data']
    sku=next((v for v in variants if v['price'] is not None),None)
    if sku:break
   assert sku,'Eligible SKU/price required'
   rmp={'kind':'rmp','skus':[{'sku_id':sku['id'],'quantity':6}]}
   custom={'kind':'custom','configuration':dict(zip(['base_product_id','fabric_id','fabric_color_id','category_id'],map(str,config))),
    'quantities':[{'size_id':str(size),'quantity':6}]}
   for name,lines in [('rmp',[rmp]),('custom',[custom]),('mixed',[rmp,custom])]:
    request={'customer_id':str(actor[0]),'address_id':str(actor[2]),'lines':lines}
    quote=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb(request),)).fetchone()[0]
    assert len(quote['lines'])==len(lines) and 'costs' not in quote['lines'][0]
    assert D(quote['total'])==sum(D(quote[k]) for k in ['subtotal','branding_total','cgst','sgst','igst']).quantize(D('.01'))
    samples=[]
    for n in range(12):
     plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_quote(%s)',(Jsonb(request),)).fetchone()[0][0]
     if n>=2:samples.append(plan['Execution Time'])
    result={'query':name+'_quote','samples':len(samples),'database_p95_ms':round(sorted(samples)[math.ceil(len(samples)*.95)-1],2)}
    results.append(result);print(json.dumps(result),flush=True)
   c.execute('SET LOCAL ROLE postgres');assert c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()==before
   raise psycopg.Rollback()
 report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'EXPLAIN ANALYZE; 2 warmups, 10 samples; DB execution excludes network',
 'business_writes':0,'all_temporary_sessions_and_quotes_rolled_back':True,'results':results}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-pricing-performance.json').write_text(json.dumps(report,indent=2)+'\n')
 assert all(r['database_p95_ms']<400 for r in results),'Quote p95 target failed'
if __name__=='__main__':run()
