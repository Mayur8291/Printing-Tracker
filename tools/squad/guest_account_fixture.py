"""No side effects on import. Exact-owned guest fixture for reviewed staging execution.

This module deliberately has no execute CLI. The release integrator supplies its
connection, worker sender and real-inbox proof adapter only after reviewing the
capability and cleanup. It never reads OTPs from the database or rewinds revisions.
"""
import datetime,json,secrets,uuid
from pathlib import Path
from psycopg import sql
from psycopg.types.json import Jsonb
import test_hosted_personas as identities
from test_hosted_business_journeys import source_state
from business_cleanup_accounts import independent_staff_changes

KINDS=('register','confirm','recovery','invite')
from canonical_fixture_location import canonical_locations,unused_location,assert_unused_location


def email(run,kind):return f'squad-guest-{uuid.UUID(str(run)).hex}-{kind}@mailinator.com'

def validate(state):
 assert state['format']=='squad-guest-fixture/v1' and state['environment']=='staging'
 run=uuid.UUID(state['run_id']);base=state['base']
 assert type(base) is int and identities.MIN_ID<=base and base+4<identities.MAX_ID
 assert set(state['flows'])==set(KINDS) and len({v['id'] for v in state['flows'].values()})==4
 assert set(state['actors'])=={'admin','confirm','recovery','invite'}
 for index,kind in enumerate(['admin','confirm','recovery','invite']):
  a=state['actors'][kind];assert a['id']==base+index and a['email']==email(run,kind);uuid.UUID(a['auth_id'])
 for kind,f in state['flows'].items():
  assert f['id']==str(uuid.uuid5(run,'guest.'+kind)) and f['email']==email(run,kind)
 assert set(state['profile'])=={'first_name','last_name','company_name','phone','addresses'}
 assert state['profile']['first_name']=='SQG' and state['profile']['last_name']==run.hex
 assert state['profile']['company_name']=='SQG '+run.hex and state['profile']['phone']=='9000000000'
 assert len(state['profile']['addresses'])==1
 address=state['profile']['addresses'][0]
 assert set(address)=={'address','state','city','zip_code'} and address['address']=='Synthetic acceptance only' and address['zip_code']=='999999'
 assert (address['state'],address['city']) in canonical_locations()
 assert not {'password','passwords','service_role','access_token','refresh_token'}.intersection(state)
 return state

def plan(c):
 identity=identities.plan(c) # Existing read-only clean-mirror and ID-range guards.
 run=uuid.uuid4();base=identity['base'];location=unused_location(c)
 state={'format':'squad-guest-fixture/v1','environment':'staging','run_id':str(run),'base':base,
  'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'generation':identity['generation'],
  'edit_revision':identity['edit_revision'],'synced_revision':identity['synced_revision'],
  'actors':{kind:{'id':base+i,'auth_id':str(uuid.uuid4()),'email':email(run,kind)} for i,kind in enumerate(['admin','confirm','recovery','invite'])},
  'flows':{kind:{'id':str(uuid.uuid5(run,'guest.'+kind)),'email':email(run,kind)} for kind in KINDS},
  'profile':{'first_name':'SQG','last_name':run.hex,'company_name':'SQG '+run.hex,'phone':'9000000000','addresses':[{'address':'Synthetic acceptance only',**location,'zip_code':'999999'}]},
  'source_before':source_state(c),'staff_before':identities.staff_auth(c),'public_before':identities.public_structure(c),
  'audit_start':c.execute('SELECT coalesce(max(id),0) FROM sa_domain.audit').fetchone()[0]}
 validate(state)
 for address in [a['email'] for a in state['actors'].values()]+[state['flows']['register']['email']]:
  assert not c.execute('SELECT 1 FROM auth.users WHERE lower(email)=%s',(address,)).fetchone()
  assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=%s',(address,)).fetchone()
  assert not c.execute('SELECT 1 FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',(address,)).fetchone()
 return state

def auth_digest(c,auth):
 return c.execute("""SELECT encode(sha256(convert_to(jsonb_build_object('id',a.id,'role',a.role,'email',a.email,'encrypted_password',a.encrypted_password,'banned_until',a.banned_until,'metadata',a.raw_app_meta_data)::text,'UTF8')),'hex') FROM auth.users a WHERE id=%s""",(auth,)).fetchone()[0]

