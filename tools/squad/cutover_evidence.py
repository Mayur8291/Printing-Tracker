"""Trusted release verifier. Default: read-only staging collection; never activates ownership.

Final source capture must already have been published after an operator-attested
write freeze. The tool verifies actual bytes/rows and accepts separately generated,
hash-bound test reports, not browser-provided pass flags. Production is deliberately
not a CLI option. Reports are local private artifacts and contain no credentials.
"""
from __future__ import annotations
import argparse,concurrent.futures,csv,datetime,hashlib,json,os,re,sys
from pathlib import Path
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,verify,verify_sequences,sequence_state,public_structure,SCHEMA
from snapshot import extract,file_hash,require
from sync import check_capture
from delta_sync import check_catalog
from media_sync import Storage,inventory,open_source

UTC=datetime.timezone.utc
MACHINE=('auth_password_identity_parity','table_content_parity','sequence_high_water','media_storage_integrity','stock_source_integrity')
EXTERNAL=('persona_journeys','workflow_acceptance','permission_matrix','refresh_rehearsal','mixed_load','provider_configuration','rollback_rehearsal')
CONTEXT=('environment','source_run_id','generation','code_sha256','acceptance_contract_sha256')
PERSONAS=('Admin','Sales Coordinator','Production Coordinator','Customer','Factory Manager','Tailor','SubTailor','Dispatch Incharge','Inspector','Cutting Master','Dealer','Job Worker','Team','Printing Tracker admin (separate)')

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()
def timestamp(value):
 require(isinstance(value,str) and re.search(r'(Z|[+-][0-9]{2}:[0-9]{2})$',value),'Timestamp needs explicit timezone')
 try:return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(UTC)
 except ValueError:raise RuntimeError('Invalid timestamp') from None

def source_fingerprint():
 paths=[]
 for pattern in ('supabase/migrations/*.sql','supabase/functions/**/*.ts','packages/shared/*','tools/canto-sync/*.py','tools/squad/cutover_evidence.py'):
  paths.extend(p for p in ROOT.glob(pattern) if p.is_file())
 return digest([(str(p.relative_to(ROOT)),file_hash(p)) for p in sorted(set(paths))])

def contract_fingerprint():
 return digest([(name,file_hash(ROOT/'docs/squad-one-audit'/name)) for name in ('ACCEPTANCE.md','functionality-matrix.csv')])

def verify_deployed_migrations(c):
 files=sorted((ROOT/'supabase/migrations').glob('*_squad_*.sql'))
 for path in files:
  version=path.name.split('_',1)[0]
  row=c.execute('SELECT statements FROM supabase_migrations.schema_migrations WHERE version=%s',(version,)).fetchone()
  require(row is not None and row[0]==[path.read_text()],'Release migration differs from deployed artifact: '+path.name)
 return {'migrations':len(files),'last_version':files[-1].name.split('_',1)[0]}

def acceptance_requirements():
 text=(ROOT/'docs/squad-one-audit/ACCEPTANCE.md').read_text()
 ids=set(re.findall(r'^\| ([A-Z]+-[0-9]+) \|',text,re.M))
 with (ROOT/'docs/squad-one-audit/functionality-matrix.csv').open() as f:workflows={r['id'] for r in csv.DictReader(f)}
 return {'persona_journeys':set(PERSONAS),'workflow_acceptance':workflows,
  'permission_matrix':{x for x in ids if x.startswith('SEC-')},
  'refresh_rehearsal':{x for x in ids if x.startswith('REF-')},
  'mixed_load':{x for x in ids if x.startswith('PERF-')},
  'provider_configuration':{x for x in ids if x.startswith('INT-')},
  'rollback_rehearsal':{'REF-05:new_owned_writes_preserved','REF-05:replay_reconciliation'}}

