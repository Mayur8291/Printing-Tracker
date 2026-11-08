"""Prepared staging-only business rehearsal; default is read-only preflight.

The release integrator reviews --execute before any committed hosted fixture.
Only the planned Auth UUIDs may write; source content must return to its exact
baseline before acknowledging the fixture's own monotonic revision delta.
"""
import argparse
import datetime
import hashlib
import json
import os
import secrets
import subprocess
import uuid
from pathlib import Path

from psycopg import sql
from psycopg.types.json import Jsonb
import test_hosted_personas as identities
from business_fixture_commercial import plan_fixture,prepare_fixture
from business_cleanup_documents import cleanup_documents

ROOT=identities.ROOT
PRIVATE=ROOT/'tools/squad/private'
CHECKPOINT=PRIVATE/'business-checkpoint.json'
SCHEMA='sa_snapshot_20261019'
UUID_FIELDS=('test_actor_ids','test_write_expires_at','allow_test_writes')
KIND_TABLE={'person':'sa_users','factory':'sa_factories','preset':'sa_products','product':'sa_products','order':'sa_orders','item':'sa_items','quantity':'sa_quantities','rating':'sa_ratings','task':'sa_tasks','responsibility':'sa_responsibilities','milestone':'sa_milestones'}


def serial(value):
 if isinstance(value,(datetime.datetime,datetime.date,uuid.UUID)):return str(value)
 raise TypeError(type(value).__name__)


def save(state):
 PRIVATE.mkdir(exist_ok=True,mode=0o700)
 temporary=CHECKPOINT.with_suffix('.tmp')
 with open(temporary,'w') as file:
  os.chmod(temporary,0o600);json.dump(state,file,indent=2,default=serial);file.flush();os.fsync(file.fileno())
 temporary.replace(CHECKPOINT)


def validate(state):
 assert state['format']=='squad-business-fixture/v1' and state['environment']=='staging'
 identity=identities.validate(state['identity']);run=uuid.UUID(state['run_id'])
 if 'weekly_mail_inbox' in identity:assert state.get('weekly_mail_rehearsal') is True
 assert state['run_id']==identity['run_id'] and state['base']==identity['base']
 assert state['label']=='SQB '+run.hex[:12]
 assert type(state['data_base']) is int and 1901000000<=state['data_base']<1902000000 and state['data_base']%10000==0
 assert state['journal']==str(PRIVATE/f'business-{run}.jsonl')
 assert len(state['source_before'])<=300 and all(k.startswith('sa_') and k.replace('_','').isalnum() for k in state['source_before'])
 expected=plan_fixture(state)
 assert state['fixture']['ids']==expected['ids'] and state['fixture']['customConfig']==expected['customConfig']
 assert state['fixture']['commercialExtras']==expected['commercialExtras'],'Extra journey fixture changed'
 # Only deterministic planned rows may become cleanup roots. Optional criteria
 # are owned only at their reserved IDs; borrowed criteria are never roots.
 allowed={entry['table']:set(entry['ids']) for entry in expected['fixture_tables']}
 allowed[SCHEMA+'.sa_criteria'].update(row['id'] for row in expected['optional_shared_criteria'])
 for entry in state['fixture']['fixture_tables']:
  assert entry['table'] in allowed and set(entry['ids'])<=allowed[entry['table']]
 assert state['flags_before']=={'allow_test_writes':False,'test_actor_ids':[],'test_write_expires_at':None}
 return state


def source_state(c):
 """Bounded digest per source table; no source contents or PII persisted."""
 tables=c.execute("SELECT t.tablename,EXISTS(SELECT 1 FROM information_schema.columns a WHERE a.table_schema=%s AND a.table_name=t.tablename AND a.column_name='id' AND a.data_type IN('bigint','integer','smallint')) FROM pg_tables t WHERE t.schemaname=%s ORDER BY 1",(SCHEMA,SCHEMA)).fetchall()
 assert 0<len(tables)<=300
 queries=[]
 for table,has_id in tables:
  maxid=sql.SQL('max(id)') if has_id else sql.SQL('NULL::bigint')
  sums=[sql.SQL("coalesce(sum(('x'||substr(h,{},16))::bit(64)::bigint::numeric),0)::text").format(sql.Literal(n)) for n in (1,17,33,49)]
  # Explicit materialization prevents PostgreSQL from inlining the expensive
  # row serialization/SHA256 expression into each of the four digest sums.
  queries.append(sql.SQL("(WITH row_hashes AS MATERIALIZED (SELECT {},encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM {}.{} t) SELECT {},count(*),{},{} FROM row_hashes)").format(sql.SQL('id') if has_id else sql.SQL('NULL::bigint id'),sql.Identifier(SCHEMA),sql.Identifier(table),sql.Literal(table),maxid,sql.SQL(',').join(sums)))
 return {row[0]:{'count':row[1],'max_id':row[2],'digest':list(row[3:])} for row in c.execute(sql.SQL(' UNION ALL ').join(queries)).fetchall()}