def prepare(c,state):
 validate(state);credentials={};run=uuid.UUID(state['run_id'])
 with c.transaction():
  assert source_state(c)==state['source_before'],'Source changed before fixture'
  assert_unused_location(c,state['profile']['addresses'][0])
  assert c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()==('staging',False,None,state['edit_revision'],state['synced_revision'])
  assert c.execute('SELECT generation,allow_test_writes FROM sa_domain.runtime_state').fetchone()==(state['generation'],False)
  auths=[uuid.UUID(a['auth_id']) for a in state['actors'].values()]
  c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=clock_timestamp()+interval '15 minutes'",(auths,))
  for kind,a in state['actors'].items():
   password=secrets.token_urlsafe(30);confirmed=kind in ['admin','recovery']
   hashed=c.execute("SELECT extensions.crypt(%s,extensions.gen_salt('bf',10))",(password,)).fetchone()[0]
   c.execute("""INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,role,encrypted_password,approved,onboarded,disabled,confirmed_at,created_at,updated_at)
    VALUES(%s,%s,%s,%s,%s,true,true,false,CASE WHEN %s THEN now() END,now(),now())""",(a['id'],a['email'],'SQG '+run.hex+' '+kind,0 if kind=='admin' else 3,hashed,confirmed))
   c.execute('INSERT INTO sa_sync.legacy_identity_keys VALUES(%s)',(a['id'],))
   c.execute("INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) VALUES(%s,%s,%s,'candidate','ready',%s,%s)",(a['auth_id'],a['id'],a['email'],confirmed,'source_confirmed' if confirmed else 'not_activated'))
   c.execute("""INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at)
    VALUES('00000000-0000-0000-0000-000000000000',%s,'authenticated','sa_app',%s,%s,CASE WHEN %s THEN now() END,'','','','',%s,'{}',false,now(),now())""",(a['auth_id'],a['email'],hashed,confirmed,Jsonb({'provider':'email','providers':['email'],'application':'canto','legacy_user_id':a['id'],'legacy_role_id':0 if kind=='admin' else 3})))
   c.execute("INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) VALUES(%s,%s,%s,'email',now(),now())",(a['auth_id'],a['auth_id'],Jsonb({'sub':a['auth_id'],'email':a['email'],'email_verified':confirmed,'phone_verified':False})))
   credentials[kind]={**a,'password':password}
  c.execute('SET CONSTRAINTS ALL IMMEDIATE');c.execute('SET CONSTRAINTS ALL DEFERRED')
  for kind,f in state['flows'].items():
   a=state['actors'].get(kind)
   c.execute("""INSERT INTO sa_domain.account_rehearsals(flow_id,run_id,purpose,email,actor_id,legacy_user_id,auth_user_id,generation,payload_hash,expires_at)
    SELECT %s,%s,%s,%s,%s,%s,%s,generation,encode(sha256(convert_to(%s::jsonb::text,'UTF8')),'hex'),test_write_expires_at FROM sa_domain.runtime_state""",(f['id'],run,kind,f['email'],state['actors']['admin']['auth_id'],a['id'] if a else None,a['auth_id'] if a else None,Jsonb(state['profile'] if kind=='register' else {})))

 return credentials

def revoke(c,state):
 validate(state)
 current=c.execute('SELECT allow_test_writes,test_actor_ids FROM sa_domain.runtime_state WHERE singleton FOR UPDATE').fetchone()
 expected={uuid.UUID(a['auth_id']) for a in state['actors'].values()}
 assert (current[0] is False and not current[1]) or(current[0] is True and set(current[1])==expected),'Rehearsal write ownership changed'
 c.execute('INSERT INTO sa_domain.account_rehearsal_revocations(flow_id) SELECT flow_id FROM sa_domain.account_rehearsals WHERE run_id=%s ON CONFLICT DO NOTHING',(state['run_id'],))
 c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")