def validate_reports(bundle,path,context,now=None):
 """Validate trusted runner results and exact coverage; do not execute report commands."""
 now=now or datetime.datetime.now(UTC);base=Path(path).resolve().parent
 require(all(bundle.get(k)==context[k] for k in CONTEXT),'Acceptance bundle context differs from this source/code')
 require(isinstance(bundle.get('reports'),list) and len(bundle['reports'])==len(EXTERNAL),'Every acceptance report is required')
 required=acceptance_requirements();result={}
 for ref in bundle['reports']:
  require(isinstance(ref,dict) and set(ref)=={'file','sha256'},'Malformed report reference')
  name=ref['file'];require(isinstance(name,str) and not Path(name).is_absolute(),'Report must be a relative local artifact')
  target=(base/name).resolve();require(target.is_relative_to(base) and target.is_file(),'Report escapes bundle directory or is missing')
  require(target.stat().st_size<=10*1024*1024,'Acceptance report exceeds 10 MiB')
  require(file_hash(target)==ref['sha256'],'Acceptance report checksum mismatch')
  report=json.loads(target.read_text());kind=report.get('kind')
  require(kind in EXTERNAL and kind not in result,'Unknown/duplicate acceptance report')
  require(all(report.get(k)==context[k] for k in CONTEXT),'Test report context mismatch')
  finished=timestamp(report.get('finished_at'));started=timestamp(report.get('started_at'))
  require(now-datetime.timedelta(hours=24)<=started<=finished<=now,'Acceptance test report is stale or time order invalid')
  require(report.get('status')=='passed' and type(report.get('failed')) is int and report['failed']==0 and type(report.get('passed')) is int and report['passed']>0,'Acceptance tests did not pass')
  require(isinstance(report.get('runner'),str) and report['runner'].strip(),'Test runner provenance required')
  cases=report.get('cases');require(isinstance(cases,list) and len(cases)>0,'Actual test cases required')
  seen=set()
  for case in cases:
   require(isinstance(case,dict) and isinstance(case.get('id'),str) and case['id'] not in seen,'Duplicate/malformed test case')
   require(case.get('outcome')=='passed' and isinstance(case.get('test_ids'),list) and len(case['test_ids'])>0 and all(isinstance(x,str) and x.strip() for x in case['test_ids']),'Test case requires passing executable-test references')
   require(isinstance(case.get('assertions'),list) and len(case['assertions'])>0 and all(isinstance(x,str) and x.strip() for x in case['assertions']),'Test case assertions required')
   seen.add(case['id'])
  require(required[kind]<=seen,'Acceptance report is missing required coverage: '+kind)
  if kind=='mixed_load':
   metrics=report.get('metrics',{})
   for key,limit in [('list_detail_db_p95_ms',200),('ordinary_command_db_p95_ms',500)]:
    value=metrics.get(key);require(type(value) in (float,int) and 0<value<limit,'Mixed-load latency budget not met: '+key)
   require(type(metrics.get('concurrency')) is int and metrics['concurrency']>=2 and type(metrics.get('samples')) is int and metrics['samples']>=100,'Representative concurrent samples required')
   require(metrics.get('invariant_failures')==0 and metrics.get('unhandled_errors')==0,'Mixed-load invariants/errors failed')
  result[kind]={'sha256':ref['sha256'],'passed':report['passed'],'case_count':len(cases),'finished_at':report['finished_at']}
 require(set(result)==set(EXTERNAL),'Acceptance report coverage is incomplete')
 return result

def verify_auth(c):
 """Read-only equivalent of enrollment eligibility; never imports or changes Auth."""
 result=c.execute('''WITH source AS (
  SELECT s.*,lower(btrim(email)) ce,count(*) OVER(PARTITION BY lower(btrim(email))) email_count
  FROM sa_snapshot_20261019.sa_users s
 ),desired AS(SELECT s.*,
  (s.deleted_at IS NULL AND s.disabled IS NOT TRUE AND NOT(coalesce(s.role=3,false) AND s.approved IS FALSE)) allowed,
  (s.deleted_at IS NULL AND s.disabled IS NOT TRUE AND NOT(coalesce(s.role=3,false) AND s.approved IS FALSE)
   AND s.ce~'^[^[:space:]@]+@[^[:space:]@]+$' AND length(s.ce)<=254 AND s.email_count=1
   AND s.encrypted_password~'^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$' AND s.role BETWEEN 0 AND 12
   AND NOT EXISTS(SELECT FROM auth.users a WHERE lower(btrim(a.email))=s.ce AND NOT EXISTS(SELECT FROM sa_identity.sa_auth_identities m WHERE m.auth_user_id=a.id AND m.legacy_user_id=s.id))
   AND NOT EXISTS(SELECT FROM sa_identity.sa_auth_identities m WHERE m.canonical_email=s.ce AND m.legacy_user_id<>s.id)) IS TRUE eligible
  FROM source s
 ),checks AS(SELECT d.id,d.allowed,d.eligible,m.auth_user_id,
  CASE WHEN d.eligible THEN m.enrollment_state='ready' AND a.role='sa_app' AND a.email=d.ce
    AND a.encrypted_password=d.encrypted_password AND a.banned_until IS NULL
    AND to_jsonb(a)->>'email_confirmed_at' IS NOT NULL
    AND a.raw_app_meta_data->>'application'='canto' AND a.raw_app_meta_data->>'legacy_user_id'=d.id::text
    AND a.raw_app_meta_data->>'legacy_role_id'=d.role::text
    AND EXISTS(SELECT FROM auth.identities i WHERE i.user_id=a.id AND i.provider='email' AND i.provider_id=a.id::text
      AND i.identity_data->>'sub'=a.id::text AND i.identity_data->>'email'=a.email AND i.identity_data->'email_verified'='true'::jsonb)
   ELSE m.enrollment_state='blocked' AND(a.id IS NULL OR a.banned_until>now()) END valid
  FROM desired d LEFT JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=d.id LEFT JOIN auth.users a ON a.id=m.auth_user_id
 )SELECT count(*),count(*) FILTER(WHERE eligible),count(*) FILTER(WHERE allowed AND NOT eligible),count(*) FILTER(WHERE valid IS NOT TRUE) FROM checks''').fetchone()
 retired=c.execute('''SELECT count(*) FROM sa_identity.sa_auth_identities m LEFT JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id
 LEFT JOIN auth.users a ON a.id=m.auth_user_id WHERE s.id IS NULL AND(m.enrollment_state IS DISTINCT FROM 'blocked' OR a.id IS NOT NULL AND(a.banned_until IS NULL OR a.banned_until<=now()))''').fetchone()[0]
 require(result[3]==0 and retired==0,'Live Auth/password/identity eligibility parity failed')
 return {'source_users':result[0],'eligible_users':result[1],'identity_exceptions':result[2],'mismatches':result[3],'retired_identity_mismatches':retired}