def cron_state(c):
 if not c.execute("SELECT to_regclass('cron.job')").fetchone()[0]:return []
 return [{'jobid':row[0],'jobname':row[1],'active':row[2],'definition_sha256':row[3]} for row in c.execute("SELECT jobid,jobname,active,encode(sha256(convert_to((to_jsonb(j)-'active')::text,'UTF8')),'hex') FROM cron.job j WHERE jobname LIKE 'squad-%' ORDER BY jobid")]


def set_crons(c,state,paused):
 # Pause/restore is one transaction: an interrupted second update cannot leave
 # an ambiguous mix of old and new active states in a durable checkpoint.
 with c.transaction():
  current=cron_state(c)
  assert [(x['jobid'],x['jobname'],x['definition_sha256']) for x in current]==[(x['jobid'],x['jobname'],x['definition_sha256']) for x in state['crons']], 'Cron definitions changed'
  if paused:assert current==state['crons'],'Cron state changed before setup'
  else:assert all(not x['active'] for x in current) or current==state['crons'],'Cron state changed during rehearsal'
  for row in state['crons']:c.execute('SELECT cron.alter_job(%s,active:=%s)',(row['jobid'],False if paused else row['active']))


def plan(c):
 identity=identities.plan(c)
 flags=c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()
 assert flags==(False,[],None),'A rehearsal is already configured'
 source=source_state(c);run=identity['run_id'];data_base=1901000000+secrets.randbelow(100)*10000
 state={'format':'squad-business-fixture/v1','environment':'staging','run_id':run,'identity':identity,'base':identity['base'],'data_base':data_base,'label':'SQB '+uuid.UUID(run).hex[:12],
  'created_at':c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat(),'stage':'planned','journal':str(PRIVATE/f'business-{run}.jsonl'),
  'source_before':source,'flags_before':{'allow_test_writes':False,'test_actor_ids':[],'test_write_expires_at':None},'crons':cron_state(c),
  'audit_start':c.execute('SELECT coalesce(max(id),0) FROM sa_domain.audit').fetchone()[0],
  'public_structure':identities.public_structure(c),'staff_auth':identities.staff_auth(c)}
 state['fixture']=plan_fixture(state)
 for entry in state['fixture']['fixture_tables']:
  table=entry['table'].split('.')[1]
  assert not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE id=ANY(%s::bigint[]) LIMIT 1').format(sql.Identifier(SCHEMA),sql.Identifier(table)),(entry['ids'],)).fetchone(),'Planned source IDs collide'
 validate(state);return state