def cleanup(c,state):
 """Reviewable exact cleanup; every unexplained mutation aborts the transaction."""
 validate(state);run=uuid.UUID(state['run_id']);flow_ids=[uuid.UUID(f['id']) for f in state['flows'].values()]
 with c.transaction():
  c.execute("SET LOCAL statement_timeout='120s'")
  env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
  assert env[:3]==('staging',False,None) and env[4]>=state['synced_revision'],'Environment changed'
  assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['generation']
  prior=c.execute("SELECT changes FROM sa_domain.audit WHERE operation='rehearsal.guest_cleanup' AND command_key=%s",(run,)).fetchone()
  if prior:
   assert env[3:]==(prior[0]['edit_revision_after'],prior[0]['synced_revision_after']) and source_state(c)==state['source_before']
   return prior[0]
  assert env[4]==state['synced_revision']
  caps=c.execute('SELECT flow_id,purpose,email,actor_id,generation FROM sa_domain.account_rehearsals WHERE run_id=%s',(run,)).fetchall()
  if not caps:
   assert env[3:]==(state['edit_revision'],state['synced_revision']) and source_state(c)==state['source_before']
   assert not c.execute('SELECT 1 FROM auth.users WHERE id=ANY(%s::uuid[])',([a['auth_id'] for a in state['actors'].values()],)).fetchone()
   assert c.execute('SELECT allow_test_writes FROM sa_domain.runtime_state').fetchone()[0] is False
   return {'run_id':str(run),'no_committed_fixture':True,'source_content_restored':True}
  assert len(caps)==4 and {row[0] for row in caps}==set(flow_ids)
  for fid,kind,address,actor,generation in caps:
   assert str(fid)==state['flows'][kind]['id'] and address==state['flows'][kind]['email'] and str(actor)==state['actors']['admin']['auth_id'] and generation==state['generation']
  receipts=c.execute('SELECT flow_id,phase,transaction_id::text,revision_before,revision_after,snapshot,xmin::text FROM sa_domain.account_rehearsal_receipts WHERE flow_id=ANY(%s::uuid[]) ORDER BY id',(flow_ids,)).fetchall()
  assert receipts and len(receipts)<=100,'Unbounded guest phase history'
  delta=sum(row[4]-row[3] for row in receipts)
  assert env[3]-state['edit_revision']==delta,'Unexplained source/Auth revision'
  assert all(0<=row[4]-row[3]<=1 for row in receipts)
  latest={str(row[0]):row[5] for row in receipts}
  xids={row[6] for row in receipts}
  setup_xids={row[6] for row in receipts if row[1]=='registered'}
  assert len(setup_xids)==1,'Capability setup did not commit atomically'
  targets=dict(state['actors']);owned_addresses=set();owned_links=set()
  for kind,f in state['flows'].items():
   current=c.execute('SELECT sa_domain.account_rehearsal_snapshot(%s)',(f['id'],)).fetchone()[0];proof=latest[f['id']]
   assert {k:v for k,v in current.items() if k!='auth'}=={k:v for k,v in proof.items() if k!='auth'},'Guest state differs from last immutable receipt'
   assert (current.get('auth') or {}).get('hash')==(proof.get('auth') or {}).get('hash'),'Guest credential changed outside provider receipt'
   if current['legacy_user_id'] is not None:
    targets[kind]={'id':int(current['legacy_user_id']),'auth_id':current['auth_user_id'],'email':f['email']}
    assert current['person'] and current['mapping']
    assert current['person']['xmin'] in xids and current['mapping']['xmin'] in xids
    for field,owned in [('addresses',owned_addresses),('dealer_links',owned_links)]:
     for row in current[field]:assert row['xmin'] in xids;owned.add(int(row['id']))
   for job in current['jobs']:
    assert job['event'] in ['account.challenge_mail','account.'+kind+'_completed']
    assert job['xmin'] in xids and job['attempts']<=1
    if job['event']!='account.challenge_mail':assert job['status']=='pending' and job['attempts']==0,'Unexpected provider worker execution'
  admin=state['actors']['admin']
  assert all(snapshot['actor'] and snapshot['actor']['source_xmin'] in setup_xids for snapshot in latest.values())
  audits=c.execute('SELECT actor_id,command_key,operation,entity_id,changes,generation,xmin::text FROM sa_domain.audit WHERE id>%s ORDER BY id',(state['audit_start'],)).fetchall()
  for actor,key,operation,entity,changes,generation,xid in audits:
   kind=next((k for k,f in state['flows'].items() if f['id']==str(key)),None)
   assert kind and operation=='account.'+kind+'_completed' and changes=={'purpose':kind} and generation==state['generation'] and xid in xids
   assert entity==targets[kind]['id'] and str(actor)==(admin['auth_id'] if kind=='invite' else targets[kind]['auth_id'])
  assert len(audits)==len({str(row[1]) for row in audits}), 'Duplicate completion audit'
  auths=[uuid.UUID(a['auth_id']) for a in targets.values()];ids=[a['id'] for a in targets.values()]
  assert len(auths)==len(set(auths)) and len(ids)==len(set(ids))
  # Lock current live staff only at the final stage. Preserve external Auth
  # activity rather than ever restoring unrelated full rows.
  c.execute("SELECT id FROM auth.users WHERE role IS DISTINCT FROM 'sa_app' ORDER BY id FOR SHARE")
  staff_current=identities.staff_auth(c)
  independent_staff_changes(c,state['staff_before'],staff_current,auths,{int(x) for x in xids})
  revoke(c,state)
  c.execute("UPDATE sa_domain.outbox SET status='dead',last_error_code='REHEARSAL_CLEANUP',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE command_key=ANY(%s::uuid[]) AND status IN('pending','leased')",(flow_ids,))
  c.execute("UPDATE sa_domain.job_attempts SET state='expired',finished_at=now(),error_code='REHEARSAL_CLEANUP' WHERE job_id IN(SELECT id FROM sa_domain.outbox WHERE command_key=ANY(%s::uuid[])) AND state='leased'",(flow_ids,))
  c.execute("UPDATE sa_domain.account_flows SET state=CASE WHEN state='done' THEN state ELSE 'expired' END,code_cipher=NULL,payload='{}',password_fingerprint=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=ANY(%s::uuid[])",(flow_ids,))
  c.execute('UPDATE sa_domain.credential_states SET active_flow=NULL,lease_until=NULL WHERE legacy_user_id=ANY(%s::bigint[])',(ids,))
  c.execute('DELETE FROM auth.refresh_tokens WHERE user_id=ANY(%s::text[])',([str(a) for a in auths],));c.execute('DELETE FROM auth.sessions WHERE user_id=ANY(%s::uuid[])',(auths,))
  c.execute("UPDATE sa_identity.sa_auth_identities SET enrollment_state='blocked' WHERE auth_user_id=ANY(%s::uuid[])",(auths,))
  c.execute('DELETE FROM auth.identities WHERE user_id=ANY(%s::uuid[])',(auths,));c.execute('DELETE FROM auth.users WHERE id=ANY(%s::uuid[])',(auths,))
  for table,values in [('sa_user_dealers',owned_links),('sa_addresses',owned_addresses),('sa_users',ids)]:
   c.execute(sql.SQL('DELETE FROM sa_snapshot_20261019.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(table)),(list(values),))
  c.execute('SET CONSTRAINTS ALL IMMEDIATE')
  assert source_state(c)==state['source_before'],'Source is not net-zero; refusing cleanup'
  c.execute('UPDATE sa_sync.environment_state SET synced_revision=synced_revision+%s WHERE singleton',(delta,))
  result={'run_id':str(run),'edit_revision_before':state['edit_revision'],'edit_revision_after':env[3],'synced_revision_after':env[4]+delta,'owned_revision_delta':delta,'completed_flows':len(audits),'removed_auth_accounts':len(auths),'removed_source_people':len(ids),'audit_and_receipts_retained':True,'source_content_restored':True,'staff_auth_preserved_during_cleanup':True,'staff_auth_unchanged_since_fixture':staff_current==state['staff_before']}
  c.execute("INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes) VALUES(%s,%s,'rehearsal.guest_cleanup','rehearsal',%s,%s,%s)",(admin['auth_id'],admin['id'],state['base'],run,Jsonb(result)))
  assert identities.staff_auth(c)==staff_current and identities.public_structure(c)==state['public_before']
  return result
