"""Proof collection tests: synthetic local data and fake object transport only."""
import datetime,json,tempfile,unittest,copy
from contextlib import ExitStack
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
from psycopg import sql
from local_db import connect
from test_catalogue import seed_catalogue
from fixtures import uid
import cutover_evidence as ce

class Reports(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'bundle.json';self.now=datetime.datetime.now(ce.UTC)
  self.context={'environment':'staging','source_run_id':'synthetic-final','generation':'7','code_sha256':'a'*64,'acceptance_contract_sha256':'b'*64}
  self.bundle={**self.context,'reports':[]};self.reports={}
  for kind,ids in ce.acceptance_requirements().items():
   report={**self.context,'kind':kind,'status':'passed','passed':len(ids),'failed':0,'runner':'synthetic-local-test-fixture',
    'started_at':(self.now-datetime.timedelta(minutes=5)).isoformat(),'finished_at':(self.now-datetime.timedelta(minutes=1)).isoformat(),
    'cases':[{'id':id,'outcome':'passed','test_ids':['test.fixture.'+id],'assertions':['Synthetic assertion for negative verifier testing']} for id in sorted(ids)]}
   if kind=='mixed_load':report['metrics']={'list_detail_db_p95_ms':80,'ordinary_command_db_p95_ms':200,'concurrency':8,'samples':1000,'invariant_failures':0,'unhandled_errors':0}
   self.reports[kind]=report;self.write(kind)
 def tearDown(self):self.tmp.cleanup()
 def write(self,kind):
  p=self.path.parent/(kind+'.json');p.write_text(json.dumps(self.reports[kind]));ref={'file':p.name,'sha256':ce.file_hash(p)}
  self.bundle['reports']=[r for r in self.bundle['reports'] if r['file']!=p.name]+[ref]
 def validate(self):return ce.validate_reports(self.bundle,self.path,self.context,self.now)
 def test_complete_bound_reports_accepted(self):self.assertEqual(set(self.validate()),set(ce.EXTERNAL))
 def test_report_bytes_cannot_change_behind_digest(self):
  (self.path.parent/'workflow_acceptance.json').write_text('{}')
  with self.assertRaisesRegex(RuntimeError,'checksum'):self.validate()
 def test_wrong_environment_rejected(self):
  self.reports['persona_journeys']['environment']='production';self.write('persona_journeys')
  with self.assertRaisesRegex(RuntimeError,'context'):self.validate()
 def test_wrong_source_generation_rejected(self):
  self.reports['refresh_rehearsal']['generation']='6';self.write('refresh_rehearsal')
  with self.assertRaisesRegex(RuntimeError,'context'):self.validate()
 def test_missing_workflow_is_rejected(self):
  self.reports['workflow_acceptance']['cases'].pop();self.write('workflow_acceptance')
  with self.assertRaisesRegex(RuntimeError,'coverage'):self.validate()
 def test_missing_managed_persona_is_rejected(self):
  r=self.reports['persona_journeys'];r['cases']=[c for c in r['cases'] if c['id']!='Tailor'];self.write('persona_journeys')
  with self.assertRaisesRegex(RuntimeError,'coverage'):self.validate()
 def test_raw_pass_without_executable_test_reference_is_rejected(self):
  self.reports['permission_matrix']['cases'][0]['test_ids']=[];self.write('permission_matrix')
  with self.assertRaisesRegex(RuntimeError,'executable'):self.validate()
 def test_failed_case_is_rejected(self):
  self.reports['permission_matrix']['cases'][0]['outcome']='failed';self.write('permission_matrix')
  with self.assertRaises(RuntimeError):self.validate()
 def test_failed_suite_is_rejected(self):
  self.reports['permission_matrix']['failed']=1;self.write('permission_matrix')
  with self.assertRaisesRegex(RuntimeError,'did not pass'):self.validate()
 def test_stale_report_rejected(self):
  self.reports['permission_matrix']['started_at']=(self.now-datetime.timedelta(days=2)).isoformat();self.write('permission_matrix')
  with self.assertRaisesRegex(RuntimeError,'stale'):self.validate()
 def test_future_report_rejected(self):
  self.reports['permission_matrix']['finished_at']=(self.now+datetime.timedelta(minutes=1)).isoformat();self.write('permission_matrix')
  with self.assertRaisesRegex(RuntimeError,'time order'):self.validate()
 def test_path_traversal_rejected(self):
  self.bundle['reports'][0]['file']='../outside.json'
  with self.assertRaisesRegex(RuntimeError,'escapes'):self.validate()
 def test_duplicate_report_rejected(self):
  self.bundle['reports'][-1]=self.bundle['reports'][0]
  with self.assertRaisesRegex(RuntimeError,'duplicate'):self.validate()
 def test_latency_budget_rejected(self):
  self.reports['mixed_load']['metrics']['list_detail_db_p95_ms']=205;self.write('mixed_load')
  with self.assertRaisesRegex(RuntimeError,'latency'):self.validate()
 def test_serial_samples_do_not_claim_mixed_load(self):
  self.reports['mixed_load']['metrics']['concurrency']=1;self.write('mixed_load')
  with self.assertRaisesRegex(RuntimeError,'concurrent'):self.validate()
 def test_zero_test_count_rejected(self):
  self.reports['mixed_load']['passed']=0;self.write('mixed_load')
  with self.assertRaisesRegex(RuntimeError,'did not pass'):self.validate()
 def test_timestamp_timezone_required(self):
  with self.assertRaisesRegex(RuntimeError,'timezone'):ce.timestamp('2026-11-08T00:00:00')
 def test_all_current_workflows_and_scenarios_are_parsed(self):
  req=ce.acceptance_requirements();self.assertGreater(len(req['workflow_acceptance']),100);self.assertEqual(len(req['permission_matrix']),10);self.assertEqual(len(req['persona_journeys']),14)

class MachineChecks(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute('ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz')
  self.c.execute('CREATE TABLE auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb)')
  self.c.execute("SELECT set_config('squad.source_enrollment','on',true)")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET encrypted_password=%s",('$2b$12$'+'a'*53,))
  self.c.execute("UPDATE auth.users a SET encrypted_password=s.encrypted_password,email_confirmed_at=now(),raw_app_meta_data=jsonb_build_object('application','canto','legacy_user_id',s.id,'legacy_role_id',s.role) FROM sa_identity.sa_auth_identities m JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id WHERE a.id=m.auth_user_id")
  self.c.execute("INSERT INTO auth.identities SELECT a.id,'email',a.id::text,jsonb_build_object('sub',a.id::text,'email',a.email,'email_verified',true) FROM auth.users a WHERE role='sa_app'")
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def test_actual_auth_identity_password_role_parity(self):self.assertEqual(ce.verify_auth(self.c)['eligible_users'],26)
 def test_same_email_is_not_sufficient_if_password_changed(self):
  self.c.execute("UPDATE auth.users SET encrypted_password='different' WHERE id=%s",(uid(103),))
  with self.assertRaisesRegex(RuntimeError,'parity'):ce.verify_auth(self.c)
 def test_source_disable_requires_block_and_ban(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103')
  with self.assertRaisesRegex(RuntimeError,'parity'):ce.verify_auth(self.c)
 def test_disabled_identity_with_actual_ban_is_valid(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.c.execute("UPDATE sa_identity.sa_auth_identities SET enrollment_state='blocked' WHERE legacy_user_id=103");self.c.execute("UPDATE auth.users SET banned_until=now()+interval '10 years' WHERE id=%s",(uid(103),));self.assertEqual(ce.verify_auth(self.c)['eligible_users'],25)
 def test_wrong_legacy_role_is_rejected(self):
  self.c.execute("UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{legacy_role_id}','0') WHERE id=%s",(uid(103),))
  with self.assertRaisesRegex(RuntimeError,'parity'):ce.verify_auth(self.c)
 def test_missing_gotrue_identity_is_rejected(self):
  self.c.execute('DELETE FROM auth.identities WHERE user_id=%s',(uid(103),))
  with self.assertRaisesRegex(RuntimeError,'parity'):ce.verify_auth(self.c)
 def test_unconfirmed_identity_is_rejected(self):
  self.c.execute('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=%s',(uid(103),))
  with self.assertRaisesRegex(RuntimeError,'parity'):ce.verify_auth(self.c)
 def test_forged_email_identity_is_rejected(self):
  self.c.execute("UPDATE auth.identities SET identity_data=jsonb_set(identity_data,'{email}',to_jsonb('other@squad.invalid'::text)) WHERE user_id=%s",(uid(103),))
  with self.assertRaisesRegex(RuntimeError,'parity'):ce.verify_auth(self.c)
 def test_empty_stock_valid(self):self.assertEqual(ce.verify_stock(self.c)['receipts'],0)
 def test_bad_stock_fails_without_mutation(self):
  self.c.execute('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,created_at,updated_at) VALUES(103,1001,1001,1,0,10,0,now(),now())')
  with self.assertRaisesRegex(RuntimeError,'stock issues'):ce.verify_stock(self.c)
  self.assertEqual(self.c.execute('SELECT quantity FROM sa_snapshot_20261019.sa_stocks').fetchone()[0],10)
 def test_sequence_high_water_checks_actual_ids_not_only_copied_state(self):
  names=[r[0] for r in self.c.execute("SELECT sequencename FROM pg_sequences WHERE schemaname='sa_snapshot_20261019'")]
  manifest={'sequences':{n:{'target':n} for n in names}}
  states=ce.sequence_state(self.c,ce.SCHEMA,manifest);manifest={'sequences':states}
  # Fixtures intentionally inserted explicit IDs beyond most sequence values.
  with self.assertRaisesRegex(RuntimeError,'high-water'):ce.verify_high_water(self.c,manifest)
 def test_sequence_high_water_passes_when_all_owned_sequences_are_safe(self):
  seqs=self.c.execute("SELECT seq.relname,t.relname,a.attname FROM pg_class seq JOIN pg_namespace n ON n.oid=seq.relnamespace JOIN pg_depend d ON d.objid=seq.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN('a','i') JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE n.nspname='sa_snapshot_20261019' AND seq.relkind='S'").fetchall()
  for name,table,col in seqs:
   top=self.c.execute(sql.SQL('SELECT coalesce(max({}),0) FROM {}.{}').format(sql.Identifier(col),sql.Identifier(ce.SCHEMA),sql.Identifier(table))).fetchone()[0]
   # ALTER RESTART is transactional, unlike setval; rollback preserves fixture sequences.
   self.c.execute(sql.SQL('ALTER SEQUENCE {}.{} RESTART WITH {}').format(sql.Identifier(ce.SCHEMA),sql.Identifier(name),sql.Literal(top+1000)))
  manifest={'sequences':{n:{'target':n} for n,_,_ in seqs}};manifest['sequences']=ce.sequence_state(self.c,ce.SCHEMA,manifest)
  self.assertEqual(ce.verify_high_water(self.c,manifest)['sequences'],len(seqs))

class MediaChecks(unittest.TestCase):
 def test_readback_verifies_every_unique_object_and_missing_source(self):
  calls=[]
  class Store:
   def verify(self,*args):calls.append(args)
  result=ce.verify_media('staging',[('sha256/aa/'+'a'*64,'a'*64,3)],["https://staging.invalid/missing"],storage=Store(),source_open=lambda _:None)
  self.assertEqual(result,{'verified_objects':1,'verified_bytes':3,'confirmed_missing_source_urls':1});self.assertEqual(len(calls),1)
 def test_corrupt_storage_is_a_hard_failure(self):
  class Store:
   def verify(self,*args):raise RuntimeError('digest mismatch')
  with self.assertRaisesRegex(RuntimeError,'digest mismatch'):ce.verify_media('staging',[('x','a'*64,3)],[],storage=Store())
 def test_reappearing_source_requires_new_refresh(self):
  class Response:
   def close(self):pass
  with self.assertRaisesRegex(RuntimeError,'now exists'):ce.verify_media('staging',[],['https://staging.invalid/missing'],storage=object(),source_open=lambda _:Response())
 def test_source_outage_is_not_misclassified_missing(self):
  def fail(_):raise OSError('unreachable')
  with self.assertRaises(OSError):ce.verify_media('staging',[],['https://staging.invalid/missing'],storage=object(),source_open=fail)
 def test_worker_bound_is_enforced(self):
  with self.assertRaises(RuntimeError):ce.verify_media('staging',[],[],workers=100,storage=object())

class CollectionFlow(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();base=Path(self.tmp.name);self.now=datetime.datetime.now(ce.UTC)
  self.capture={'started_at':(self.now-datetime.timedelta(minutes=20)).isoformat(),'finished_at':(self.now-datetime.timedelta(minutes=15)).isoformat(),'archive_sha256':'a'*64}
  self.facts={'environment':'staging','cutover':False,'test_writes':False,'active_job':None,'edit_revision':'0','synced_revision':'0','generation':'3','unfinished':{'events':0},
   'source':{'run_id':'synthetic-final','capture':self.capture,'archive_sha256':'a'*64,'source_schema_sha256':'b'*64,'committed_at':(self.now-datetime.timedelta(minutes=10)).isoformat()},
   'media':{'report_sha256':'c'*64,'unverified':0,'missing':0,'external':0},'identity':{'report_sha256':'d'*64,'reported_exceptions':0}}
  self.latest={'public_schema_sha256':'public','public_schema_unchanged':True,'staff_auth_unchanged':True,'table_content':{}}
  self.bundle={'freeze':{'at':(self.now-datetime.timedelta(minutes=25)).isoformat(),'watermark':'synthetic frozen dump','attestation':'Synthetic operator statement'},'media_policy':'all_available','media_report_sha256':'c'*64,'identity_policy':'all_eligible','identity_report_sha256':'d'*64}
  self.bundlepath=base/'bundle.json';self.bundlepath.write_text(json.dumps(self.bundle));self.output=base/'proof.json'
  self.args=SimpleNamespace(environment='staging',capture=base,bundle=self.bundlepath,output=self.output,media_workers=1,register=False)
  self.queries=[];outer=self
  class Result:
   def __init__(self,row):self.row=row
   def fetchone(self):return self.row
  class Connection:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def transaction(self):return self
   def execute(self,q,args=()):
    outer.queries.append(str(q))
    if 'pg_try_advisory' in q:return Result((True,))
    if 'SELECT report' in q:return Result((outer.latest,))
    if 'squad_cutover_acceptance_register' in q:return Result(({'id':'synthetic-acceptance','expires_at':'synthetic'},))
    return Result((None,))
  self.stack=ExitStack();self.stack.enter_context(patch.object(ce,'connect',return_value=Connection()))
  replacements={'check_capture':self.capture,'extract':({'archive_sha256':'a'*64,'schema_sha256':'b'*64,'tables':{}},None),'source_fingerprint':'code','contract_fingerprint':'contract','validate_reports':{},'check_catalog':None,'verify_deployed_migrations':{'migrations':1},'public_structure':'public','verify':{},'verify_auth':{'identity_exceptions':0},'verify_high_water':{},'verify_stock':{},'media_inventory':([],[],{}),'verify_media':{}}
  self.mocks={name:self.stack.enter_context(patch.object(ce,name,return_value=value)) for name,value in replacements.items()}
  self.state=self.stack.enter_context(patch.object(ce,'state',side_effect=lambda _:copy.deepcopy(self.facts)))
 def tearDown(self):self.stack.close();self.tmp.cleanup()
 def test_default_is_readonly_and_never_registers_or_activates(self):
  result=ce.collect(self.args);self.assertFalse(result['registered']);self.assertFalse(result['ownership_activated']);self.assertTrue(self.output.exists());self.assertEqual(self.output.stat().st_mode&0o777,0o600)
  self.assertTrue(any('READ ONLY' in q for q in self.queries));self.assertFalse(any('acceptance_register' in q or 'v1_cutover_commit' in q for q in self.queries))
 def test_requested_registration_only_records_evidence_not_ownership(self):
  self.args.register=True;result=ce.collect(self.args);self.assertTrue(result['registered']);self.assertFalse(result['ownership_activated']);self.assertTrue(self.output.with_suffix('.json.registration.json').exists());self.assertEqual(sum('acceptance_register' in q for q in self.queries),1);self.assertFalse(any('v1_cutover_commit' in q for q in self.queries))
 def test_refresh_during_media_reads_aborts_before_artifact_or_registration(self):
  other=copy.deepcopy(self.facts);other['generation']='4';self.state.side_effect=[self.facts,other];self.args.register=True
  with self.assertRaisesRegex(RuntimeError,'state changed'):ce.collect(self.args)
  self.assertFalse(self.output.exists());self.assertFalse(any('acceptance_register' in q for q in self.queries))
 def test_code_change_during_verification_aborts(self):
  self.mocks['source_fingerprint'].side_effect=['code','changed']
  with self.assertRaisesRegex(RuntimeError,'code changed'):ce.collect(self.args)
  self.assertFalse(self.output.exists())
 def test_corrupt_storage_cannot_register(self):
  self.mocks['verify_media'].side_effect=RuntimeError('Corrupt object');self.args.register=True
  with self.assertRaisesRegex(RuntimeError,'Corrupt'):ce.collect(self.args)
  self.assertFalse(self.output.exists());self.assertFalse(any('acceptance_register' in q for q in self.queries))
 def test_production_is_not_a_hidden_cli_override(self):
  self.args.environment='production'
  with self.assertRaisesRegex(RuntimeError,'only permits staging'):ce.collect(self.args)
  self.assertEqual(self.queries,[])
 def test_changed_table_report_cannot_register(self):
  self.latest['table_content']={'unexpected':{}}
  with self.assertRaisesRegex(RuntimeError,'content report'):ce.collect(self.args)
  self.assertFalse(self.output.exists())

if __name__=='__main__':unittest.main(verbosity=2)
