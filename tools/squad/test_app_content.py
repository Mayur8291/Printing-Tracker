"""APP/PROMO/JOB/MASTER: guest isolation, capabilities, content cursors and safe settings."""
from sqlstate_assertions import assert_app_conflict
import unittest,uuid,json
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
FEATURES=[{'key':'3','checked':'true','children':[{'key':'3.4','checked':'true'}]}]
class AppContent(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute("""INSERT INTO sa_snapshot_20261019.sa_promotions(id,name,category,upload_date,thumbnail,link,file_size,created_at,updated_at) VALUES
   (90001,'First','Assets','2026-11-01','a.png','https://www.youtube.com/watch?v=fixture','10KB',now(),'2026-11-05'),
   (90002,'Second','Documents','2026-11-02','b.png','document.pdf','20KB',now(),'2026-11-04'),
   (90003,'Tie','Assets','2026-11-01',NULL,'https://drive.google.com/file/d/fixture','30KB',now(),'2026-11-05');
   INSERT INTO sa_snapshot_20261019.sa_promotional_banners(id,title,position,image,rmp_brand_id,rmp_class_id,created_at,updated_at) VALUES
   (90001,'Second',2,'a.png',1,1,now(),now()),(90002,'First',1,'b.png',2,2,now(),now()),(90003,'Third',2,'c.png',NULL,NULL,now(),now());
   SELECT setval('sa_snapshot_20261019.sa_zones_id_seq',100);
  """)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n=100):self.c.execute('RESET ROLE');session(self.c,n)
 def guest(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{}',true)");self.c.execute('SET LOCAL ROLE anon')
 def save(self,g,fields,id=None,v='0:0',key=None):return rpc(self.c,'v1_settings_save',(g,id,Jsonb(fields),'Controlled setting',v,key or uuid.uuid4()))
 def release(self,minimum='1.10.0+2',recommended='2.0.0',v='0:0',key=None):return self.save('app_releases',{'platform':'android','minimum_version':minimum,'recommended_version':recommended,'update_url':'https://play.google.com/store/apps/details?id=test'},v=v,key=key)
 def caps(self,id=112,features=None,key=None,v='0:0'):return rpc(self.c,'v1_person_capabilities_save',(id,Jsonb(FEATURES if features is None else features),'Controlled feature grant',v,key or uuid.uuid4()))
 def promos(self,filters=None,cursor=None,limit=30):return rpc(self.c,'v1_promotions_list',(Jsonb(filters or {}),cursor,limit))
 def test_guest_bootstrap_has_only_public_release_fields(self):
  self.guest();r=rpc(self.c,'v1_app_bootstrap',('android','1.0.0'));self.assertEqual(set(r),{'api_version','client','platform','minimum_version','recommended_version','update_url','update_required','update_available','version_check'});self.assertFalse(r['update_required'])
 def test_guest_cannot_read_settings(self):
  self.guest()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_settings_read',('integrations',))
 def test_guest_cannot_read_releases_table(self):
  self.guest()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.app_releases')
 def test_guest_cannot_call_private_validator(self):
  self.guest()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.release_version('1.2.3')")
 def test_only_public_domain_function_is_read_only_bootstrap(self):
  rows=self.c.execute("SELECT proname,provolatile,prosecdef,pg_get_userbyid(proowner) FROM pg_proc WHERE pronamespace='sa_domain'::regnamespace AND has_function_privilege('anon',oid,'EXECUTE')").fetchall();self.assertEqual(rows,[('v1_app_bootstrap','s',True,'sa_executor')])
 def test_semantic_numeric_version_and_build(self):
  self.actor();self.release();self.guest()
  for version,required in [('1.2.99',True),('1.10.0+1',True),('1.10.0+2',False),('1.10.0+20',False),('2.0.0',False)]:self.assertEqual(rpc(self.c,'v1_app_bootstrap',('android',version))['update_required'],required)
 def test_version_missing_is_explicit_not_false_checked(self):
  self.guest();self.assertEqual(rpc(self.c,'v1_app_bootstrap',('ios',))['version_check'],'unknown_client_version')
 def test_flutter_version_does_not_force_new_client(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_app_configs(version,created_at,updated_at) VALUES('99.0.0 88.0.0',now(),now())");self.guest();self.assertFalse(rpc(self.c,'v1_app_bootstrap',('ios','1.0.0'))['update_required'])
 def test_platform_policies_independent(self):
  self.actor();self.release();self.guest();self.assertFalse(rpc(self.c,'v1_app_bootstrap',('ios','1.0.0'))['update_required'])
 def test_invalid_platform(self):
  self.guest()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_app_bootstrap',('whatever','1.0.0'))
 def test_invalid_semantic_version(self):
  self.guest()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_app_bootstrap',('android','1.99999999999999999.0'))
 def test_release_requires_update_destination(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('app_releases',{'platform':'ios','minimum_version':'2.0.0','recommended_version':None,'update_url':None})
 def test_release_rejects_recommendation_below_minimum(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.release('2.0.0','1.0.0')
 def test_release_retry_and_stale_version(self):
  self.actor();k=uuid.uuid4();r=self.release(key=k);self.assertEqual(r,self.release(key=k))
  with assert_app_conflict(self):self.release()
 def test_nonadmin_cannot_change_release(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.release()
 def test_release_reset_policy(self):
  self.actor();r=self.release();self.save('app_releases',{'platform':'android','minimum_version':None,'recommended_version':None,'update_url':None},v=r['version']);self.guest();self.assertFalse(rpc(self.c,'v1_app_bootstrap',('android','1.0.0'))['update_required'])
 def test_live_feature_grants_and_revocation(self):
  self.actor();r=self.caps();self.actor(112);self.assertTrue(rpc(self.c,'v1_me')['capabilities']['promotions']);self.assertEqual(len(self.promos()['data']),3)
  self.actor();self.caps(features=[],v=r['version']);self.actor(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.promos()
 def test_feature_retry(self):
  self.actor();k=uuid.uuid4();r=self.caps(key=k);self.assertEqual(r,self.caps(key=k))
 def test_worker_cannot_grant_self(self):
  self.actor(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.caps()
 def test_capabilities_only_worker_and_team(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.caps(id=103)
 def test_place_order_placeholder_cannot_be_enabled(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.caps(features=[{'key':'3','checked':True,'children':[{'key':'3.1','checked':True}]}])
 def test_legacy_false_placeholder_allowed(self):
  self.actor();r=self.caps(features=[{'key':'3','checked':'true','children':[{'key':'3.1','checked':'false'}]}]);self.assertFalse(r['capabilities']['place_orders'])
 def test_child_without_parent_denied(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.caps(features=[{'key':'3','checked':False,'children':[{'key':'3.4','checked':True}]}])
 def test_pc_promotions_matches_matrix(self):
  self.actor(102);self.assertTrue(rpc(self.c,'v1_me')['capabilities']['promotions']);self.assertEqual(len(self.promos()['data']),3)
 def test_factory_cannot_read_commercial_promotions(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.promos()
 def test_promotions_latest_with_tie_cursor(self):
  self.actor(103);p=self.promos(limit=1);q=self.promos(cursor=p['next_cursor'],limit=1);r=self.promos(cursor=q['next_cursor'],limit=1);self.assertEqual([p['data'][0]['id'],q['data'][0]['id'],r['data'][0]['id']],['90003','90001','90002']);self.assertIsNone(r['next_cursor'])
 def test_promotions_filtered_date_category(self):
  self.actor(103);self.assertEqual(len(self.promos({'category':'Assets','upload_date':'2026-11-01'})['data']),2)
 def test_promotions_filter_cursor_reuse_denied(self):
  self.actor(103);p=self.promos(limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.promos({'category':'Assets'},p['next_cursor'])
 def test_promotions_category_pagination(self):
  self.actor(103);p=self.promos({'mode':'categories'},limit=1);q=self.promos({'mode':'categories'},p['next_cursor'],1);self.assertEqual(p['data'],[{'category':'Assets'}]);self.assertEqual(q['data'],[{'category':'Documents'}]);self.assertIsNone(q['next_cursor'])
 def test_promotion_media_and_external_links_distinct(self):
  self.actor(103);r={x['id']:x for x in self.promos()['data']};self.assertEqual(r['90001']['content']['provider'],'youtube');self.assertEqual(r['90003']['content']['provider'],'google_drive');self.assertEqual(r['90002']['content']['kind'],'file');self.assertNotIn('url',r['90002']['content']);self.assertNotIn('a.png',json.dumps(r['90001']['thumbnail']))
 def test_unknown_unsafe_link_not_exposed(self):
  self.c.execute("UPDATE sa_snapshot_20261019.sa_promotions SET link='javascript:alert(1)' WHERE id=90001");self.actor(103);r=next(x for x in self.promos()['data'] if x['id']=='90001');self.assertNotIn('javascript',json.dumps(r))
 def test_deleted_promotion_hidden(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_promotions SET is_deleted=true WHERE id=90003');self.actor(103);self.assertEqual(len(self.promos()['data']),2)
 def test_banners_position_tie_pagination(self):
  self.actor(103);ids=[];cursor=None
  for _ in range(3):
   r=rpc(self.c,'v1_banners_list',(cursor,1));ids.append(r['data'][0]['id']);cursor=r['next_cursor']
  self.assertEqual(ids,['90002','90001','90003']);self.assertIsNone(cursor)
 def test_dealer_banner_brand_scope(self):
  self.actor(110);r=rpc(self.c,'v1_banners_list')['data'];self.assertEqual({x['id'] for x in r},{'90001','90003'});self.assertTrue(all(x['availability']['state']=='not_loaded' for x in r))
 def test_deleted_banner_hidden(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_promotional_banners SET is_deleted=true WHERE id=90003');self.actor(103);self.assertEqual(len(rpc(self.c,'v1_banners_list')['data']),2)
 def test_settings_secret_key_not_visible(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_settings(key,value,created_at,updated_at) VALUES('secret','DO_NOT_EXPOSE',now(),now())");self.actor();self.assertNotIn('DO_NOT_EXPOSE',json.dumps(rpc(self.c,'v1_settings_read',('integrations',))))
 def test_settings_unknown_group_denied(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_settings_read',('secrets',))
 def test_warehouse_provider_cannot_be_silently_switched(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('integrations',{'warehouse_provider':'unicommerce'})
 def test_airtable_setting_does_not_overwrite_source(self):
  self.actor();r=self.save('integrations',{'airtable_enabled':True});self.assertTrue(r['airtable_enabled']);self.assertFalse(r['imported_airtable_enabled']);self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_settings').fetchone()[0],0)
 def test_zone_city_create_and_unused_archive(self):
  self.actor();z=self.save('zones',{'name':'Unused test zone'},v=None);city=self.save('cities',{'name':'Unused test city','zone_id':z['id']},v=None);self.save('cities',{'archive':True},int(city['id']),city['version']);r=self.save('zones',{'archive':True},int(z['id']),z['version']);self.assertTrue(r['archived'])
 def test_used_zone_cannot_archive(self):
  self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save('zones',{'archive':True},1)
 def test_used_city_cannot_move_zone(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_cities(id,name,zone_id,created_at,updated_at) VALUES(9090,'Test City',1,now(),now());UPDATE sa_snapshot_20261019.sa_addresses SET city='Test City' WHERE id=100");self.actor();z=self.save('zones',{'name':'Another zone'},v=None)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save('cities',{'name':'Test City','zone_id':z['id']},9090)
 def test_duplicate_city_casefold_denied(self):
  self.actor();self.save('cities',{'name':'Case City','zone_id':'1'},v=None)
  with self.assertRaises(psycopg.errors.UniqueViolation):self.save('cities',{'name':'CASE CITY','zone_id':'1'},v=None)
 def test_criteria_preserve_used_name(self):
  self.actor();r=self.save('criteria',{'name':'Recorded criterion'},v=None);self.c.execute('RESET ROLE');self.c.execute('INSERT INTO sa_snapshot_20261019.sa_item_criteria(item_id,criteria_id,created_at,updated_at) VALUES(1001,%s,now(),now())',(int(r['id']),));self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save('criteria',{'name':'Rewritten history'},int(r['id']),r['version'])
 def test_unused_criteria_can_edit_and_archive(self):
  self.actor();r=self.save('criteria',{'name':'Unrecorded'},v=None);r=self.save('criteria',{'name':'Unused renamed'},int(r['id']),r['version']);self.assertTrue(self.save('criteria',{'archive':True},int(r['id']),r['version'])['archived'])
 def test_deleted_zone_not_selectable_and_not_used_for_prices(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_zones SET is_deleted=true WHERE id=1');self.actor(101);self.assertEqual(rpc(self.c,'v1_relationship_options',('zones',))['data'],[]);self.actor(103);r=rpc(self.c,'v1_catalog_options')['context'];self.assertEqual(r['basis'],'regular')
 def test_deleted_zone_not_assignable(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_zones SET is_deleted=true WHERE id=1');self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('cities',{'name':'Wrong zone','zone_id':'1'},v=None)
 def test_settings_pagination_and_versions(self):
  self.actor();self.save('zones',{'name':'Second'},v=None);p=rpc(self.c,'v1_settings_read',('zones',None,1));q=rpc(self.c,'v1_settings_read',('zones',p['next_cursor'],1));self.assertNotEqual(p['data'][0]['id'],q['data'][0]['id']);self.assertTrue(p['data'][0]['version'].startswith('0:'))
 def test_mirror_settings_write_blocked(self):
  self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.release()
 def test_city_selector_uses_only_active_zones(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_cities(id,name,zone_id,created_at,updated_at) VALUES(90001,'Visible City',1,now(),now());INSERT INTO sa_snapshot_20261019.sa_zones(id,name,is_deleted,created_at,updated_at) VALUES(90001,'Retired',true,now(),now());INSERT INTO sa_snapshot_20261019.sa_cities(id,name,zone_id,created_at,updated_at) VALUES(90002,'Retired City',90001,now(),now())")
  self.actor(103);r=rpc(self.c,'v1_relationship_options',('cities',None,'',None,2));self.assertEqual([x['id'] for x in r['data']],['90001'])