def verify_high_water(c,manifest):
 verify_sequences(c,SCHEMA,manifest);states=sequence_state(c,SCHEMA,manifest)
 seqs=c.execute('''SELECT seq.relname,t.relname,a.attname,s.seqincrement,s.seqmax,s.seqcycle
 FROM pg_class seq JOIN pg_namespace n ON n.oid=seq.relnamespace JOIN pg_sequence s ON s.seqrelid=seq.oid
 JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=seq.oid AND d.refclassid='pg_class'::regclass AND d.deptype IN('a','i')
 JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
 WHERE n.nspname=%s ORDER BY seq.relname''',(SCHEMA,)).fetchall()
 require({x[0] for x in seqs}==set(states),'Sequence ownership coverage is incomplete')
 for name,table,column,inc,maximum,cycle in seqs:
  require(inc>0 and not cycle,'Unexpected sequence increment/cycle')
  top=c.execute(sql.SQL('SELECT max({}) FROM {}.{}').format(sql.Identifier(column),sql.Identifier(SCHEMA),sql.Identifier(table))).fetchone()[0]
  state=states[name];next_=state['value']+(inc if state['called'] else 0)
  require((top is None or next_>top) and next_<=maximum,'Sequence collision or exhausted high-water mark: '+name)
 return {'sequences':len(seqs),'next_values_above_existing_ids':True}

