"""Real staging actors, 20k unrelated inbox rows, rollback-only queue journey."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from deploy import statements

def run():
 results=[]
 with connect('staging') as c:
  before=public_structure(c)
  with c.transaction():
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
   pending=not c.execute("SELECT to_regclass('sa_domain.devices')").fetchone()[0]
   if pending:
    for statement in statements((ROOT/'supabase/migrations/20261108053948_squad_notification_contracts.sql').read_text()):c.execute(statement)
   for name in ['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq','sa_snapshot_20261019.sa_notifications_id_seq']:
    v,called=c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone();c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*name.split('.')),sql.Literal(v+int(called))))
   actor,auth,order=c.execute("""SELECT s.id,m.auth_user_id,o.id FROM sa_snapshot_20261019.sa_users s JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=s.id
    JOIN auth.users u ON u.id=m.auth_user_id JOIN sa_snapshot_20261019.sa_orders o ON o.customer_sc_id=s.id
    WHERE s.role=1 AND s.deleted_at IS NULL AND s.disabled IS NOT TRUE AND m.enrollment_state='ready' AND u.role='sa_app'
    AND (u.banned_until IS NULL OR u.banned_until<now()) AND o.status=0 AND o.order_item_type=1 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.deleted_at IS NULL AND o.is_deleted IS NOT TRUE ORDER BY o.id DESC LIMIT 1""").fetchone()
   session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,auth));c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   def app():
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(auth),'session_id':str(session),'role':'sa_app'}),));c.execute('SET LOCAL ROLE sa_app')
   def worker():
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role')
   def measure(name,q,args,budget=200):
    values=[]
    for n in range(12):
     with c.transaction():
      plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+q,args).fetchone()[0][0]
      if n>=2:values.append(plan['Execution Time'])
      raise psycopg.Rollback()
    value={'name':name,'p95_ms':max(values),'samples':len(values),'target_ms':budget};results.append(value);print(json.dumps(value),flush=True)
   app();args=(uuid.uuid4(),'android','synthetic_'+uuid.uuid4().hex,None,uuid.uuid4());measure('device_registration','SELECT canto_api.v1_device_save(%s,%s,%s,%s,%s)',args)
   device=c.execute('SELECT canto_api.v1_device_save(%s,%s,%s,%s,%s)',args).fetchone()[0]
   c.execute('SET LOCAL ROLE postgres');version=c.execute("SELECT sa_domain.version('order',%s)",(order,)).fetchone()[0];app()
   args=(order,'2030-02-01T10:00:00Z','Rollback notification acceptance',version,uuid.uuid4());measure('due_change_with_notification_capture','SELECT canto_api.v1_order_due_save(%s,%s,%s,%s,%s)',args,500)
   c.execute('SELECT canto_api.v1_order_due_save(%s,%s,%s,%s,%s)',args)
   worker();fanout=next(j for j in c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'] if j['handler']=='notification_fanout')
   args=(uuid.UUID(fanout['id']),uuid.UUID(fanout['lease_token']));measure('recipient_fanout','SELECT canto_api.squad_notification_fanout(%s,%s)',args,500);c.execute('SELECT canto_api.squad_notification_fanout(%s,%s)',args)
   jobs=c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'];c.execute('SET LOCAL ROLE postgres')
   target=next(j for j in jobs if c.execute('SELECT actor_id FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),)).fetchone()[0]==auth);worker();args=(uuid.UUID(target['id']),uuid.UUID(target['lease_token']))
   measure('delivery_prepare_current_recipient','SELECT canto_api.squad_notification_prepare(%s,%s)',args,500);prepared=c.execute('SELECT canto_api.squad_notification_prepare(%s,%s)',args).fetchone()[0]
   assert prepared['state']=='prepared' and prepared['devices'][0]['id']==device['id']
   settled=c.execute('SELECT canto_api.squad_notification_finish(%s,%s,%s)',args+(Jsonb([{'id':device['id'],'revision':'1','code':'VALIDATED'}]),)).fetchone()[0];assert settled['state']=='done'
   c.execute('SET LOCAL ROLE postgres')
   other=c.execute('SELECT id FROM sa_snapshot_20261019.sa_users WHERE id<>%s LIMIT 1',(actor,)).fetchone()[0]
   c.execute("INSERT INTO sa_snapshot_20261019.sa_notifications(notification_type,status,recipient_id,order_id,created_at,updated_at) SELECT 26,1,CASE WHEN n<=100 THEN %s ELSE %s END,%s,now(),now() FROM generate_series(1,20100)n",(actor,other,order));c.execute('ANALYZE sa_snapshot_20261019.sa_notifications');app()
   measure('inbox_25_with_20k_unrelated_rows','SELECT canto_api.v1_notifications_list(NULL,NULL,25)',(),200)
   measure('inbox_100_with_20k_unrelated_rows','SELECT canto_api.v1_notifications_list(NULL,NULL,100)',(),500)
   page=c.execute('SELECT canto_api.v1_notifications_list(NULL,NULL,25)').fetchone()[0];more=c.execute('SELECT canto_api.v1_notifications_list(NULL,%s,25)',(page['next_cursor'],)).fetchone()[0];assert not{x['id'] for x in page['data']}&{x['id'] for x in more['data']}
   c.execute('SET LOCAL ROLE postgres');assert public_structure(c)==before;raise psycopg.Rollback()
  assert public_structure(c)==before
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'public_structure_unchanged':True,'all_changes_and_sequences_rolled_back':True,'scope':'Two warmups and ten measured database RPC executions. Real mapped coordinator changes an assigned order due date, fanout resolves recipients, recipient authorization creates the inbox record, device result is simulated VALIDATED; no provider calls. 20k unrelated inbox rows and disjoint pages. Not mixed concurrent-load or physical-phone acceptance.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-notifications-performance.json').write_text(json.dumps(evidence,indent=2)+'\n');assert all(r['p95_ms']<r['target_ms'] for r in results),results
if __name__=='__main__':run()
