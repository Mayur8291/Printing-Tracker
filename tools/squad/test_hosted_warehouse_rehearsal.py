"""Exact staging Uniware provider contract; default is read-only preflight.

--execute captures actual SDK DTOs in a rollback, registers their immutable
manifest, then runs the bounded lifecycle. --recover only reconciles/cleans the
same durable run. No production, generic queue, source commit or cutover.
"""
import argparse,datetime,hashlib,json,os,secrets,sys,time,uuid,urllib.error,urllib.request
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
from warehouse_source_capture import capture,ROOT
from profile_hosted_business_journeys import fence_sequences,sequence_states,preflight
from test_hosted_business_journeys import source_state,cron_state
from test_hosted_personas import connect,public_structure,staff_auth

PRIVATE=ROOT/'tools/squad/private';CHECKPOINT=PRIVATE/'warehouse-rehearsal-checkpoint.json'
URL='https://scvojtvgnkmbupvyslmb.supabase.co';TENANT='scottinternational'
STEPS=('preflight','customer','submit','reconcile','cancel_initial','replace','reconcile_replacement','cancel_replacement','customer_disable')

def save(state):
 PRIVATE.mkdir(exist_ok=True,mode=0o700);temp=CHECKPOINT.with_suffix('.tmp')
 with temp.open('w') as f:
  os.chmod(temp,0o600);json.dump(state,f,indent=2);f.flush();os.fsync(f.fileno())
 temp.replace(CHECKPOINT)

def validate(state):
 assert state['format']=='squad-warehouse-rehearsal/v1' and state['environment']=='staging'
 run=uuid.UUID(state['run_id']);assert state['email']==f'squad-warehouse-{run.hex[:16]}@mailinator.com'
 assert 1950000000<=state['customer_id']<1960000000 and 1960000000<=state['order_id']<1970000000
 assert state['capture']['source']['customer_id']==state['customer_id'] and state['capture']['source']['order_id']==state['order_id']
 assert state['capture']['customer']['payload']['customer']['partyContacts'][0]['email']==state['email']
 assert state['rollback_verified'] is True
 return state

def capture_source(c):
 before=preflight(c);runtime=c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0]
 source=source_state(c);staff=staff_auth(c);structure=public_structure(c);crons=cron_state(c)
 # Existing catalogue is only read. No product, price or stock is modified.
 row=c.execute("""SELECT s.id,s.name FROM sa_snapshot_20261019.sa_rmp_skus s
  JOIN sa_snapshot_20261019.sa_rmp_prices p ON p.rmp_sku_id=s.id
  WHERE s.is_deleted IS NOT TRUE AND p.price>0 AND p.price<500
   AND s.name ~ '^[A-Za-z0-9_-]{1,100}$' ORDER BY p.price,s.id LIMIT 1""").fetchone()
 assert row,'No bounded source SKU available'
 run=uuid.uuid4();customer_id=1950000000+secrets.randbelow(9990000);order_id=1960000000+secrets.randbelow(9990000)
 email=f'squad-warehouse-{run.hex[:16]}@mailinator.com';seqs=None
 with c.transaction():
  seqs=fence_sequences(c)
  data,result=capture(c,run,customer_id,order_id,row[0],email)
  raise psycopg.Rollback()
 assert before==preflight(c) and seqs==sequence_states(c),'Rollback state or sequences changed'
 assert source==source_state(c) and staff==staff_auth(c) and structure==public_structure(c),'Rollback source/staff/public mismatch'
 assert runtime==c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0] and crons==cron_state(c)
 state={'format':'squad-warehouse-rehearsal/v1','environment':'staging','run_id':str(run),'customer_id':customer_id,'order_id':order_id,'email':email,
  'sku':row[1],'capture':data,'capture_result':result,'rollback_verified':True,'rollback_tables':len(source),'rollback_sequences':len(seqs),
  'public_structure':structure,'staff_auth':staff,'environment_state':list(before),'crons':crons,'events':[],'registered':False}
 save(state);return state

def status(c,state):
 return {row[0]:{'attempted':row[1],'completed':row[2],'state':row[3],'error_code':row[4]} for row in c.execute(
  'SELECT step,attempted,completed,state,last_error_code FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s ORDER BY step',(state['run_id'],))}

