"""Separate exact-owned Masters rehearsal; never broadens the read-only fixture.

Uses its unchanged staff account provenance helper, but has an independent
checkpoint/authorization boundary. No Squad lease: Masters requires a real
authenticated platform administrator. Audits/commands remain; revisions never
rewind. Only a proved run-owned Colors row can be removed.
"""
import uuid
from psycopg import sql
from psycopg.types.json import Jsonb
import tracker_read_fixture as staff
import test_hosted_business_journeys as business

FORMAT='tracker-colors-ui/v1'

def validate(state):
 assert state['format']==FORMAT and state['environment']=='staging'
 staff.validate(state['staff']);run=uuid.UUID(state['run_id'])
 assert state['run_id']==state['staff']['run_id']
 assert state['name']=='UI Colors '+run.hex and state['edited_name']==state['name']+' edited'
 assert state['staff']['actors'][1]['id'] is None,'This fixture never creates Viewer'
 return state

def plan(c):
 nested=staff.plan(c);run=nested['run_id']
 state={'format':FORMAT,'environment':'staging','run_id':run,'staff':nested,
  'name':'UI Colors '+uuid.UUID(run).hex,'edited_name':'UI Colors '+uuid.UUID(run).hex+' edited',
  'source_before':business.source_state(c),'generation':c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0],
  'domain_audit_start':c.execute('SELECT coalesce(max(id),0) FROM sa_domain.audit').fetchone()[0],
  'admin_audit_start':c.execute('SELECT coalesce(max(id),0) FROM sa_admin.audit').fetchone()[0],
  'crons':business.cron_state(c),'public_structure':business.identities.public_structure(c)}
 assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_colors WHERE name=ANY(%s)',([state['name'],state['edited_name']],)).fetchone()
 return validate(state)

def validate_journal(state,entries):
 validate(state);assert isinstance(entries,list) and len(entries)<=3
 for i,e in enumerate(entries):
  assert set(e)=={'action','body'} and e['action']==['create','update','delete'][i]
  body=e['body'];assert isinstance(body,dict)
  if i<2:
   assert set(body)=={'p_resource','p_action','p_payload','p_upload_ids','p_idempotency_key'}
   assert body['p_resource']=='colors' and body['p_action']==e['action'] and body['p_upload_ids']==[]
   assert str(uuid.UUID(body['p_idempotency_key']))==body['p_idempotency_key']
   p=body['p_payload'];assert set(p)==({'values','relations'} if i==0 else {'id','values','relations','expectedUpdatedAt'})
   assert p['relations']=={} and set(p['values'])=={'name','hex_code','is_deleted'}
   assert p['values']=={'name':state['name'] if i==0 else state['edited_name'],'hex_code':'#2457AA' if i==0 else '#196B45','is_deleted':'false'}
   if i:assert str(p['id']).isdigit() and p['expectedUpdatedAt']
  else:
   assert set(body)=={'resource','action','payload'} and body['resource']=='colors' and body['action']=='delete'
   assert set(body['payload'])=={'id'} and str(body['payload']['id']).isdigit()
 return entries