def prepare(c,state):
 """Caller owns a transaction and journals updated state before its commit."""
 validate(state);assert c.info.transaction_status.name=='INTRANS'
 credentials=identities.create(c,state['identity']);base=state['base'];objects=state['identity']['objects']
 # Remove the earlier read-only harness's placeholder order graph. This run
 # creates all business orders through the same authenticated SDK as the apps.
 for table,ids in [('quantities',objects['quantities']),('items',objects['items']),('orders',objects['orders']),('addresses',objects['addresses']),('user_dealers',[objects['dealer_link']]),('sizes',[objects['size']])]:
  c.execute(sql.SQL('DELETE FROM {}.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier('sa_'+table)),(ids,))
 for offset in range(15):c.execute('UPDATE sa_snapshot_20261019.sa_users SET name=%s WHERE id=%s',(state['label']+f' role{offset}',base+offset))
 c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=%s',(base+3,))
 state['fixture']=prepare_fixture(c,state)
 now=datetime.datetime.now(datetime.timezone.utc)
 state['fixture'].update(actors={str(n):str(base+n) for n in range(13)},dueAt=(now+datetime.timedelta(days=14)).isoformat(),completionBy=(now+datetime.timedelta(days=13)).isoformat())
 roots={'sa_users':list(range(base,base+15)),'sa_factories':objects['factories']}
 for entry in state['fixture']['fixture_tables']:roots.setdefault(entry['table'].split('.')[1],[]).extend(entry['ids'])
 state['setup_xids']=sorted({int(row[0]) for table,ids in roots.items() for row in c.execute(sql.SQL('SELECT DISTINCT xmin::text FROM {}.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier(table)),(ids,))})
 auths=[uuid.UUID(actor['auth_id']) for actor in state['identity']['actors']]
 c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s::uuid[],test_write_expires_at=clock_timestamp()+interval '15 minutes'",(auths,))
 state['stage']='prepared';return credentials


def journal(state):
 path=Path(state['journal']);assert path.parent==PRIVATE
 if not path.exists():return []
 assert path.stat().st_size<=2_000_000,'Unbounded rehearsal journal'
 return [json.loads(line) for line in path.read_text().splitlines() if line]


def foreign_keys(c):
 return c.execute("""SELECT child.relname,ca.attname,parent.relname,pa.attname FROM pg_constraint fk
 JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_class parent ON parent.oid=fk.confrelid
 JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
 JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
 WHERE fk.contype='f' AND child.relnamespace=%s::regnamespace AND parent.relnamespace=%s::regnamespace
 AND cardinality(fk.conkey)=1 AND cardinality(fk.confkey)=1 ORDER BY 1,2""",(SCHEMA,SCHEMA)).fetchall()


def source_graph(c,state,entries,owned_xids):
 roots={'sa_users':set(range(state['base'],state['base']+15)),'sa_factories':set(state['identity']['objects']['factories'])}
 for entry in state['fixture']['fixture_tables']:roots.setdefault(entry['table'].split('.')[1],set()).update(entry['ids'])
 graph={table:set(ids) for table,ids in roots.items()};created_at=state['created_at']
 def add(table,ids):
  if not ids:return False
  assert table in state['source_before'] and state['source_before'][table]['max_id'] is not None or table in state['source_before'] and state['source_before'][table]['count']==0
  current=graph.setdefault(table,set());new=set(map(int,ids))-current
  if not new:return False
  maximum=state['source_before'][table]['max_id'] or 0
  rows=c.execute(sql.SQL('SELECT id,created_at,xmin::text FROM {}.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier(table)),(list(new),)).fetchall()
  assert all(rid>maximum and at is not None and at.replace(tzinfo=datetime.timezone.utc)>=datetime.datetime.fromisoformat(created_at) and int(xid) in owned_xids for rid,at,xid in rows),'Preexisting or foreign row references fixture'
  current.update(rid for rid,_,_ in rows);assert sum(map(len,graph.values()))<=5000,'Fixture graph exceeds reviewed bound';return bool(rows)
 # Rooted FK traversal cannot find polymorphic references on its own. Every
 # additional root comes from a validated immutable command audit, not the
 # client result inventory. All discovered rows must have owned transaction IDs.
 for entry in entries:
  if entry.get('kind')=='entity' and entry['value']['kind'] in KIND_TABLE:
   add(KIND_TABLE[entry['value']['kind']],[entry['value']['id']])
 keys=foreign_keys(c)
 for _ in range(40):
  changed=False
  for child,column,parent,parent_column in keys:
   assert parent_column=='id','Unexpected composite/source key contract'
   if not graph.get(parent):continue
   ids=[r[0] for r in c.execute(sql.SQL('SELECT id FROM {}.{} WHERE {}=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier(child),sql.Identifier(column)),(list(graph[parent]),))]
   changed=add(child,ids) or changed
  if not changed:break
 else:raise AssertionError('Unbounded source dependency closure')
 for table,ids in graph.items():
  actual=c.execute(sql.SQL('SELECT DISTINCT xmin::text FROM {}.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier(table)),(list(ids),)).fetchall()
  assert all(int(row[0]) in owned_xids for row in actual),'Fixture row was modified by an unowned transaction'
 return graph,keys


def delete_graph(c,graph,keys):
 pending={table for table,ids in graph.items() if ids}
 while pending:
  ready=[table for table in pending if not any(parent==table and child!=table and child in pending for child,_,parent,_ in keys)]
  assert ready,'Unsupported source dependency cycle; preserve checkpoint'
  for table in sorted(ready):
   c.execute(sql.SQL('DELETE FROM {}.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier(table)),(list(graph[table]),));pending.remove(table)


def cleanup(c,state,journal_entries=None,document_cleanup=None,weekly_mail_cleanup=None):
 """Exact-owned cleanup, or atomic refusal. Never discards foreign writes."""
 validate(state);entries=journal(state) if journal_entries is None else journal_entries;identity=state['identity']
 auths=[uuid.UUID(a['auth_id']) for a in identity['actors']]
 # Expiry blocks new writes, but explicitly clear the allowlist even when a
 # later ownership check fails. Keep Cron paused until cleanup is reviewed.
 with c.transaction():
  current=c.execute('SELECT test_actor_ids FROM sa_domain.runtime_state').fetchone()[0]
  assert set(current) in [set(),set(auths)],'Another rehearsal owns the write scope'
  c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=%s::uuid[],test_write_expires_at=NULL',([],))
 with c.transaction():
  c.execute("SET LOCAL statement_timeout='120s'")
  environment=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
  assert environment[:3]==('staging',False,None),'Environment changed'
  assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==identity['generation'],'Source generation changed'
  old_cleanup=c.execute("SELECT changes FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(uuid.UUID(state['run_id']),)).fetchone()
  if old_cleanup:
   assert environment[3:]==(old_cleanup[0]['edit_revision_after'],old_cleanup[0]['synced_revision_after']),'Environment changed after prior cleanup'
   assert source_state(c)==state['source_before'],'Content changed after prior cleanup'
   assert not c.execute('SELECT 1 FROM auth.users WHERE id=ANY(%s::uuid[])',(auths,)).fetchone(),'Fixture Auth identity reappeared'
   assert not c.execute('SELECT 1 FROM auth.sessions WHERE user_id=ANY(%s::uuid[])',(auths,)).fetchone(),'Fixture Auth session reappeared'
   assert not c.execute('SELECT 1 FROM auth.refresh_tokens WHERE user_id=ANY(%s::text[])',([str(a) for a in auths],)).fetchone(),'Fixture refresh token reappeared'
   assert not c.execute("SELECT 1 FROM sa_identity.sa_auth_identities WHERE auth_user_id=ANY(%s::uuid[]) AND enrollment_state<>'blocked'",(auths,)).fetchone(),'Fixture identity reservation reactivated'
   assert not c.execute("SELECT 1 FROM sa_domain.outbox WHERE actor_id=ANY(%s::uuid[]) AND status IN('pending','leased')",(auths,)).fetchone(),'Fixture job reactivated'
   assert not c.execute('SELECT 1 FROM sa_domain.documents WHERE actor_id=ANY(%s::uuid[])',(auths,)).fetchone(),'Fixture document reappeared'
   assert identities.public_structure(c)==state['public_structure'] and identities.staff_auth(c)==state['staff_auth'],'Unrelated public/staff data changed'
   return old_cleanup[0]
  assert environment[4]==identity['synced_revision'],'Source watermark changed'
  raw_rows=c.execute('SELECT actor_id,command_key,operation,kind,entity_id,changes,xmin::text FROM sa_domain.audit WHERE id>%s ORDER BY id',(state['audit_start'],)).fetchall()
  rows=[row[:-1] for row in raw_rows]
  keys={uuid.UUID(entry['value']['key']) for entry in entries if entry.get('kind')=='command'}
  # Backorder acceptance internally places its purchase with a generated key;
  # its exact key is retained by the journaled parent command's immutable audit.
  nested={uuid.UUID(changes['placement_command_key']):actor for actor,key,operation,_,_,changes in rows if actor in auths and key in keys and operation=='backorder.placed' and changes.get('placement_command_key')}
  assert all(actor in auths and (key in keys or operation=='orders.placed' and nested.get(key)==actor) for actor,key,operation,_,_,_ in rows),'Foreign or unjournaled business edits detected'
  delta=environment[3]-identity['edit_revision'];assert delta==len(rows),'Business revision differs from owned audited commands'
  for entry in entries:
   if entry.get('kind')=='command':assert uuid.UUID(entry['value']['key'])==uuid.uuid5(uuid.UUID(state['run_id']),entry['value']['label']),'Journal command key changed'
  # The default rehearsal executes no workers. A separate, reviewed document
  # output harness can clean exact audit-bound document jobs and return only
  # those IDs. No journal entry alone is authority to exempt a job.
  executed=[];removed_documents=None;processed_documents=0
  if weekly_mail_cleanup is not None:
   assert document_cleanup is None and state.get('weekly_mail_rehearsal') is True
   proof=weekly_mail_cleanup(c,state,rows,auths,{int(row[-1]) for row in raw_rows})
   expected_cap=uuid.uuid5(uuid.UUID(state['run_id']),'weekly-mail.capability')
   assert proof['capability_id']==str(expected_cap)
   executed=list(map(uuid.UUID,map(str,proof['executed_job_ids'])))
   server=c.execute('''SELECT p.job_id,j.actor_id,j.status,j.lease_until,p.job_xmin=j.xmin::text,
     p.job_sha256=encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex')
     FROM sa_domain.weekly_mail_job_receipts p JOIN sa_domain.outbox j ON j.id=p.job_id
     WHERE p.capability_id=%s''',(expected_cap,)).fetchall()
   assert len(executed)<=11 and len(set(executed))==len(executed) and set(executed)=={r[0] for r in server},'Unbound mail worker exception'
   assert all(r[1] in auths and r[2] in('pending','done','dead') and r[3] is None and r[4] and r[5] for r in server),'Unsettled or changed mail worker receipt'
   assert not c.execute("SELECT 1 FROM sa_domain.job_attempts WHERE job_id=ANY(%s::uuid[]) AND(state='leased' OR finished_at IS NULL)",(executed,)).fetchone()
   removed_documents=proof['removed_documents'];processed_documents=proof['processed_documents']
   assert type(removed_documents) is int and type(processed_documents) is int and 0<=processed_documents<=3 and processed_documents<=removed_documents<=40
  if document_cleanup is not None:
   proof=document_cleanup(c,state,rows,auths,{int(row[-1]) for row in raw_rows})
   executed=list(map(uuid.UUID,map(str,proof['executed_job_ids'])))
   assert len(executed)<=2 and len(set(executed))==len(executed),'Unbounded document worker exception'
   for job_id in executed:
    job=c.execute('SELECT actor_id,command_key,event_type,aggregate_kind,aggregate_id,payload,status,lease_until FROM sa_domain.outbox WHERE id=%s',(job_id,)).fetchone()
    assert job and job[2:4]==('document.requested','document') and job[6] in ('done','dead','pending') and job[7] is None,'Document worker is not settled'
    assert any(a==job[0] and k==job[1] and op=='document.requested' and kind=='document' and entity==job[4] and changes.get('document_id')==job[5].get('document_id') for a,k,op,kind,entity,changes in rows),'Document worker is not audit-bound'
    assert not c.execute("SELECT 1 FROM sa_domain.job_attempts WHERE job_id=%s AND (state NOT IN('done','failed','expired') OR finished_at IS NULL)",(job_id,)).fetchone(),'Document attempt is not settled'
   removed_documents=proof['removed_documents'];processed_documents=proof.get('processed_documents',0)
   assert type(removed_documents) is int and type(processed_documents) is int and 0<=processed_documents<=2 and processed_documents<=removed_documents<=32,'Invalid document cleanup counts'
  assert not c.execute('SELECT 1 FROM sa_domain.outbox WHERE actor_id=ANY(%s::uuid[]) AND NOT(id=ANY(%s::uuid[])) AND (attempts<>0 OR status<>\'pending\') LIMIT 1',(auths,executed)).fetchone(),'Fixture background work unexpectedly executed'
  entity_entries=[{'kind':'entity','value':{'kind':kind,'id':str(entity_id)}} for _,_,_,kind,entity_id,_ in rows if kind in KIND_TABLE]
  graph,fks=source_graph(c,state,entity_entries,set(state.get('setup_xids',[]))|{int(row[-1]) for row in raw_rows})
  if removed_documents is None:removed_documents=cleanup_documents(c,state,rows,auths,{int(row[-1]) for row in raw_rows})
  c.execute("UPDATE sa_domain.outbox SET status='dead',last_error_code='REHEARSAL_CLEANUP',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE actor_id=ANY(%s::uuid[]) AND status='pending'",(auths,))
  c.execute("UPDATE sa_domain.account_requests SET state='failed',error_code='REHEARSAL_CLEANUP',updated_at=now() WHERE actor_id=ANY(%s::uuid[])",(auths,))
  delete_graph(c,graph,fks)
  assert source_state(c)==state['source_before'],'Source contents differ from prefixture baseline; refusing cleanup commit'
  # Acknowledge only net-zero synthetic writes. The edit revision is never
  # rewound, and existing dirtiness (preflight forbids it) is never discarded.
  c.execute('UPDATE sa_sync.environment_state SET synced_revision=synced_revision+%s WHERE singleton',(delta,))
  cleanup_identity=dict(identity,edit_revision=environment[3],synced_revision=environment[4]+delta)
  identities.cleanup(c,cleanup_identity)
  result={'run_id':state['run_id'],'owned_commands':delta,'removed_source_rows':sum(map(len,graph.values())),'removed_documents':removed_documents,'removed_queued_documents':removed_documents-processed_documents,'removed_processed_documents':processed_documents,'tables':{k:len(v) for k,v in graph.items()},'edit_revision_before':identity['edit_revision'],'edit_revision_after':environment[3],'synced_revision_after':environment[4]+delta,'audit_and_commands_retained':True,'jobs_terminalized':True,'source_content_restored':True}
  c.execute("INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes) VALUES(%s,%s,'rehearsal.cleanup','rehearsal',%s,%s,%s)",(auths[0],identity['base'],state['data_base'],uuid.UUID(state['run_id']),Jsonb(result)))
  assert identities.public_structure(c)==state['public_structure'] and identities.staff_auth(c)==state['staff_auth'],'Unrelated public/staff data changed'
  return result


def run(execute=False,recover=False):
 if not recover:assert not CHECKPOINT.exists(),'Recover existing exact-owned checkpoint first'
 with identities.connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
  shared=False
  try:
   if recover:
    state=validate(json.loads(CHECKPOINT.read_text()));result=cleanup(c,state);set_crons(c,state,False);CHECKPOINT.unlink();print(json.dumps(result));return
   state=plan(c)
   if not execute:
    print(json.dumps({'mode':'read-only preflight','environment':'staging','personas':11,'cutover':False,'scoped_rehearsal':True,'source_tables':len(state['source_before']),'cron_jobs':state['crons'],'provider_messages':0}));return
   save(state)
   try:
    set_crons(c,state,True)
    with c.transaction():credentials=prepare(c,state);save(state)
    Path(state['journal']).touch(mode=0o600,exist_ok=False)
    # Acquire shared protection while still holding exclusive setup protection,
    # then release exclusive. Authenticated commands acquire the same shared
    # lock; refresh/deployment remains excluded for the entire HTTP sequence.
    c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
    payload={'url':identities.URL,'anon':identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture']}
    process=subprocess.run(['node','tools/squad/test_business_journeys_hosted_sdk.mjs'],input=json.dumps(payload),text=True,capture_output=True,cwd=ROOT,timeout=600)
    for actor in credentials:actor['password']=''
    if process.returncode:raise RuntimeError('Business SDK rehearsal failed: '+process.stderr[-2200:])
    report=json.loads(process.stdout)
   finally:
    if shared:
     # Upgrade without dropping the shared refresh fence. No SDK request is
     # running now; a bounded lock timeout keeps unexpected clients visible.
     c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
    result=cleanup(c,state);set_crons(c,state,False);CHECKPOINT.unlink()
   report.update(cleanup=result,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),cutover_unchanged=True,cron_restored=True,provider_requests=0,emails_sent=0,migration_prefix=c.execute("SELECT max(version) FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%'").fetchone()[0])
   (ROOT/'docs/squad-one-audit/implementation-evidence/staging-business-journeys.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  finally:
   if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
   c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__=='__main__':
 parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true');group.add_argument('--recover',action='store_true');args=parser.parse_args();run(args.execute,args.recover)
