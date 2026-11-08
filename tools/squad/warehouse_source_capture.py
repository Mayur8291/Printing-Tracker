"""Capture actual customer/order/amendment builders in a caller-owned rollback.

Uses two synthetic SQL Auth/session identities and read-only existing catalogue
data. This is shared-SDK/SQL contract evidence, not a GoTrue/provider lifecycle.
The caller fences sequences and verifies rollback before registering a manifest.
"""
import datetime,json,selectors,subprocess,time,uuid
from psycopg import sql
from test_business_journey_composition import ROOT,dispatch

BUILDERS=('sa_domain.warehouse_customer_payload(bigint)',
 'sa_domain.warehouse_order_payload(bigint,text,text)',
 'sa_domain.warehouse_amendment_payload(uuid,text,text,text)')

def capture(c,run_id,customer_id,order_id,sku_id,email):
 assert c.info.transaction_status.name=='INTRANS'
 assert 1950000000<=customer_id<1960000000 and 1960000000<=order_id<1970000000
 run=uuid.UUID(str(run_id));assert email==f'squad-warehouse-{run.hex[:16]}@mailinator.com'
 assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
 assert c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()==(False,[],None)
 assert c.execute("SELECT to_regclass('pg_temp.squad_profile_sequences')").fetchone()[0], 'Fence sequences before capture'
 sc_id=customer_id+1;address_id=customer_id+2;actors={};label='Squad controlled acceptance '+run.hex[:12]
 for table,ids in [('users',[customer_id,sc_id]),('addresses',[address_id]),('orders',[order_id])]:
  assert not c.execute(sql.SQL('SELECT 1 FROM sa_snapshot_20261019.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier('sa_'+table)),(ids,)).fetchone(),'Synthetic ID collision'
 for role,n in [(1,sc_id),(3,customer_id)]:
  auth=uuid.uuid5(run,f'auth-{role}');session=uuid.uuid5(run,f'session-{role}')
  address=email if role==3 else f'squad-warehouse-{run.hex[:16]}-sc@mailinator.com'
  c.execute('''INSERT INTO sa_snapshot_20261019.sa_users(id,name,email,phone,role,approved,onboarded,disabled,created_by_id,is_direct_deal,confirmed_at,created_at,updated_at)
   VALUES(%s,%s,%s,'0000000000',%s,true,true,false,%s,%s,now(),now(),now())''',(n,label+f' role{role}',address,role,sc_id if role==3 else None,role==3))
  c.execute('INSERT INTO sa_sync.legacy_identity_keys(legacy_user_id) VALUES(%s)',(n,))
  c.execute("INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) VALUES(%s,%s,%s,'candidate','ready',true,'source_confirmed')",(auth,n,address))
  c.execute("INSERT INTO auth.users(id,role,email) VALUES(%s,'sa_app',%s)",(auth,address))
  c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,auth))
  actors[role]={'auth_id':str(auth),'session_id':str(session)}
 c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,address,city,state,zip_code,is_primary,created_at,updated_at) VALUES(%s,%s,'DO NOT FULFIL - controlled backend acceptance','Bengaluru','Karnataka','560001',true,now(),now())",(address_id,customer_id))
 c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s::uuid[],test_write_expires_at=clock_timestamp()+interval '5 minutes'",([a['auth_id'] for a in actors.values()],))
 c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actors[3]['auth_id'],'session_id':actors[3]['session_id'],'role':'sa_app'}),))
 customer=c.execute('SELECT sa_domain.warehouse_customer_payload(%s)',(customer_id,)).fetchone()[0]
 assert customer['action']=='create'
 # Fictional provider mappings exist only inside this rollback transaction. They
 # exercise native builders; they never assert a provider response occurred.
 c.execute('UPDATE sa_snapshot_20261019.sa_users SET uc_customer_id=%s WHERE id=%s',(f'S-{customer_id}',customer_id))
 c.execute(sql.SQL('ALTER SEQUENCE sa_snapshot_20261019.sa_orders_id_seq RESTART WITH {}').format(sql.Literal(order_id)))
 now=datetime.datetime.now(datetime.timezone.utc);config={'customer_id':customer_id,'address_id':address_id,'order_id':order_id,'sku_id':sku_id,'due_at':(now+datetime.timedelta(days=14)).isoformat(),'replacement_due_at':(now+datetime.timedelta(days=15)).isoformat()}
 process=subprocess.Popen(['node','tools/squad/warehouse_capture_sdk.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 selector=selectors.DefaultSelector();initial=None;result=None;calls=0;deadline=time.monotonic()+60
 try:
  process.stdin.write(json.dumps(config)+'\n');process.stdin.flush();selector.register(process.stdout,selectors.EVENT_READ)
  while result is None:
   assert time.monotonic()<deadline and selector.select(timeout=10),'Capture bridge timeout'
   line=process.stdout.readline();assert line,'Capture bridge stopped';message=json.loads(line)
   if message['kind']=='rpc':
    calls+=1;assert calls<=12
    response=dispatch(c,message,actors,privileged_role='postgres')
   elif message['kind']=='capture_initial':
    assert int(message['order_id'])==order_id and initial is None
    initial=c.execute("SELECT sa_domain.warehouse_order_payload(%s,'unicommerce','WH1')",(order_id,)).fetchone()[0]
    c.execute("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id=%s,uc_status='CREATED',order_source='unicommerce' WHERE id=%s",(f'S-{order_id}',order_id))
    response={'captured':True}
   elif message['kind']=='result':result=message;break
   else:raise AssertionError('Capture bridge failed: '+str(message))
   process.stdin.write(json.dumps(response)+'\n');process.stdin.flush()
  process.stdin.close();assert process.wait(timeout=5)==0,'Capture SDK failed'
 finally:
  selector.close()
  if process.poll() is None:process.kill();process.wait(timeout=5)
  for stream in [process.stdin,process.stdout,process.stderr]:
   if not stream.closed:stream.close()
 assert initial and int(result['order_id'])==order_id
 request=uuid.UUID(result['request_id'])
 replacement=c.execute("SELECT sa_domain.warehouse_amendment_payload(%s,'unicommerce','WH1',%s)",(request,f'S-{order_id}-1')).fetchone()[0]
 source={'customer_id':customer_id,'order_id':order_id,'request_id':str(request),'actor_id':actors[1]['auth_id'],'generation':c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0],'captured_at':c.execute('SELECT clock_timestamp()').fetchone()[0].isoformat()}
 for table,key,id_ in [('users','customer_sha256',customer_id),('orders','order_sha256',order_id)]:
  source[key]=c.execute(sql.SQL("SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') FROM sa_snapshot_20261019.{} t WHERE id=%s").format(sql.Identifier('sa_'+table)),(id_,)).fetchone()[0]
 source['request_sha256']=c.execute("SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM sa_domain.order_requests r WHERE id=%s",(request,)).fetchone()[0]
 source['builders_sha256']=c.execute("SELECT encode(sha256(convert_to(string_agg(pg_get_functiondef(x::regprocedure),'' ORDER BY n),'UTF8')),'hex') FROM unnest(%s::text[]) WITH ORDINALITY AS t(x,n)",(list(BUILDERS),)).fetchone()[0]
 return {'customer':customer,'initial':initial,'replacement':replacement,'source':source},{'shared_sdk_rpc_calls':calls,'quoted_total':result['quoted_total'],'replacement_total':result['replacement_total'],'fixture_identity_scope':'two synthetic SQL Auth/session principals; no GoTrue claims','synthetic_provider_mapping':'rollback only; no provider confirmation fabricated'}
