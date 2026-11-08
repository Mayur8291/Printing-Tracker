"""Staging read-only media permissions and bounded batch measurements."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 results=[];checks=[]
 with connect('staging') as c:
  with c.transaction():
   actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u
    JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
    JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND(au.banned_until IS NULL OR au.banned_until<now())
    WHERE u.role IN(0,1,2,3,10) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND(u.role<>3 OR u.approved IS NOT FALSE) ORDER BY u.role,u.id""").fetchall()
   refs=[{'resource':'base_products','record_id':str(row[0]),'field':'image'} for row in c.execute("SELECT r.record_id FROM sa_media.references r JOIN sa_snapshot_20261019.sa_base_products b ON b.id=r.record_id AND r.source_value=b.image WHERE r.resource='base_products' AND r.field='image' AND r.status='ready' AND b.is_deleted IS NOT TRUE ORDER BY r.record_id LIMIT 25")]
   assert len(refs)==25,'25 real catalogue images required'
   for role,id_,auth in actors:
    c.execute('SET LOCAL ROLE postgres');sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,auth))
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
    times=[]
    for _ in range(11):times.append(c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.account_media_resolve(%s)',(Jsonb(refs),)).fetchone()[0][0]['Execution Time'])
    result={'role':role,'scenario':'25 real catalogue references','samples_ms':times[1:],'p95_ms':max(times[1:]),'target_ms':200};results.append(result);print(json.dumps({k:result[k] for k in ['role','p95_ms','target_ms']}),flush=True)
    data=c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb(refs),)).fetchone()[0];assert len(data['references'])==25 and all(x['status']=='ready' for x in data['references'])
   checks.append('25 actual catalogue files resolved for Admin, SC, PC, Customer and Dealer')
   c.execute('SET LOCAL ROLE postgres')
   owner=c.execute("""SELECT p.created_by_id,m.auth_user_id,pi.id FROM sa_snapshot_20261019.sa_product_images pi JOIN sa_snapshot_20261019.sa_products p ON p.id=pi.product_id
    JOIN sa_media.references r ON r.resource='product_images' AND r.record_id=pi.id AND r.field='image' AND r.status='ready' AND r.source_value=pi.image
    JOIN sa_snapshot_20261019.sa_users u ON u.id=p.created_by_id AND u.role=3 AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE
    JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready' ORDER BY pi.id LIMIT 1""").fetchone()
   assert owner,'A real customer-owned migrated image required';sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,owner[1]))
   c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(owner[1]),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
   own=[{'resource':'product_images','record_id':str(owner[2]),'field':'image'}];assert c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb(own),)).fetchone()[0]['references'][0]['status']=='ready'
   c.execute('SET LOCAL ROLE postgres');other=c.execute("SELECT m.auth_user_id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready' WHERE u.role=3 AND u.id<>%s AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE ORDER BY u.id LIMIT 1",(owner[0],)).fetchone()[0]
   sid2=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid2,other));c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(other),'session_id':str(sid2)}),));c.execute('SET LOCAL ROLE sa_app')
   try:
    with c.transaction():c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb(own),))
   except psycopg.errors.NoDataFound:checks.append('real owner can resolve migrated private photograph; other customer denied')
   else:raise AssertionError('Foreign photograph was exposed')
   raise psycopg.Rollback()
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'checks':checks,'scope':'real mapped users and file metadata; temporary sessions rolled back; no business/Storage writes'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-media-grants-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['p95_ms']<x['target_ms'] for x in results),results
 print(json.dumps({'passed':checks,'temporary_sessions_rolled_back':True}))
if __name__=='__main__':run()
