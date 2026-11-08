"""Isolated, source-backed Airtable capture/validate/apply and security contracts."""
import json,pathlib,time,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session,uid
from local_db import connect
from test_catalogue import seed_catalogue
from test_warehouse_receipts import ownership
CONTRACTS=json.loads((pathlib.Path(__file__).parents[2]/'supabase/functions/squad-jobs/airtable-contracts.json').read_text())
def air(n):return 'rec'+str(n).zfill(14)
def record(resource,n,attrs=None,refs=None,relations=None,media=None):
 s=CONTRACTS[resource]
 return {'airtable_id':air(n),'attributes':{**{k:s.get('defaults',{}).get(k) for k in s['fields']},**(attrs or {})},
  'references':{k:{'resource':v['resource'],'airtable_id':(refs or {}).get(k)} for k,v in s.get('references',{}).items()},
  'relations':{k:(relations or {}).get(k,[]) for k in s.get('relations',{})},'media':{k:(media or {}).get(k) for k in s.get('media',{})}}
class Airtable(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');ownership(self.c);self.c.execute('UPDATE sa_domain.integration_preferences SET airtable_enabled=true');self.who=999;self.timings=[];self.actor()
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n=None):
  if n is not None:self.who=n
  self.c.execute('RESET ROLE');session(self.c,self.who,'authenticated' if self.who==999 else 'sa_app')
 def service(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');cur=self.c.execute(q,args);r=cur.fetchall() if cur.description else None;self.actor();return r
 def start(self):return self.c.execute("SELECT canto_api.v1_import_request('airtable','{}',%s)",(uuid.uuid4(),)).fetchone()[0]
 def claim(self):
  self.service();jobs=self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'];jobs=[j for j in jobs if j['handler']=='airtable'];self.assertEqual(len(jobs),1);return jobs[0]
 def work(self,j,action,data=None):
  self.service();started=time.monotonic();r=self.c.execute('SELECT canto_api.squad_airtable_work(%s,%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),action,Jsonb(data or {}))).fetchone()[0];self.timings.append((action,time.monotonic()-started));return r
 def status(self,t):self.actor();return self.c.execute('SELECT canto_api.v1_import_status(%s)',(uuid.UUID(t['id']),)).fetchone()[0]
 def capture(self,j,rows):
  for i in range(1000):
   inp=self.work(j,'input')
   if inp['phase']!='capture':return inp
   data=rows.get(inp['resource'],[]);offset=int((inp['offset'] or 'page:0').split(':')[1]);chunk=data[offset:offset+100];next_=f'page:{offset+100}' if len(data)>offset+100 else None
   self.work(j,'capture',{'resource':inp['resource'],'offset':inp['offset'],'next_offset':next_,'records':chunk,'eof':next_ is None})
  self.fail('Capture did not finish')
 def validate(self,t,rows):
  j=self.claim();self.capture(j,rows)
  for i in range(1000):
   inp=self.work(j,'input')
   if inp.get('state')!='ready':return self.status(t)
   self.assertEqual(inp['phase'],'validate');r=self.work(j,'validate')
   if r['state']=='done':return self.status(t)
   self.assertEqual(r['state'],'ready',r)
  self.fail('Validation did not finish')
 def apply(self,t):
  self.actor();t=self.c.execute("SELECT canto_api.v1_import_request('airtable',%s,%s)",(Jsonb({'action':'apply','id':t['id'],'version':t['version']}),uuid.uuid4())).fetchone()[0];j=self.claim()
  for i in range(1000):
   r=self.work(j,'input');r=self.work(j,'apply')
   if r['state'] in('done','dead'):return self.status(t)
  self.fail('Apply did not finish')
 def test_new_master_validates_without_sequence_and_applies_source_zero(self):
  self.raw('ALTER SEQUENCE sa_snapshot_20261019.sa_base_product_types_id_seq RESTART WITH 10001');before=self.raw('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_base_product_types_id_seq');t=self.start();s=self.validate(t,{'base_product_types':[record('base_product_types',1,{'name':'Airtable type','position':2})]});self.assertEqual(s['state'],'validated',s);self.assertEqual(before,self.raw('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_base_product_types_id_seq'));self.assertEqual(s['valid_rows'],1);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw("SELECT name,source,airtable_id FROM sa_snapshot_20261019.sa_base_product_types WHERE name='Airtable type'"),[('Airtable type',0,air(1))])
 def full_rows(self):
  attrs={
   'promotions':{'name':'AT Promotion','upload_date':'2026-11-01','link':'https://example.com/catalogue','category':'Catalogue'},
   'asset_infos':{'dX':1,'dY':2,'mirrorDX':3,'assetHeightRespToBox':4},
   'colors':{'name':'AT Blue','hex_code':'#0000ff'},'authorized_brands':{'name':'AT Brand'},
   'profit_margins':{'name':'AT Margin','min_range':1,'max_range':10,'margin_percentage':20,'branding_embroidery':3,'branding_print':2},
   'size_types':{'name':'AT Size Type'},'base_product_types':{'name':'AT Product Type','position':1},
   'base_products':{'name':'AT Base','base_of':20,'base_sn':10,'tims_cost':5,'adult_consumption':2,'kids_consumption':1,'over_header_percentage':10,'sample_rate':500,'position':0,'calculator':1000,'branding_sides':'front'},
   'add_ons':{'add_on':'AT Addon','add_on_price':5,'add_on_of':3,'add_on_sn':2,'has_color':True,'select_type':'single','group_name':'collar','position':0,'layer_sort':0},
   'parts':{'name':'AT Part','position':0,'order_criteria':False},'fabrics':{'name':'AT Fabric','fabric_type':'cotton','price':50,'uom':'METER','gsm':200},
   'sc_sizes':{'name':'AT Custom Size','position':1},'rmp_categories':{'name':'AT Category','position':1},'rmp_brands':{'name':'AT RMP Brand','position':1,'main_category':'AT Parent'},
   'rmp_sizes':{'name':'AT M','size_type':'alpha','position':3},'rmp_colors':{'name':'AT RMP Blue','code':'BLUE'},
   'rmp_classes':{'name':'AT Class','position':1,'embeded_video':None},'rmp_skus':{'name':'AT SKU','cgst':2.5,'igst':5,'sgst':2.5},
   'rmp_price_types':{'name':'AT Regular','price_for':'customer'},'rmp_prices':{'name':'AT Price','price':100,'mrp':150},
   'base_product_asset_infos':{},'promotional_banners':{'status':'active','position':1,'title':'AT Banner'}}
  rows={}
  for i,(r,spec) in enumerate(CONTRACTS.items(),1):
   refs={k:air(list(CONTRACTS).index(v['resource'])+1) for k,v in spec.get('references',{}).items()}
   rel={k:['AT Derived Category'] if k=='categories' else [air(list(CONTRACTS).index(k)+1)] for k in spec.get('relations',{})}
   rows[r]=[record(r,i,attrs[r],refs,rel)]
  return rows
 def reset_sequences(self):
  self.raw("DO $f$ DECLARE r record;BEGIN FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='sa_snapshot_20261019' LOOP EXECUTE format('ALTER SEQUENCE %%I.%%I RESTART WITH 10001','sa_snapshot_20261019',r.sequencename);END LOOP;END $f$")
 def test_all_22_resources_new_dependencies_categories_and_relations(self):
  self.reset_sequences();rows=self.full_rows();s=self.validate(self.start(),rows);self.assertEqual(s['state'],'validated',s);self.assertEqual(s['valid_rows'],23);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(s['applied_rows'],23)
  self.assertEqual(self.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_base_product_categories l JOIN sa_snapshot_20261019.sa_categories c ON c.id=l.category_id WHERE c.name='AT Derived Category' AND NOT l.is_deleted"),[(1,)])
  self.assertEqual(self.raw("SELECT p.source,l.source FROM sa_snapshot_20261019.sa_rmp_prices p JOIN sa_snapshot_20261019.sa_rmp_sku_prices l ON l.rmp_price_id=p.id WHERE p.name='AT Price'"),[(0,0)])
 def finish_validation(self,t,j):
  for i in range(1000):
   r=self.work(j,'input');self.assertEqual(r.get('phase'),'validate',r);r=self.work(j,'validate')
   if r['state']=='done':return self.status(t)
  self.fail('Validation did not finish')
 def media_fixture(self,variant='original'):
  return {'id':'att00000000000001','url':'https://v5.airtableusercontent.com/captured/file.png','filename':'file.png','bytes':2048,'mime':'image/png','variant':variant}
 def test_verified_media_is_registered_and_attached_with_content_address(self):
  self.reset_sequences();t=self.start();j=self.claim();i=self.capture(j,{'base_product_types':[record('base_product_types',1,{'name':'With image','position':0},media={'image':self.media_fixture()})]});self.assertEqual(i['phase'],'media');a=i['assets'][0];m={'bucket':'canto-media','path':'sha256/aa/'+'a'*64,'sha256':'a'*64,'bytes':2048,'mime':'image/png'};d={'assets':[{'asset_id':a['asset_id'],'attachment_id':a['attachment']['id'],'status':'ready','manifest':m}]};self.work(j,'media',d);self.work(j,'media',d);s=self.finish_validation(t,j);self.assertEqual(s['state'],'validated',s);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw("SELECT image FROM sa_snapshot_20261019.sa_base_product_types WHERE name='With image'"),[('squad:'+'a'*64,)]);self.assertEqual(self.raw("SELECT status,sha256 FROM sa_media.references WHERE resource='base_product_types'"),[('ready','a'*64)])
 def test_failed_media_invalidates_entire_import_without_retirement(self):
  t=self.start();j=self.claim();i=self.capture(j,{'base_product_types':[record('base_product_types',1,{'name':'Missing image','position':0},media={'image':self.media_fixture()})]});a=i['assets'][0];self.work(j,'media',{'assets':[{'asset_id':a['asset_id'],'attachment_id':a['attachment']['id'],'status':'failed','error_code':'AIRTABLE_MEDIA_CHANGED'}]});s=self.finish_validation(t,j);self.assertEqual(s['state'],'invalid',s)
 def test_media_original_and_thumbnail_actual_size_can_differ(self):
  t=self.start();j=self.claim();rows={'rmp_colors':[record('rmp_colors',1,{'name':'AT Blue','code':'B'})],'rmp_classes':[record('rmp_classes',2,{'name':'AT class','position':0},refs={'rmp_color_id':air(1)},media={'image_1_thumb':self.media_fixture('large')})]};i=self.capture(j,rows);a=i['assets'][0];self.work(j,'media',{'assets':[{'asset_id':a['asset_id'],'attachment_id':a['attachment']['id'],'status':'ready','manifest':{'bucket':'canto-media','path':'sha256/bb/'+'b'*64,'sha256':'b'*64,'bytes':128,'mime':'image/jpeg'}}]});s=self.finish_validation(t,j);self.assertEqual(s['state'],'validated',s)
 def test_media_attachment_identity_mismatch_rejected(self):
  t=self.start();j=self.claim();i=self.capture(j,{'base_product_types':[record('base_product_types',1,{'name':'Image','position':0},media={'image':self.media_fixture()})]});a=i['assets'][0]
  r=self.work(j,'media',{'assets':[{'asset_id':a['asset_id'],'attachment_id':'att00000000000002','status':'failed','error_code':'AIRTABLE_MEDIA_CHANGED'}]});self.assertEqual(r['state'],'dead');self.assertEqual(r['error_code'],'AIRTABLE_INVALID_MEDIA')
 def test_revoked_admin_fails_durably(self):
  t=self.start();j=self.claim();self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),));r=self.work(j,'input');self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT state FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)),[('failed',)])
 def test_retry_delay_and_exhaustion_are_durable(self):
  t=self.start();j=self.claim();r=self.work(j,'retry',{'code':'AIRTABLE_RATE_LIMIT','retry_after_seconds':300});self.assertEqual(r['state'],'pending');self.assertEqual(self.raw('SELECT round(extract(epoch FROM available_at-now())) FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),)),[(300,)])
 def test_fake_lease_rejected(self):
  t=self.start();j=self.claim();j['lease_token']=str(uuid.uuid4())
  with self.assertRaises(psycopg.errors.SerializationFailure):self.work(j,'input')
 def test_expired_lease_exhaustion_and_explicit_retry_resume(self):
  t=self.start();j=self.claim();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.service();self.c.execute('SELECT canto_api.squad_job_claim(10)');s=self.status(t);self.assertEqual(s['state'],'failed');job=self.c.execute('SELECT canto_api.v1_job_get(%s)',(uuid.UUID(j['id']),)).fetchone()[0];self.c.execute('SELECT canto_api.v1_job_retry(%s,%s,%s,%s)',(uuid.UUID(j['id']),'Retry worker restart',job['version'],uuid.uuid4()));self.assertEqual(self.status(t)['state'],'validating');j=self.claim();self.assertEqual(self.work(j,'input')['state'],'ready')
 def test_source_contract_snapshot_matches_edge_mappings(self):
  values=dict(self.raw('SELECT resource,contract FROM sa_domain.airtable_resources'));self.assertEqual(values,CONTRACTS)
 def test_null_name_is_reported_without_business_write(self):
  s=self.validate(self.start(),{'base_product_types':[record('base_product_types',1,{'position':0})]});self.assertEqual(s['state'],'invalid',s)
 def test_updated_existing_record_uses_optimistic_version(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_product_types SET source=0,airtable_id=%s WHERE id=1',(air(1),));s=self.validate(self.start(),{'base_product_types':[record('base_product_types',1,{'name':'Rename','position':1})]});self.assertEqual(s['state'],'validated',s);self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET updated_at=now()+interval '1 second' WHERE id=1");s=self.apply(s);self.assertEqual(s['state'],'failed',s);self.assertEqual(self.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[('Shirts',)])
 def test_thousand_prices_bounded_apply_recomputes_class_once(self):
  self.reset_sequences();rows=self.full_rows();price=rows['rmp_prices'][0];rows['rmp_prices']=[{**price,'airtable_id':air(1000+i),'attributes':{**price['attributes'],'name':f'AT price {i}','price':100+i/100}} for i in range(1000)];t=self.start();s=self.validate(t,rows);self.assertEqual(s['state'],'validated',s);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_prices WHERE name LIKE 'AT price %%'"),[(1000,)]);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.airtable_statistics WHERE transfer_id=%s AND class_id=(SELECT id FROM sa_snapshot_20261019.sa_rmp_classes WHERE name='AT Class')",(uuid.UUID(t['id']),)),[(1,)])
  maximum=max(t for action,t in self.timings if action in('validate','apply'));self.assertLess(maximum,2.0,f'Slow batch: {maximum:.3f}s');print(f' Airtable1000price maximum SQL batch {maximum*1000:.1f}ms',flush=True)
 def test_identity_recreation_fallback_uses_source_zero_only(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_parts SET source=0,airtable_id=%s WHERE id=1',(air(99),));s=self.validate(self.start(),{'parts':[record('parts',1,{'name':'Collar','position':5,'order_criteria':False})]});self.assertEqual(s['state'],'validated',s);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw('SELECT airtable_id,position,source FROM sa_snapshot_20261019.sa_parts WHERE id=1'),[(air(1),5,0)])
 def test_identity_recreation_cannot_claim_another_captured_record(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_parts SET source=0,airtable_id=%s WHERE id=1',(air(99),));s=self.validate(self.start(),{'parts':[record('parts',1,{'name':'Collar','position':5,'order_criteria':False}),record('parts',99,{'name':'Original renamed','position':1,'order_criteria':False})]});self.assertEqual(s['state'],'invalid',s)
 def test_canonical_size_position_is_updated_with_expected_version(self):
  self.reset_sequences();self.raw("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,position,created_at,updated_at) VALUES(99999,'AT M',0,now(),now())");s=self.validate(self.start(),{'rmp_sizes':[record('rmp_sizes',1,{'name':'AT M','position':7,'size_type':'alpha'})]});self.assertEqual(s['state'],'validated',s);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw('SELECT position FROM sa_snapshot_20261019.sa_sizes WHERE id=99999'),[(7,)])
 def test_canonical_size_concurrent_edit_preserved(self):
  self.reset_sequences();self.raw("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,position,created_at,updated_at) VALUES(99999,'AT M',0,now(),now())");s=self.validate(self.start(),{'rmp_sizes':[record('rmp_sizes',1,{'name':'AT M','position':7,'size_type':'alpha'})]});self.raw("UPDATE sa_snapshot_20261019.sa_sizes SET position=9,updated_at=now()+interval '1 second' WHERE id=99999");s=self.apply(s);self.assertEqual(s['state'],'failed',s);self.assertEqual(self.raw('SELECT position FROM sa_snapshot_20261019.sa_sizes WHERE id=99999'),[(9,)])
 def test_malformed_or_unapproved_manifest_rejected_without_object(self):
  t=self.start();j=self.claim();i=self.capture(j,{'base_product_types':[record('base_product_types',1,{'name':'Image','position':0},media={'image':self.media_fixture()})]});a=i['assets'][0];base={'bucket':'canto-media','path':'sha256/aa/'+'a'*64,'sha256':'a'*64,'bytes':2048,'mime':'image/png'}
  for patch in [{'sha256':None},{'path':None},{'mime':'text/html'},{'bytes':None},{'bytes':0},{'bytes':1.5},{'bytes':1024},{'bucket':'public'},{'mime':''}]:
   with self.subTest(patch=patch):
    with self.c.transaction():
     r=self.work(j,'media',{'assets':[{'asset_id':a['asset_id'],'attachment_id':a['attachment']['id'],'status':'ready','manifest':{**base,**patch}}]});self.assertEqual(r['state'],'dead');self.assertEqual(r['error_code'],'AIRTABLE_INVALID_MEDIA');self.assertEqual(self.status(t)['state'],'failed');raise psycopg.Rollback()
  self.assertEqual(self.raw('SELECT count(*) FROM sa_media.objects'),[(0,)])
 def test_expiration_scrubs_captured_fields_and_source_urls(self):
  t=self.start();j=self.claim();i=self.capture(j,{'base_product_types':[record('base_product_types',1,{'name':'Image','position':0},media={'image':self.media_fixture()})]});self.raw("UPDATE sa_domain.transfers SET expires_at=now()-interval '1 second' WHERE id=%s",(uuid.UUID(t['id']),));self.service();self.c.execute('SELECT canto_api.squad_transfer_cleanup()');self.assertEqual(self.raw('SELECT attributes,media FROM sa_domain.airtable_rows WHERE transfer_id=%s',(uuid.UUID(t['id']),)),[({}, {})]);self.assertEqual(self.raw("SELECT attachment ? 'url' FROM sa_domain.airtable_assets"),[(False,)])
 def test_cancel_releases_global_slot(self):
  t=self.start();t=self.status(t);self.c.execute("SELECT canto_api.v1_import_request('airtable',%s,%s)",(Jsonb({'action':'cancel','id':t['id'],'version':t['version']}),uuid.uuid4()));self.assertNotEqual(self.start()['id'],t['id'])
 def test_capture_limit_is_higher_than_csv_limit_and_bounded(self):
  t=self.start();j=self.claim();i=self.work(j,'input');self.raw('UPDATE sa_domain.airtable_runs SET capture_rows=20000 WHERE transfer_id=%s',(uuid.UUID(t['id']),));self.work(j,'capture',{'resource':i['resource'],'offset':None,'next_offset':'page:100','records':[record('colors',1,{'name':'AT Green','hex_code':'#00ff00'})],'eof':False});self.raw('UPDATE sa_domain.airtable_runs SET capture_rows=200000 WHERE transfer_id=%s',(uuid.UUID(t['id']),))
  r=self.work(j,'capture',{'resource':i['resource'],'offset':'page:100','next_offset':None,'records':[record('colors',2,{'name':'AT Red','hex_code':'#ff0000'})],'eof':True});self.assertEqual(r['state'],'dead');self.assertEqual(r['error_code'],'AIRTABLE_RESPONSE_LIMIT')
 def test_service_role_cannot_forge_private_master_capability(self):
  self.service()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("INSERT INTO sa_domain.airtable_master_context(backend_pid,transaction_id,job_id,lease_token,transfer_id,resource,action,dry_run,payload_sha256) VALUES(pg_backend_pid(),txid_current(),%s,%s,%s,'parts','create',false,'')",(uuid.uuid4(),uuid.uuid4(),uuid.uuid4()))
 def test_missing_required_asset_link_is_explicitly_invalid(self):
  rows=self.full_rows();rows['base_product_asset_infos'][0]['references']['add_on_id']['airtable_id']=None;s=self.validate(self.start(),rows);self.assertEqual(s['state'],'invalid',s);bad=[r for r in s['rows']['data'] if r['resource']=='base_product_asset_infos'];self.assertEqual(bad[0]['state'],'invalid')
 def partial_prices(self):
  self.reset_sequences();rows=self.full_rows();price=rows['rmp_prices'][0];rows['rmp_prices']=[{**price,'airtable_id':air(1000+i),'attributes':{**price['attributes'],'name':f'Partial price {i}'}} for i in range(150)];s=self.validate(self.start(),rows);self.assertEqual(s['state'],'validated',s);self.actor();t=self.c.execute("SELECT canto_api.v1_import_request('airtable',%s,%s)",(Jsonb({'action':'apply','id':s['id'],'version':s['version']}),uuid.uuid4())).fetchone()[0];j=self.claim();self.work(j,'input');self.assertEqual(self.work(j,'apply')['state'],'ready');self.assertGreater(self.raw('SELECT count(*) FROM sa_domain.airtable_statistics WHERE transfer_id=%s AND NOT applied',(uuid.UUID(t['id']),))[0][0],0);return t,j
 def repair_statistics(self,t):
  j=self.claim();i=self.work(j,'input');self.assertEqual(i['step'],'statistics_repair')
  for n in range(100):
   r=self.work(j,'apply')
   if r['state']=='done':break
  self.assertEqual(r['state'],'done');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.airtable_statistics WHERE transfer_id=%s AND NOT applied',(uuid.UUID(t['id']),)),[(0,)])
  self.assertEqual(self.raw("SELECT result->>'derived_statistics' FROM sa_domain.transfers WHERE id=%s",(uuid.UUID(t['id']),)),[('repaired',)])
 def test_cancelled_partial_prices_repair_when_disabled_and_actor_revoked(self):
  t,j=self.partial_prices();s=self.status(t);self.c.execute("SELECT canto_api.v1_import_request('airtable',%s,%s)",(Jsonb({'action':'cancel','id':s['id'],'version':s['version']}),uuid.uuid4()));self.raw('UPDATE sa_domain.integration_preferences SET airtable_enabled=false');self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),));before=self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_prices');self.repair_statistics(t);self.assertEqual(before,self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_rmp_prices'));self.assertEqual(self.raw('SELECT state FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)),[('cancelled',)])
 def test_revoked_actor_partial_apply_fails_then_repairs_only_statistics(self):
  t,j=self.partial_prices();self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),));self.assertEqual(self.work(j,'input')['state'],'dead');self.repair_statistics(t);self.assertEqual(self.raw('SELECT state FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)),[('failed',)])
 def test_parallel_reader_contention_reschedules_without_invalid_rows(self):
  t=self.start();j=self.claim();self.capture(j,{})
  with connect() as other:
   other.execute('BEGIN');other.execute('SELECT pg_advisory_xact_lock_shared(20261107,1)');r=self.work(j,'validate');self.assertEqual(r['state'],'pending');self.assertEqual(r['error_code'],'AIRTABLE_BUSY');other.execute('ROLLBACK')
  self.assertEqual(self.status(t)['invalid_rows'],0)
 def test_browser_cannot_call_worker(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT canto_api.squad_airtable_work(%s,%s,'input')",(uuid.uuid4(),uuid.uuid4()))
 def test_current_legacy_admin_is_allowed_without_staff_promotion(self):
  self.actor(100);t=self.start();s=self.validate(t,{'base_product_types':[record('base_product_types',1,{'name':'Legacy admin type','position':0})]});self.assertEqual(s['state'],'validated',s);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw('SELECT count(*) FROM public.profiles WHERE id=%s',(uid(100),)),[(0,)])
 def test_customer_cannot_start(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.start()
 def test_disabled_integration_cannot_start(self):
  self.raw('UPDATE sa_domain.integration_preferences SET airtable_enabled=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.start()
 def test_unverified_boolean_cutover_cannot_start(self):
  self.raw('DELETE FROM sa_domain.cutover_commits')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.start()
 def test_source_one_identity_is_never_overwritten(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_product_types SET source=1,airtable_id=%s WHERE id=1',(air(1),));s=self.validate(self.start(),{'base_product_types':[record('base_product_types',1,{'name':'Overwrite','position':0})]});self.assertEqual(s['state'],'invalid',s);self.assertEqual(self.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[('Shirts',)])
 def test_duplicate_names_are_invalid_before_business_sequence(self):
  s=self.validate(self.start(),{'base_product_types':[record('base_product_types',1,{'name':'Duplicate','position':0}),record('base_product_types',2,{'name':'duplicate','position':0})]});self.assertEqual(s['state'],'invalid',s);self.assertEqual(s['invalid_rows'],2)
 def test_capture_same_page_replay_is_idempotent(self):
  t=self.start();j=self.claim();i=self.work(j,'input');d={'resource':i['resource'],'offset':None,'next_offset':None,'records':[],'eof':True};self.work(j,'capture',d);self.work(j,'capture',d);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.airtable_pages WHERE transfer_id=%s',(uuid.UUID(t['id']),)),[(1,)])
 def test_capture_changed_same_page_is_conflict(self):
  t=self.start();j=self.claim();i=self.work(j,'input');d={'resource':i['resource'],'offset':None,'next_offset':None,'records':[],'eof':True};self.work(j,'capture',d);d['next_offset']='next';d['eof']=False
  with self.assertRaises(psycopg.errors.SerializationFailure):self.work(j,'capture',d)
 def test_yield_preserves_checkpoint_with_new_lease(self):
  t=self.start();j=self.claim();i=self.work(j,'input');self.work(j,'capture',{'resource':i['resource'],'offset':None,'next_offset':'next','records':[],'eof':False});self.assertEqual(self.work(j,'yield')['state'],'pending');j=self.claim();self.assertEqual(self.work(j,'input')['offset'],'next')
 def test_global_single_import_includes_validated_waiting_for_apply(self):
  s=self.validate(self.start(),{});self.assertEqual(s['state'],'validated');self.actor(100)
  with self.assertRaises(psycopg.errors.UniqueViolation):self.start()
 def test_missing_source_zero_is_retired_source_one_preserved(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_product_types SET source=0,airtable_id=%s WHERE id=1',(air(99),));s=self.validate(self.start(),{});self.assertEqual(s['state'],'validated',s);self.assertGreater(s['result']['retirements'],0);s=self.apply(s);self.assertEqual(s['state'],'completed',s);self.assertEqual(self.raw('SELECT is_deleted,airtable_id FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[(True,air(99))])
 def test_concurrent_updated_candidate_is_not_retired(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_product_types SET source=0,airtable_id=%s WHERE id=1',(air(99),));s=self.validate(self.start(),{});self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET updated_at=now()+interval '1 second' WHERE id=1");s=self.apply(s);self.assertEqual(s['state'],'failed',s);self.assertEqual(self.raw('SELECT is_deleted FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[(False,)])
if __name__=='__main__':unittest.main(verbosity=2)