def cleanup(c,state,entries):
 """Atomic refusal for any unexplained edit, changed owned row or dependency."""
 validate_journal(state,entries);actor=state['staff']['actors'][0].get('id')
 with c.transaction():
  c.execute("SET LOCAL statement_timeout='120s'")
  assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Concurrent writer; preserve checkpoint'
  env=list(staff.environment(c));before=state['staff']['environment_before']
  assert env[:3]==before[:3]==['staging',False,None],'Environment changed'
  assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['generation'],'Refresh generation changed'
  assert c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()==(False,[],None),'Unrelated Squad lease exists'
  prior=c.execute("SELECT changes FROM sa_domain.audit WHERE operation='tracker.colors.cleanup' AND command_key=%s",(state['run_id'],)).fetchone()
  if prior:
   assert env[3:]==[prior[0]['edit_revision_after'],prior[0]['synced_revision_after']]
   assert business.source_state(c)==state['source_before']
   assert not actor or not c.execute('SELECT 1 FROM auth.users WHERE id=%s',(actor,)).fetchone()
   return prior[0]
  assert env[4]==before[4],'Source watermark changed'
  admins=c.execute('SELECT actor_id,resource,record_id,operation,before_data,after_data,xmin::text FROM sa_admin.audit WHERE id>%s ORDER BY id',(state['admin_audit_start'],)).fetchall()
  domains=c.execute('SELECT actor_id,command_key,operation,kind,entity_id,changes,xmin::text FROM sa_domain.audit WHERE id>%s ORDER BY id',(state['domain_audit_start'],)).fetchall()
  assert len(admins)<=len(entries)<=3 and len(domains)==min(len(admins),2),'Unexplained Masters/audit count'
  record=None
  for i,row in enumerate(admins):
   a,resource,id,op,old,new,xid=row;e=entries[i];p=e['body'].get('p_payload',{})
   assert str(a)==actor and resource=='colors' and op==e['action'],'Foreign or unexpected Masters edit'
   if i==0:
    assert old is None and new['name']==state['name'] and new['hex_code']=='#2457AA' and not new['is_deleted']
    record=id
    assert record>state['source_before']['sa_colors']['max_id'] if state['source_before']['sa_colors']['max_id'] is not None else record>0
   else:
    assert id==record and str(id)==str(p.get('id') if i==1 else e['body']['payload']['id'])
    assert old['name']==(state['name'] if i==1 else state['edited_name'])
    assert old['hex_code']==('#2457AA' if i==1 else '#196B45') and not old['is_deleted']
    assert new['name']==state['edited_name'] and new['hex_code']=='#196B45' and new['is_deleted']==(i==2)
   if i<2:
    d=domains[i];assert str(d[0])==actor and str(d[1])==e['body']['p_idempotency_key'] and d[2:5]==('master.saved','media',id) and d[-1]==xid
    assert d[5]=={'action':op,'resource':'colors','uploaded_fields':[],'detached_fields':[],'external_fields':[]}
    command=c.execute('SELECT operation,generation,result,payload_hash=sha256(convert_to(%s::jsonb::text,\'UTF8\')) FROM sa_domain.commands WHERE actor_id=%s AND key=%s',
     (Jsonb({'resource':'colors','action':op,'payload':p,'uploads':[]}),actor,d[1])).fetchone()
    assert command==('master.saved',state['generation'],new,True),'Command receipt differs'
  assert env[3]-before[3]==len(admins)+len(domains),'Unexplained revision change'
  if actor:
   assert c.execute('SELECT count(*) FROM sa_domain.commands WHERE actor_id=%s',(actor,)).fetchone()[0]==len(domains)
   assert not c.execute('SELECT 1 FROM sa_domain.media_uploads WHERE actor_id=%s',(actor,)).fetchone()
   jobs=c.execute('SELECT id,command_key,event_type,aggregate_kind,aggregate_id,status,attempts,lease_token,lease_until,payload FROM sa_domain.outbox WHERE actor_id=%s FOR UPDATE',(actor,)).fetchall()
   assert len(jobs)==len(domains)
   for j in jobs:
    d=next((d for d in domains if d[1]==j[1]),None)
    assert d and j[2:5]==('master.saved','media',record) and j[5:9]==('pending',0,None,None) and j[9]==d[5],'Unexpected/executed background work'
    assert not c.execute('SELECT 1 FROM sa_domain.job_attempts WHERE job_id=%s',(j[0],)).fetchone()
   c.execute("UPDATE sa_domain.outbox SET status='dead',last_error_code='REHEARSAL_CLEANUP',completed_at=now() WHERE actor_id=%s AND status='pending'",(actor,))
  if record is not None:
   actual=c.execute("SELECT sa_admin.read_record('colors',id),xmin::text FROM sa_snapshot_20261019.sa_colors WHERE id=%s FOR UPDATE",(record,)).fetchone()
   assert actual==(admins[-1][5],admins[-1][-1]),'Owned Colors row changed after its exact audited transaction'
   for table in ['sa_admin.media','sa_admin.record_extras','sa_media.references']:
    assert not c.execute(sql.SQL('SELECT 1 FROM {} WHERE resource=%s AND record_id=%s').format(sql.SQL(table)),('colors',record)).fetchone()
   # No cascade is accepted; every current FK child must be absent.
   for child,col,parent,parentcol in business.foreign_keys(c):
    if parent=='sa_colors':
     assert parentcol=='id' and not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE {}=%s LIMIT 1').format(sql.Identifier(business.SCHEMA),sql.Identifier(child),sql.Identifier(col)),(record,)).fetchone(),'Owned Color acquired dependent source rows'
   c.execute('DELETE FROM sa_snapshot_20261019.sa_colors WHERE id=%s',(record,))
  assert business.source_state(c)==state['source_before'],'Source net-zero proof failed'
  # Staff lifecycle remains unchanged and retains exact membership provenance.
  staff_proof=staff.cleanup(c,state['staff'])
  assert business.identities.public_structure(c)==state['public_structure']
  delta=env[3]-before[3]
  c.execute('UPDATE sa_sync.environment_state SET synced_revision=synced_revision+%s WHERE singleton',(delta,))
  proof={'run_id':state['run_id'],'source_content_restored':True,'removed_owned_colors':int(record is not None),
   'admin_operations':len(admins),'domain_commands':len(domains),'audit_and_commands_retained':True,'jobs_terminalized':True,
   'edit_revision_after':env[3],'synced_revision_after':env[4]+delta,'no_cutover_or_test_lease_change':True,
   'public_structure_unchanged':True,'staff_cleanup':staff_proof}
  c.execute("INSERT INTO sa_domain.audit(actor_id,operation,kind,entity_id,command_key,changes)VALUES(%s,'tracker.colors.cleanup','rehearsal',0,%s,%s)",(actor or state['run_id'],state['run_id'],Jsonb(proof)))
  return proof
