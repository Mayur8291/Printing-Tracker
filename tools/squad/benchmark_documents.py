"""Hosted SQL document budgets, current real actor, rollback-only fixtures."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
def run():
 results=[];credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text())
 with connect('staging') as c:
  before=public_structure(c)
  with c.transaction():
   assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   for name in ['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq','sa_domain.documents_sequence_id_seq']:
    value=c.execute('SELECT last_value FROM '+name).fetchone()[0];c.execute(sql.SQL('ALTER SEQUENCE '+name+' RESTART WITH {}').format(sql.Literal(value+1)))
   auth=c.execute('SELECT auth_user_id FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',(credentials['email'],)).fetchone()[0]
   session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,auth));c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   classes=[str(r[0]) for r in c.execute('SELECT DISTINCT rmp_class_id FROM sa_snapshot_20261019.sa_rmp_skus WHERE is_deleted IS NOT TRUE ORDER BY rmp_class_id LIMIT 101')]
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
    result={'name':name,'p95_ms':max(values),'samples':len(values),'target_ms':budget};results.append(result);print(json.dumps(result),flush=True)
   app();args=('catalogue',Jsonb({'selection':{'class_ids':classes}}),uuid.uuid4());measure('catalogue_request','SELECT canto_api.v1_document_request(%s,%s,%s)',args,500)
   document=c.execute('SELECT canto_api.v1_document_request(%s,%s,%s)',args).fetchone()[0];worker();j=c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'][0];args=(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))
   measure('capture_101_classes','SELECT canto_api.squad_document_prepare(%s,%s)',args,2000);prepared=c.execute('SELECT canto_api.squad_document_prepare(%s,%s)',args).fetchone()[0]
   c.execute('SET LOCAL ROLE postgres');c.execute("UPDATE sa_domain.documents SET state='ready',object_path='g0/'||actor_id::text||'/'||id::text||'/document.pdf',bytes=1000,sha256=repeat('a',64),page_count=100,expires_at=now()+interval '3 days' WHERE id=%s",(uuid.UUID(document['id']),))
   c.execute("""INSERT INTO sa_domain.documents(actor_id,legacy_user_id,role_id,generation,kind,request,snapshot,snapshot_hash,authority_scope,state,expires_at)
    SELECT CASE WHEN n<=100 THEN d.actor_id ELSE '00000000-0000-4000-8000-000000000001'::uuid END,d.legacy_user_id,d.role_id,d.generation,d.kind,d.request,d.snapshot,d.snapshot_hash,d.authority_scope,'ready',d.expires_at FROM sa_domain.documents d CROSS JOIN generate_series(1,2100)n WHERE d.id=%s""",(uuid.UUID(document['id']),));c.execute('ANALYZE sa_domain.documents');app()
   measure('list_25_with_2000_unrelated_documents','SELECT canto_api.v1_documents_list(NULL,NULL,NULL,25,false)',())
   measure('list_100_with_2000_unrelated_documents','SELECT canto_api.v1_documents_list(NULL,NULL,NULL,100,false)',(),500)
   measure('document_detail','SELECT canto_api.v1_document_get(%s)',(document['id'],))
   measure('scoped_download_grant','SELECT canto_api.account_document_grant(%s)',(uuid.UUID(document['id']),))
   c.execute('SET LOCAL ROLE postgres');assert public_structure(c)==before;raise psycopg.Rollback()
  assert public_structure(c)==before
 report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'all_changes_and_sequences_rolled_back':True,'public_structure_unchanged':True,'scope':'Two warmups and ten measured database executions. Real mapped customer, 101 source classes, 100 own and 2000 unrelated document histories. Rendering/storage/mail are separately verified through deployed Edges. Not a mixed-load capacity SLA.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-documents-performance.json').write_text(json.dumps(report,indent=2)+'\n');assert all(r['p95_ms']<r['target_ms'] for r in results),results
if __name__=='__main__':run()