def verify_stock(c):
 counts={};receipts=0
 owners=c.execute('SELECT DISTINCT user_id FROM sa_snapshot_20261019.sa_stocks ORDER BY user_id').fetchall()
 for (dealer,) in owners:
  require(dealer is not None,'Stock receipt has no owner');after=0
  while True:
   ids=[r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_stocks WHERE user_id=%s AND id>%s ORDER BY id LIMIT 100',(dealer,after))]
   if not ids:break
   rows=c.execute('SELECT id,data FROM sa_domain.stock_reconciliation_rows(%s,%s)',(dealer,ids)).fetchall()
   require(len(rows)==len(ids),'Stock review omitted receipts')
   for _,data in rows:
    for issue in data['issues']:counts[issue]=counts.get(issue,0)+1
    if data.get('group_needs_reconciliation') is not False:counts['group_needs_reconciliation']=counts.get('group_needs_reconciliation',0)+1
   receipts+=len(ids);after=ids[-1]
 require(not counts,'Source stock issues block cutover: '+json.dumps(counts,sort_keys=True))
 return {'dealers':len(owners),'receipts':receipts,'issues':counts}

def media_inventory(c,directory,manifest):
 expected=inventory(directory,manifest)
 fields=('resource','record_id','field','pointer','source_value','source_url')
 actual=[dict(zip((*fields,'status','sha256'),r)) for r in c.execute('SELECT resource,record_id,field,pointer,source_value,source_url,status,sha256 FROM sa_media.references')]
 normalize=lambda rows:sorted(json.dumps([r.get(k) for k in fields],sort_keys=True) for r in rows)
 require(normalize(expected)==normalize(actual),'Source media inventory differs from published references')
 objects=c.execute("SELECT DISTINCT o.object_path,o.sha256,o.bytes FROM sa_media.references r JOIN sa_media.objects o USING(sha256) WHERE r.status='ready' ORDER BY o.object_path").fetchall()
 for path,sha,size in objects:require(path=='sha256/'+sha[:2]+'/'+sha and re.fullmatch('[a-f0-9]{64}',sha) and size>0,'Invalid immutable media object identity')
 missing=sorted({r['source_url'] for r in actual if r['status']=='missing'})
 require(all(isinstance(u,str) and u for u in missing),'Missing file lacks a same-environment source URL')
 require(all(r['status'] in ('ready','missing','external') for r in actual),'Unverified media reference')
 return objects,missing,{'references':len(actual),'objects':len(objects),'missing_urls':len(missing),'external':sum(r['status']=='external' for r in actual)}

def verify_media(environment,objects,missing,workers=4,storage=None,source_open=open_source):
 require(1<=workers<=8,'Media verifier concurrency must be 1–8')
 storage=storage or Storage(environment)
 def check_object(row):storage.verify(*row);return row[2]
 def check_missing(url):
  response=source_open(url)
  if response is not None:
   response.close();raise RuntimeError('A previously missing source file now exists; refresh again')
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
  sizes=list(pool.map(check_object,objects));list(pool.map(check_missing,missing))
 return {'verified_objects':len(objects),'verified_bytes':sum(sizes),'confirmed_missing_source_urls':len(missing)}

def state(c):return c.execute('SELECT sa_domain.cutover_facts()').fetchone()[0]
def acquire(c):require(c.execute('SELECT pg_try_advisory_xact_lock_shared(20261107,1)').fetchone()[0],'Refresh/cutover in progress')

def collect(args):
 require(args.environment=='staging','This release verifier only permits staging')
 directory=Path(args.capture).resolve();bundle_path=Path(args.bundle).resolve();bundle=json.loads(bundle_path.read_text())
 capture=check_capture(args.environment,directory)
 # Re-extract from checksummed pg_dump; do not trust an old editable manifest.
 manifest,_=extract(directory,args.environment)
 with connect(args.environment) as c,c.transaction():
  c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');acquire(c);facts=state(c)
  require(facts['environment']==args.environment and not facts['cutover'] and not facts['test_writes'] and facts['active_job'] is None and facts['edit_revision']==facts['synced_revision'],'Environment is not a clean mirror')
  require(all(v==0 for v in facts['unfinished'].values()),'Pending work must settle before acceptance')
  require(facts['source']['capture']==capture and facts['source']['archive_sha256']==manifest['archive_sha256'] and facts['source']['source_schema_sha256']==manifest['schema_sha256'],'Capture is not the current published source')
  context={'environment':args.environment,'source_run_id':facts['source']['run_id'],'generation':facts['generation'],'code_sha256':source_fingerprint(),'acceptance_contract_sha256':contract_fingerprint()}
  reports=validate_reports(bundle,bundle_path,context)
  freeze=bundle.get('freeze',{});frozen=timestamp(freeze.get('at'))
  require(frozen<=timestamp(capture['started_at'])<=timestamp(capture['finished_at'])<=timestamp(facts['source']['committed_at']),'Source freeze/capture/publication order is invalid')
  require(datetime.datetime.now(UTC)-datetime.timedelta(hours=24)<=frozen,'Freeze evidence is stale')
  for key in ('watermark','attestation'):require(isinstance(freeze.get(key),str) and 0<len(freeze[key].strip())<=500,'Operator freeze attestation/watermark required')
  for prefix,choices in [('media',('all_available','reviewed_source_missing')),('identity',('all_eligible','reviewed_identity_exceptions'))]:
   require(bundle.get(prefix+'_policy') in choices and bundle.get(prefix+'_report_sha256')==facts[prefix]['report_sha256'],'Exception review policy/digest does not match')
  require(facts['media']['unverified']==0,'Unverified media cannot be waived')
  require(bundle['media_policy']=='reviewed_source_missing' or facts['media']['missing']==facts['media']['external']==0,'Missing/external media requires exact report review')
  require(bundle['identity_policy']=='reviewed_identity_exceptions' or facts['identity']['reported_exceptions']==0,'Identity exceptions require exact report review')
  check_catalog(c,args.environment);deployment=verify_deployed_migrations(c)
  latest=c.execute('SELECT report FROM sa_sync.refresh_runs WHERE run_id=%s',(facts['source']['run_id'],)).fetchone()[0]
  require(latest.get('public_schema_sha256')==public_structure(c) and latest.get('public_schema_unchanged') is True and latest.get('staff_auth_unchanged') is True,'Public/staff publication guard evidence is missing or differs')
  tables=verify(c,SCHEMA,manifest);require(latest.get('table_content')==manifest['tables'],'Published content report differs from actual source archive');auth=verify_auth(c);sequences=verify_high_water(c,manifest);stock=verify_stock(c)
  require(auth['identity_exceptions']==facts['identity']['reported_exceptions'],'Reported identity exception count differs from current eligibility')
  objects,missing,media=media_inventory(c,directory,manifest)
 # Provider reads never hold a DB transaction open. Final fingerprint check closes
 # the race with refresh, credential changes and any newly queued work.
 media.update(verify_media(args.environment,objects,missing,args.media_workers))
 now=datetime.datetime.now(UTC)
 output={**context,'verified_at':now.isoformat(),'freeze':freeze,'facts':facts,'verification':{k:True for k in (*MACHINE,*EXTERNAL)},
  'machine':{'deployment':deployment,'tables':len(tables),'rows':sum(t['rows'] for t in tables.values()),'table_report_sha256':digest(tables),'auth':auth,'sequences':sequences,'stock':stock,'media':media},'acceptance_reports':reports,
  'media_policy':bundle['media_policy'],'identity_policy':bundle['identity_policy'],'bundle_sha256':file_hash(bundle_path),'registered':False,'ownership_activated':False}
 output_path=Path(args.output).resolve();output_path.parent.mkdir(parents=True,exist_ok=True)
 artifact=json.dumps(output,sort_keys=True,indent=2)+'\n'
 with connect(args.environment) as c,c.transaction():
  if not args.register:c.execute('SET TRANSACTION READ ONLY')
  acquire(c);require(state(c)==facts,'Acceptance state changed during verification; rerun collection')
  require(source_fingerprint()==context['code_sha256'],'Release code changed during verification')
  # Confirm database eligibility again after potentially lengthy Storage reads.
  verify_auth(c);verify_high_water(c,manifest)
  require(datetime.datetime.now(UTC)-now<datetime.timedelta(minutes=30),'Verification exceeded acceptance window')
  # Durable local artifact first: a registered proof always names exact saved bytes.
  with output_path.open('x') as out:os.chmod(output_path,0o600);out.write(artifact)
  registration=None
  if args.register:
   evidence={'source_run_id':context['source_run_id'],'source_watermark':freeze['watermark'],'source_frozen_at':freeze['at'],'freeze_attestation':freeze['attestation'],
    'artifact_sha256':hashlib.sha256(artifact.encode()).hexdigest(),'verification':output['verification'],'media_policy':bundle['media_policy'],'media_report_sha256':facts['media']['report_sha256'],
    'identity_policy':bundle['identity_policy'],'identity_report_sha256':facts['identity']['report_sha256'],'verified_at':now.isoformat()}
   c.execute('SET LOCAL ROLE service_role');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
   registration=c.execute('SELECT canto_api.squad_cutover_acceptance_register(%s)',(Jsonb(evidence),)).fetchone()[0]
 # Save receipt separately; never mutate the registered artifact's digest.
 if registration:
  receipt=output_path.with_suffix(output_path.suffix+'.registration.json')
  with receipt.open('x') as out:os.chmod(receipt,0o600);out.write(json.dumps(registration,indent=2,default=str)+'\n')
 return {'environment':args.environment,'artifact':str(output_path),'registered':bool(registration),'acceptance':registration,'ownership_activated':False}

def parser():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--environment',choices=['staging'],default='staging');p.add_argument('--capture',required=True);p.add_argument('--bundle',required=True);p.add_argument('--output',required=True)
 p.add_argument('--media-workers',type=int,choices=range(1,9),default=4);p.add_argument('--register',action='store_true',help='Register verified acceptance only; never commits ownership')
 return p
if __name__=='__main__':
 os.umask(0o077)
 try:print(json.dumps(collect(parser().parse_args()),default=str))
 except Exception as error:
  # Only reviewed verifier messages, never arbitrary DB/provider exception data.
  print(json.dumps({'status':'failed','error_type':type(error).__name__,'message':str(error) if type(error) is RuntimeError else 'Verification failed; inspect private diagnostics'}),file=sys.stderr);sys.exit(1)