def bind_manifest(c,state):
 """A local run UUID is not authority to operate another server capability."""
 row=c.execute('''SELECT tenant,customer_id,order_id,controlled_email,source_capture,manifest_json,manifest_sha256
  FROM sa_domain.warehouse_rehearsals WHERE id=%s''',(state['run_id'],)).fetchone()
 assert row and row[:4]==(TENANT,state['customer_id'],state['order_id'],state['email']),'Stored rehearsal identity differs from checkpoint'
 assert row[4]==state['capture'],'Stored source capture differs from checkpoint'
 assert hashlib.sha256(row[5].encode()).hexdigest()==row[6],'Stored manifest checksum differs'
 manifest=json.loads(row[5]);assert manifest['run_id']==state['run_id'] and manifest['project_ref']=='scvojtvgnkmbupvyslmb'
 assert state['sku']==manifest['initial']['saleOrder']['saleOrderItems'][0]['itemSku']==manifest['replacement']['saleOrder']['saleOrderItems'][0]['itemSku'],'Inventory proof SKU differs from manifest'
 if state.get('registration'):assert state['registration']['manifest_sha256']==row[6],'Registration receipt differs from stored manifest'
 state['verified_manifest_sha256']=row[6];save(state)

def inventory_check(c,state):
 secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
 request=urllib.request.Request(URL+'/functions/v1/squad-jobs/warehouse-check',data=json.dumps({'skus':[state['sku']]}).encode(),method='POST',headers={'Content-Type':'application/json','Authorization':'Bearer '+secret})
 try:
  with urllib.request.urlopen(request,timeout=50) as response:
   assert response.status==200;report=json.loads(response.read(8192))
 except Exception:raise RuntimeError('Exact provider SKU read check failed before business mutations') from None
 assert report.get('state')=='verified' and report.get('environment')=='staging' and report.get('provider')=='unicommerce' and report.get('writes')==0
 facility=next((x for x in report['facilities'] if x['facility']=='WH1'),None)
 assert facility and facility['code']=='CONFIRMED' and facility['requested_skus']==facility['known_skus']==1,'Exact selected SKU not confirmed in WH1'
 state['inventory_probe']={'sku_sha256':hashlib.sha256(state['sku'].encode()).hexdigest(),'facility':'WH1','known_skus':1,'requested_skus':1,'writes':0,'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat()};save(state)

def call(c,state,step):
 secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
 body=json.dumps({'run_id':state['run_id'],'step':step}).encode();started=time.monotonic()
 request=urllib.request.Request(URL+'/functions/v1/squad-jobs/warehouse-rehearsal',data=body,method='POST',headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(request,timeout=50) as response:
   assert response.status==200;reply=json.loads(response.read(8192))
 except Exception:
  state['events'].append({'step':step,'result':'HTTP_UNCONFIRMED','duration_ms':round((time.monotonic()-started)*1000)});save(state)
  raise RuntimeError('Provider response unconfirmed; durable checkpoint retained for exact recovery') from None
 assert reply.get('run_id')==state['run_id'] and reply.get('step')==step
 state['events'].append({'step':step,'result':reply,'duration_ms':round((time.monotonic()-started)*1000)});save(state)
 return reply

def advance(c,state,step):
 for _ in range(5):
  current=status(c,state)[step]
  if current['completed']:return
  if current['state']=='blocked':raise RuntimeError('Provider step blocked: '+step+' '+str(current['error_code']))
  reply=call(c,state,step)
  if reply['state']=='done':return
  if reply['state'] in ('blocked','busy'):raise RuntimeError('Provider step needs recovery: '+step+' '+str(reply.get('error_code',reply['state'])))
  wait=c.execute("SELECT greatest(0,extract(epoch FROM available_at-clock_timestamp())) FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step=%s",(state['run_id'],step)).fetchone()[0]
  assert wait<=60,'Provider requested longer retry; retain checkpoint instead of forcing it'
  until=time.monotonic()+float(wait)
  while time.monotonic()<until:time.sleep(min(5,max(0,until-time.monotonic())))
 raise RuntimeError('Bounded provider attempts exhausted; checkpoint retained')

def recover(c,state):
 rows=status(c,state)
 assert rows,'No registered manifest; no provider operation was authorized'
 for create,cancel,cleanup in [('submit','cancel_initial','cleanup_initial'),('replace','cancel_replacement','cleanup_replacement')]:
  if rows[create]['attempted'] and not(rows[cancel]['completed'] or rows[cleanup]['completed']):advance(c,state,cleanup)
 rows=status(c,state)
 if rows['customer']['completed']:advance(c,state,'customer_disable')
 elif rows['customer']['attempted']:raise RuntimeError('Customer creation remains unconfirmed; retain exact manifest for investigation')
 return status(c,state)

def abandon_unregistered(c,state):
 """Exclusive refresh fence settles a previous registration transaction first."""
 assert not state['registered'] and not state['events'] and not status(c,state)
 assert list(preflight(c))==state['environment_state']
 assert public_structure(c)==state['public_structure'] and staff_auth(c)==state['staff_auth'] and cron_state(c)==state['crons']
 state['finished']=True;state['result']='registration_not_committed_no_provider_request';save(state)
 archive=PRIVATE/('warehouse-rehearsal-'+state['run_id']+'.json');assert not archive.exists();CHECKPOINT.replace(archive)
 return {'environment':'staging','run_id':state['run_id'],'result':state['result'],'provider_requests':0,'source_rollback_verified':True}

def finish(c,state,lifecycle):
 rows=status(c,state)
 for create,cancel,cleanup in [('submit','cancel_initial','cleanup_initial'),('replace','cancel_replacement','cleanup_replacement')]:
  assert not rows[create]['attempted'] or rows[cancel]['completed'] or rows[cleanup]['completed'],'Test order cleanup unconfirmed'
 assert not rows['customer']['attempted'] or rows['customer_disable']['completed'],'Customer disable unconfirmed'
 if lifecycle:assert all(rows[x]['completed'] for x in STEPS)
 assert list(preflight(c))==state['environment_state']
 assert public_structure(c)==state['public_structure'] and staff_auth(c)==state['staff_auth'] and cron_state(c)==state['crons']
 evidence={'environment':'staging','run_id':state['run_id'],'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'provider_contract_lifecycle_passed':lifecycle,'committed_outbox_lifecycle_asserted':False,'source_rollback_verified':True,
  'source_capture':state['capture_result'],'rollback_tables':state['rollback_tables'],'rollback_sequences':state['rollback_sequences'],
  'customer_code':f"S-{state['customer_id']}",'order_codes':[f"S-{state['order_id']}",f"S-{state['order_id']}-1"],
  'steps':rows,'events':state['events'],'exact_provider_cleanup_confirmed':True,'source_business_writes':0,'mirror_unchanged':True,
  'manifest_sha256':state['verified_manifest_sha256'],'inventory_probe':state.get('inventory_probe'),
  'public_structure_unchanged':True,'staff_auth_unchanged':True,'cron_unchanged':True,'production_changed':False,'digitalocean_changed':False}
 path=ROOT/'docs/squad-one-audit/implementation-evidence'/('staging-uniware-lifecycle.json' if lifecycle else f"staging-uniware-recovery-{state['run_id']}.json")
 path.write_text(json.dumps(evidence,indent=2)+'\n');state['finished']=True;save(state)
 archive=PRIVATE/('warehouse-rehearsal-'+state['run_id']+'.json');assert not archive.exists();CHECKPOINT.replace(archive)
 return evidence

def run(execute=False,recovery=False):
 if not recovery:assert not CHECKPOINT.exists(),'Recover existing provider rehearsal first'
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release/rehearsal active'
  shared=False
  try:
   c.execute("SET statement_timeout='120s';SET lock_timeout='5s'")
   assert c.execute("SELECT to_regprocedure('sa_domain.warehouse_rehearsal_register(uuid,text,text,jsonb)')").fetchone()[0],'Reviewed capability is not deployed'
   if recovery:
    state=validate(json.loads(CHECKPOINT.read_text()))
    if not status(c,state):print(json.dumps(abandon_unregistered(c,state)));return
    bind_manifest(c,state)
    c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
    recover(c,state);print(json.dumps(finish(c,state,False)));return
   preflight(c)
   if not execute:print(json.dumps({'mode':'read-only preflight','environment':'staging','source_fixture':'rollback only','provider':'original Uniware tenant WH1','maximum_orders':2,'pieces_per_order':1,'maximum_total_per_order':1000,'cleanup':'confirmed cancellation and customer disable'}));return
   state=capture_source(c)
   # Checkpoint precedes registration commit, so a lost SQL reply cannot create
   # an untracked capability. There is no provider request before registration.
   with c.transaction():
    registered=c.execute('SELECT sa_domain.warehouse_rehearsal_register(%s,%s,%s,%s)',(state['run_id'],TENANT,state['email'],Jsonb(state['capture']))).fetchone()[0]
   state['registered']=True;state['registration']=registered;save(state)
   bind_manifest(c,state)
   c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
   inventory_check(c,state)
   for step in STEPS:advance(c,state,step)
   print(json.dumps(finish(c,state,True)))
  finally:
   if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
   else:c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');a=p.parse_args();run(a.execute,a.recover)
