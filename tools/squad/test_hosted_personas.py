"""Prepared, staging-only real GoTrue / shared-SDK persona harness.

Default is a read-only preflight. --execute creates only explicitly planned
synthetic rows, keeps mirror mode, and removes them in finally. Immutable Auth
reservation tombstones remain blocked, following the existing identity guard.
Do not run --execute before the release integrator reviews this exact artifact.
"""
import argparse
import datetime
import hashlib
import json
import os
import secrets
import subprocess
import sys
import uuid
from pathlib import Path

from psycopg import sql
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure,staff_auth
from auth_test import keys

CHECKPOINT=ROOT/'tools/squad/private/personas-checkpoint.json'
URL='https://scvojtvgnkmbupvyslmb.supabase.co'
ROLES=[0,1,2,3,4,7,8,9,10,11,12]
MIN_ID=1900000000
MAX_ID=1900010000
FEATURES=[{'key':'1','checked':True},{'key':'2','checked':True},{'key':'3','checked':True,'children':[{'key':f'3.{n}','checked':True} for n in range(1,5)]}]


def save_checkpoint(state):
 CHECKPOINT.parent.mkdir(exist_ok=True,mode=0o700)
 temporary=CHECKPOINT.with_suffix('.tmp');temporary.write_text(json.dumps(state,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(CHECKPOINT)


def validate(state):
 assert state['format']=='squad-persona-fixture/v1' and state['environment']=='staging' and state['url']==URL
 run=uuid.UUID(state['run_id']);assert state['label']=='SQP '+run.hex[:12]
 base=state['base'];assert type(base) is int and MIN_ID<=base and base+120<MAX_ID
 assert [a['role'] for a in state['actors']]==ROLES
 for actor in state['actors']:
  assert actor['id']==str(base+actor['role']);assert actor['email']==f'squad-persona-{run.hex[:12]}-{actor["role"]}@mailinator.com';uuid.UUID(actor['auth_id'])
 assert len({a['auth_id'] for a in state['actors']})==11
 assert state['objects']=={'factories':[base+100,base+101],'addresses':[base+102,base+103],'orders':[base+104,base+105],'items':[base+106,base+107],'quantities':[base+108,base+109],'dealer_link':base+110,'size':base+111}
 assert not any(k in state for k in ['password','passwords','service_role','access_token','refresh_token'])
 return state


def plan(c):
 environment=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert environment[:3]==('staging',False,None) and environment[3]==environment[4],'Requires idle, clean staging mirror'
 assert c.execute('SELECT allow_test_writes FROM sa_domain.runtime_state').fetchone()[0] is False
 assert not c.execute("SELECT FROM sa_domain.outbox WHERE status IN('pending','leased') LIMIT 1").fetchone(),'Existing worker work must finish first'
 assert not c.execute("SELECT FROM sa_domain.account_flows WHERE state IN('pending','processing') LIMIT 1").fetchone(),'Existing account flows must finish first'
 assert c.execute("SELECT to_regprocedure('extensions.crypt(text,text)'),to_regprocedure('extensions.gen_salt(text,integer)')").fetchone()==('extensions.crypt(text,text)','extensions.gen_salt(text,integer)'), 'Server bcrypt fixture capability unavailable'
 top=c.execute('SELECT greatest(coalesce((SELECT max(legacy_user_id) FROM sa_sync.legacy_identity_keys WHERE legacy_user_id>=%s AND legacy_user_id<%s),%s),coalesce((SELECT max(id) FROM sa_snapshot_20261019.sa_users WHERE id>=%s AND id<%s),%s))',(MIN_ID,MAX_ID,MIN_ID-200,MIN_ID,MAX_ID,MIN_ID-200)).fetchone()[0]
 base=max(MIN_ID,((top-MIN_ID)//200+1)*200+MIN_ID);assert base+120<MAX_ID,'Review accumulated test reservations before further fixture creation'
 run=uuid.uuid4();state={'format':'squad-persona-fixture/v1','environment':'staging','url':URL,'run_id':str(run),'label':'SQP '+run.hex[:12],'base':base,'stage':'planned','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'edit_revision':environment[3],'synced_revision':environment[4],'generation':c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0],'actors':[{'role':role,'id':str(base+role),'auth_id':str(uuid.uuid4()),'email':f'squad-persona-{run.hex[:12]}-{role}@mailinator.com'} for role in ROLES],'objects':{'factories':[base+100,base+101],'addresses':[base+102,base+103],'orders':[base+104,base+105],'items':[base+106,base+107],'quantities':[base+108,base+109],'dealer_link':base+110,'size':base+111}}
 validate(state)
 for table,ids in [('users',list(range(base,base+15))),('factories',state['objects']['factories']),('addresses',state['objects']['addresses']),('orders',state['objects']['orders']),('items',state['objects']['items']),('quantities',state['objects']['quantities']),('sizes',[state['objects']['size']]),('user_dealers',[state['objects']['dealer_link']])]:
  assert not c.execute(sql.SQL('SELECT FROM sa_snapshot_20261019.{} WHERE id=ANY(%s::bigint[]) LIMIT 1').format(sql.Identifier('sa_'+table)),(ids,)).fetchone(),'Planned fixture IDs collide'
 for actor in state['actors']:
  assert not c.execute('SELECT FROM auth.users WHERE id=%s OR lower(email)=%s',(uuid.UUID(actor['auth_id']),actor['email'])).fetchone(),'Auth fixture identity collides'
 return state


def create(c,state):
 validate(state);base=state['base'];objects=state['objects'];credentials=[]
 with c.transaction():
  c.execute("SET LOCAL statement_timeout='10s'")
  c.execute('INSERT INTO sa_snapshot_20261019.sa_factories(id,name,created_at,updated_at) VALUES(%s,%s,now(),now()),(%s,%s,now(),now())',(objects['factories'][0],state['label']+' factory',objects['factories'][1],state['label']+' foreign factory'))
  for role in range(15):
   stored_role=role if role<13 else (3 if role==13 else 4);actor=next((a for a in state['actors'] if a['role']==role),None)
   password=secrets.token_urlsafe(30) if actor else None
   email=actor['email'] if actor else (f'subject+{uuid.uuid5(uuid.UUID(state["run_id"]),str(role))}@managed.invalid' if role in [5,6] else f'squad-persona-{uuid.UUID(state["run_id"]).hex[:12]}-{role}@mailinator.com')
   hashed=c.execute("SELECT extensions.crypt(%s,extensions.gen_salt('bf',10))",(password,)).fetchone()[0] if password else ''
   factory=objects['factories'][0] if role==4 else objects['factories'][1] if role==14 else None
   manager=base+4 if role in [5,7,8,9] else None;parent=base+5 if role==6 else None
   c.execute("""INSERT INTO sa_snapshot_20261019.sa_users(id,email,encrypted_password,name,role,approved,onboarded,disabled,confirmed_at,factory_id,factory_manager_id,parent_tailor_id,created_by_id,features,created_at,updated_at)
    VALUES(%s,%s,%s,%s,%s,true,true,false,now(),%s,%s,%s,%s,%s,now(),now())""",(base+role,email,hashed,state['label']+f' role{role}',stored_role,factory,manager,parent,base+1 if role in [3,10] else None,Jsonb(FEATURES if role in [11,12] else [])))
   if actor:
    auth=uuid.UUID(actor['auth_id']);c.execute('INSERT INTO sa_sync.legacy_identity_keys(legacy_user_id) VALUES(%s)',(base+role,))
    c.execute("""INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) VALUES(%s,%s,%s,'candidate','ready',true,'source_confirmed')""",(auth,base+role,email))
    # Exact-owned form of the already-reviewed auth_sync enrollment shape. It
    # copies the source bcrypt bytes and cannot update another source identity.
    c.execute("""INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at)
     SELECT '00000000-0000-0000-0000-000000000000'::uuid,%s,'authenticated','sa_app',email,encrypted_password,confirmed_at,'','','','',jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'application','canto','legacy_user_id',id,'legacy_role_id',role),'{}',false,now(),now() FROM sa_snapshot_20261019.sa_users WHERE id=%s""",(auth,base+role))
    c.execute("""INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) VALUES(%s,%s,jsonb_build_object('sub',%s::text,'email',%s::text,'email_verified',true,'phone_verified',false),'email',now(),now())""",(str(auth),auth,str(auth),email))
    credentials.append({**actor,'password':password})
  c.execute('INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(%s,%s,now(),now())',(objects['size'],state['label']+' M'))
  c.execute('INSERT INTO sa_snapshot_20261019.sa_user_dealers(id,user_id,dealer_id,created_at,updated_at) VALUES(%s,%s,%s,now(),now())',(objects['dealer_link'],base+3,base+10))
  for i in range(2):
   customer=base+3 if i==0 else base+13;manager=base+4 if i==0 else base+14
   c.execute('INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,address,created_at,updated_at) VALUES(%s,%s,%s,now(),now())',(objects['addresses'][i],customer,state['label']+' synthetic address'))
   c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,assigned_to_id,assigned_worker_id,customer_sc_id,customer_dealer_id,order_item_type,status,created_at,updated_at,created_on,due_on,total_quantity,total_amount) VALUES(%s,%s,%s,%s,%s,%s,%s,1,0,now(),now(),now(),now()+interval '10 days',10,1000)""",(objects['orders'][i],customer,objects['addresses'][i],manager,base+11 if i==0 else None,base+1 if i==0 else None,base+10 if i==0 else None))
   c.execute('INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,cutting_master_id,total_quantity,per_piece_amount,total_amount,worker_per_piece_amount,worker_total_amount,created_at,updated_at) VALUES(%s,%s,%s,10,100,1000,40,400,now(),now())',(objects['items'][i],objects['orders'][i],base+9 if i==0 else None))
   c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(id,item_id,size_id,quantity,created_at,updated_at) VALUES(%s,%s,%s,10,now(),now())',(objects['quantities'][i],objects['items'][i],objects['size']))
  c.execute('SET CONSTRAINTS ALL IMMEDIATE')
  assert c.execute("SELECT count(*) FROM sa_identity.sa_auth_identities m JOIN auth.users a ON a.id=m.auth_user_id JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id WHERE m.legacy_user_id=ANY(%s::bigint[]) AND a.encrypted_password=u.encrypted_password AND a.role='sa_app'",([int(a['id']) for a in state['actors']],)).fetchone()[0]==11
  assert not c.execute('SELECT FROM public.profiles WHERE id=ANY(%s::uuid[])',([uuid.UUID(a['auth_id']) for a in state['actors']],)).fetchone()
  assert not c.execute('SELECT FROM sa_identity.sa_auth_identities WHERE legacy_user_id=ANY(%s::bigint[])',([base+5,base+6],)).fetchone(),'Managed subjects must not receive Auth identities'
 return credentials


def cleanup(c,state):
 validate(state);base=state['base'];objects=state['objects'];ids=list(range(base,base+15));auths=[uuid.UUID(a['auth_id']) for a in state['actors']]
 with c.transaction():
  c.execute("SET LOCAL statement_timeout='10s'")
  current=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert current==('staging',False,None,state['edit_revision'],state['synced_revision']),'Environment changed; retain checkpoint for review'
  assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['generation'],'Source generation changed; retain checkpoint'
  for actor in state['actors']:
   rows=c.execute('SELECT auth_user_id,canonical_email FROM sa_identity.sa_auth_identities WHERE legacy_user_id=%s',(int(actor['id']),)).fetchall();assert rows in [[],[(uuid.UUID(actor['auth_id']),actor['email'])]],'Identity ownership mismatch'
   rows=c.execute('SELECT email FROM auth.users WHERE id=%s',(uuid.UUID(actor['auth_id']),)).fetchall();assert rows in [[],[(actor['email'],)]],'Auth ownership mismatch'
  rows=c.execute('SELECT id,name FROM sa_snapshot_20261019.sa_users WHERE id=ANY(%s::bigint[])',(ids,)).fetchall();assert all(name==state['label']+f' role{rid-base}' for rid,name in rows),'Source fixture ownership mismatch'
  for table,values,column in [('factories',objects['factories'],'name'),('addresses',objects['addresses'],'address'),('sizes',[objects['size']],'name')]:
   rows=c.execute(sql.SQL('SELECT {} FROM sa_snapshot_20261019.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(column),sql.Identifier('sa_'+table)),(values,)).fetchall();assert all(row[0].startswith(state['label']+' ') for row in rows),'Fixture relation ownership mismatch'
  for i in range(2):
   expected_customer=base+3 if i==0 else base+13
   rows=c.execute('SELECT customer_id,address_id,assigned_to_id FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(objects['orders'][i],)).fetchall();assert rows in [[],[(expected_customer,objects['addresses'][i],base+4 if i==0 else base+14)]],'Order fixture ownership mismatch'
   rows=c.execute('SELECT order_id FROM sa_snapshot_20261019.sa_items WHERE id=%s',(objects['items'][i],)).fetchall();assert rows in [[],[(objects['orders'][i],)]],'Item fixture ownership mismatch'
   rows=c.execute('SELECT item_id,size_id FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(objects['quantities'][i],)).fetchall();assert rows in [[],[(objects['items'][i],objects['size'])]],'Quantity fixture ownership mismatch'
   rows=c.execute('SELECT user_id FROM sa_snapshot_20261019.sa_addresses WHERE id=%s',(objects['addresses'][i],)).fetchall();assert rows in [[],[(expected_customer,)]],'Address fixture ownership mismatch'
  rows=c.execute('SELECT user_id,dealer_id FROM sa_snapshot_20261019.sa_user_dealers WHERE id=%s',(objects['dealer_link'],)).fetchall();assert rows in [[],[(base+3,base+10)]],'Dealer-link fixture ownership mismatch'
  # Revoke sessions before removal. Existing access tokens then fail the live
  # Auth/session bridge even if their JWT expiry has not yet elapsed.
  c.execute('DELETE FROM auth.refresh_tokens WHERE user_id=ANY(%s::text[])',([str(x) for x in auths],));c.execute('DELETE FROM auth.sessions WHERE user_id=ANY(%s::uuid[])',(auths,))
  c.execute("UPDATE sa_identity.sa_auth_identities SET enrollment_state='blocked' WHERE auth_user_id=ANY(%s::uuid[])",(auths,))
  c.execute('DELETE FROM auth.identities WHERE user_id=ANY(%s::uuid[])',(auths,));c.execute('DELETE FROM auth.users WHERE id=ANY(%s::uuid[])',(auths,))
  for table,values in [('quantities',objects['quantities']),('items',objects['items']),('orders',objects['orders']),('addresses',objects['addresses']),('user_dealers',[objects['dealer_link']]),('users',ids),('factories',objects['factories']),('sizes',[objects['size']])]:
   c.execute(sql.SQL('DELETE FROM sa_snapshot_20261019.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier('sa_'+table)),(values,))
  c.execute('SET CONSTRAINTS ALL IMMEDIATE')
  assert not c.execute('SELECT FROM auth.users WHERE id=ANY(%s::uuid[])',(auths,)).fetchone()
  assert not c.execute('SELECT FROM sa_snapshot_20261019.sa_users WHERE id=ANY(%s::bigint[])',(ids,)).fetchone()
  assert not c.execute("SELECT FROM sa_identity.sa_auth_identities WHERE auth_user_id=ANY(%s::uuid[]) AND enrollment_state<>'blocked'",(auths,)).fetchone()


def run(execute=False,recover=False):
 if not recover:assert not CHECKPOINT.exists(),'Recover the existing exact-owned persona checkpoint first'
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
  try:
   if recover:
    state=validate(json.loads(CHECKPOINT.read_text()));cleanup(c,state);CHECKPOINT.unlink();print(json.dumps({'cleanup':'complete','retained_blocked_reservations':len(state['actors'])}));return
   state=plan(c)
   if not execute:
    print(json.dumps({'mode':'read-only preflight','environment':'staging','roles':ROLES,'managed_subjects':[5,6],'planned_new_auth_accounts':11,'source_rows':15,'cutover_required':False,'provider_messages':0,'cleanup':'exact-owned graph/Auth deleted;11 immutable blocked reservations retained','scope':'identity, scope, real Auth refresh/logout and read contracts; not full business mutation journeys'},indent=2));return
   structure=public_structure(c);staff=staff_auth(c);save_checkpoint(state);report=None;credentials=None
   try:
    credentials=create(c,state);state['stage']='created';save_checkpoint(state)
    payload={'url':URL,'anon':keys('staging'),'actors':credentials,'label':state['label'],'own_order':str(state['objects']['orders'][0]),'foreign_order':str(state['objects']['orders'][1]),'tailor_id':str(state['base']+5),'subtailor_id':str(state['base']+6),'foreign_customer_id':str(state['base']+13)}
    process=subprocess.run(['node','tools/squad/test_personas_hosted_sdk.mjs'],input=json.dumps(payload),capture_output=True,text=True,cwd=ROOT,timeout=300)
    if process.returncode:raise RuntimeError('Persona SDK acceptance failed; sanitized runner status '+str(process.returncode)+'; '+process.stderr[-1800:])
    report=json.loads(process.stdout);assert len(report['actors'])==11
   finally:
    if credentials:
     for actor in credentials:actor['password']=''
    cleanup(c,state);assert public_structure(c)==structure and staff_auth(c)==staff;CHECKPOINT.unlink()
   if report:
    report.update(measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),cleanup='Exact-owned Auth/session/source graph removed;11 blocked immutable reservations retained; Auth sequence gaps and normal Auth audit records retained.',cutover_unchanged=True,public_structure_unchanged=True,staff_auth_unchanged=True,fixture_run_id=state['run_id'],migration_prefix=c.execute("SELECT max(version) FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%'").fetchone()[0])
    (ROOT/'docs/squad-one-audit/implementation-evidence/staging-personas-sdk.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  finally:c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__=='__main__':
 parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true',help='Create committed exact-owned staging fixtures, only after integrator review');group.add_argument('--recover',action='store_true',help='Clean an interrupted owned checkpoint');args=parser.parse_args();run(execute=args.execute,recover=args.recover)
