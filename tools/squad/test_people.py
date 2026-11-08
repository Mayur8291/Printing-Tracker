"""CRM-01/02/03 and SEC-04/06/08: real RLS and atomic people commands."""
from sqlstate_assertions import assert_app_conflict
import concurrent.futures,threading,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue

class People(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute("SELECT setval('sa_snapshot_20261019.sa_factories_id_seq',100)")
  self.c.execute("SELECT setval('sa_snapshot_20261019.sa_addresses_id_seq',1000)")
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def save(self,role=3,fields=None,id=None,version=None,key=None):
  fields=fields if fields is not None else {'name':'New person','email':f'new-{uuid.uuid4()}@example.invalid'}
  return rpc(self.c,'v1_person_save',(id,role,Jsonb(fields),version,key or uuid.uuid4()))
 def tailor(self,fields=None,id=None,version=None,sub=False,key=None):
  return rpc(self.c,'v1_subtailor_save' if sub else 'v1_tailor_save',(id,Jsonb(fields or {'name':'Managed person'}),version,key or uuid.uuid4()))
 def address(self,owner=103,fields=None,id=None,version=None,key=None):
  return rpc(self.c,'v1_address_save',(id,owner,Jsonb(fields or {'address':'New road','state':'Karnataka','city':'Bengaluru','zip_code':'560001','is_primary':True}),version,key or uuid.uuid4()))
 def details(self,id):return rpc(self.c,'v1_person_get',(int(id),))
 def test_sc_creation_is_unapproved_and_enrollment_pending(self):
  self.actor(101);p=self.save();d=self.details(p['id']);self.assertFalse(d['approved']);self.assertFalse(d['onboarded']);self.assertEqual(d['coordinator_id'],'101');self.assertEqual(p['account'],'queued')
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT encrypted_password FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(p['id']),)).fetchone()[0],'')
  self.assertIsNone(self.c.execute('SELECT 1 FROM sa_identity.sa_auth_identities WHERE legacy_user_id=%s',(int(p['id']),)).fetchone())
 def test_create_exact_retry_single_intent(self):
  self.actor(101);f={'name':'New','email':'controlled@example.invalid'};k=uuid.uuid4();p=self.save(fields=f,key=k);self.assertEqual(p,self.save(fields=f,key=k))
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_requests').fetchone()[0],1)
 def test_dealer_creation_auto_approved_linked_and_sc_inherited(self):
  self.actor(110);p=self.save();d=self.details(p['id']);self.assertTrue(d['approved']);self.assertTrue(d['onboarded']);self.assertEqual(d['registered_by'],2);self.assertEqual(d['dealer_ids'],['110']);self.assertEqual(d['coordinator_id'],'101')
 def test_dealer_cannot_create_staff(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(1)
 def test_sc_cannot_create_admin(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(0)
 def test_pc_cannot_create_customer(self):
  self.actor(102)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_customer_cannot_create_people(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_sc_cannot_edit_other_sc_customer(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.NoDataFound):self.save(id=203,fields={'name':'Attack'},version='0:0')
 def test_email_case_collision(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.UniqueViolation):self.save(fields={'name':'Collision','email':' PERSONA-103@SQUAD.INVALID '})
 def test_deleted_email_still_reserved(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() WHERE id=203');self.actor(100)
  with self.assertRaises(psycopg.errors.UniqueViolation):self.save(fields={'name':'Collision','email':'persona-203@squad.invalid'})
 def test_email_change_requires_account_flow(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(id=103,fields={'email':'new@example.invalid'},version='0:0')
 def test_unknown_sensitive_fields_rejected(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(id=103,fields={'encrypted_password':'bad'},version='0:0')
 def test_stale_profile_version(self):
  self.actor(101)
  with assert_app_conflict(self):self.save(id=103,fields={'name':'New'},version='0:99')
 def test_edit_preserves_creator_and_approval(self):
  self.actor(110);p=self.save(id=103,fields={'name':'Renamed'},version='0:0');d=self.details(p['id']);self.assertEqual(d['coordinator_id'],'101');self.assertTrue(d['approved']);self.assertEqual(d['name'],'Renamed')
 def test_admin_feature_grants_live(self):
  self.actor(100);self.save(12,{'features':[{'key':'3','checked':True,'children':[{'key':'3.3','checked':True}]}]},112,'0:0');self.actor(112)
  self.assertTrue(rpc(self.c,'v1_me')['capabilities']['configure'])
 def test_child_without_parent_rejected(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(12,{'features':[{'key':'3','checked':False,'children':[{'key':'3.3','checked':True}]}]},112,'0:0')
 def test_sc_cannot_set_features(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(3,{'features':[]},103,'0:0')
 def test_duplicate_features_rejected(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(12,{'features':[{'key':'1','checked':True}]*2},112,'0:0')
 def test_customer_to_dealer_requires_no_live_orders(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save(10,{'name':'Dealer'},103,'0:0')
 def test_customer_to_dealer_idle_supported(self):
  self.actor(110);p=self.save();self.actor(101);q=self.save(10,{'name':'Dealer'},int(p['id']),p['version']);self.assertEqual(q['role'],10);self.assertEqual(self.details(q['id'])['dealer_ids'],[])
 def test_dealer_to_customer_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(3,{'name':'Customer'},110,'0:0')
 def test_self_role_change_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(1,{'name':'Self'},100,'0:0')
 def test_tailor_and_subtailor_have_no_auth_or_contact_email(self):
  self.actor(104);t=self.tailor();s=self.tailor({'name':'Sub','parent_tailor_id':t['id']},sub=True)
  self.assertEqual(t['account'],'managed_subject');self.assertIsNone(self.details(t['id'])['email']);self.assertEqual(self.details(s['id'])['parent_tailor_id'],t['id'])
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_requests').fetchone()[0],0)
  self.assertEqual(self.c.execute('SELECT encrypted_password FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(t['id']),)).fetchone()[0],'')
 def test_managed_subject_cannot_get_email(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.tailor({'name':'Tailor','email':'foo@example.invalid'})
 def test_fm_cannot_choose_other_manager(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.tailor({'name':'Tailor','manager_id':'204'})
 def test_subtailor_cross_factory_parent_denied(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.tailor({'name':'Sub','parent_tailor_id':'205'},sub=True)
 def test_pc_can_create_tailor_in_selected_factory(self):
  self.actor(102);p=self.tailor({'name':'Tailor','manager_id':'204'});self.assertEqual(self.details(p['id'])['factory_id'],'2')
 def test_staff_requires_correct_role(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_factory_team_save',(None,0,Jsonb({'name':'Admin'}),None,uuid.uuid4()))
 def test_factory_staff_enrollment_queued(self):
  self.actor(104);p=rpc(self.c,'v1_factory_team_save',(None,9,Jsonb({'name':'Cutter','email':'cutter@example.invalid'}),None,uuid.uuid4()));self.assertEqual(p['account'],'queued');self.assertEqual(self.details(p['id'])['manager_id'],'104')
 def test_fm_cannot_edit_other_team(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.NoDataFound):self.tailor({'name':'Other'},205,'0:0')
 def test_archive_preserves_subject_row(self):
  self.actor(104);t=self.tailor();r=rpc(self.c,'v1_person_archive',(int(t['id']),'No longer active',t['version'],uuid.uuid4()));self.assertEqual(r['state'],'archived')
  self.c.execute('RESET ROLE');self.assertIsNotNone(self.c.execute('SELECT deleted_at FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(t['id']),)).fetchone()[0])
 def test_archive_blocks_child_subjects(self):
  self.actor(104);t=self.tailor();self.tailor({'name':'Child','parent_tailor_id':t['id']},sub=True)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_person_archive',(int(t['id']),'Still has children',t['version'],uuid.uuid4()))
 def test_archive_blocks_orders(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_person_archive',(103,'Active customer','0:0',uuid.uuid4()))
 def test_archive_self_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_person_archive',(100,'Self','0:0',uuid.uuid4()))
 def test_factory_creation_and_manager(self):
  self.actor(102);f=rpc(self.c,'v1_factory_save',(None,'New factory',None,uuid.uuid4()));p=self.save(4,{'name':'Manager','email':'fm@example.invalid','factory_id':f['id']});self.assertEqual(self.details(p['id'])['factory_id'],f['id'])
 def test_factory_name_collision(self):
  self.actor(102)
  with self.assertRaises(psycopg.errors.UniqueViolation):rpc(self.c,'v1_factory_save',(None,' TEST FACTORY ',None,uuid.uuid4()))
 def test_factory_manager_only_own_factory(self):
  self.actor(104);self.assertEqual([x['id'] for x in rpc(self.c,'v1_factories_list')['data']],['1'])
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_factory_save',(2,'Foreign','0:0',uuid.uuid4()))
 def test_address_owner_edit_and_single_primary(self):
  self.actor(103);a=self.address();b=self.address(fields={'address':'Second','state':'Karnataka','city':'Bengaluru','zip_code':'560002','is_primary':True})
  self.assertEqual([x['id'] for x in b['addresses'] if x['is_primary']],[b['id']]);self.assertNotEqual(a['version'],next(x['version'] for x in b['addresses'] if x['id']==a['id']))
 def test_address_retry(self):
  self.actor(103);k=uuid.uuid4();a=self.address(key=k);self.assertEqual(a,self.address(key=k))
 def test_address_foreign_owner_denied(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.address(203)
 def test_address_used_on_order_cannot_be_edited(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.address(id=100,fields={'address':'Overwrite history'},version='0:0')
 def test_active_order_address_cannot_be_archived(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_address_archive',(100,103,'0:0',uuid.uuid4()))
 def test_primary_only_change_on_used_address(self):
  self.actor(103);r=self.address(id=100,fields={'is_primary':True},version='0:0');self.assertTrue(r['addresses'][0]['is_primary'])
 def test_address_archive_selects_replacement(self):
  self.actor(103);a=self.address();r=rpc(self.c,'v1_address_archive',(int(a['id']),103,a['version'],uuid.uuid4()));self.assertEqual([x['id'] for x in r['addresses'] if x['is_primary']],['100'])
 def test_customer_can_read_own_addresses_not_contacts(self):
  self.actor(103);self.assertEqual(self.details(103)['addresses'][0]['id'],'100')
  with self.assertRaises(psycopg.errors.NoDataFound):self.details(203)
 def test_inspector_does_not_get_addresses_or_contact(self):
  self.actor(108);d=self.details(104);self.assertNotIn('addresses',d);self.assertNotIn('email',d);self.assertNotIn('archive_dependencies',d)
 def test_city_zone_rules_future_only(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES('Bengaluru',1,now(),now())")
  self.actor(103);r=self.address();self.assertEqual(r['commercial_rules']['zone_id'],'1');self.assertEqual(r['commercial_rules']['price_type_id'],'2')
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT total_amount FROM sa_snapshot_20261019.sa_orders WHERE id=1001').fetchone()[0],1000)
 def test_dealer_created_customer_inherits_dealer_zone(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET zone_id=1 WHERE id=110');self.actor(110);p=self.save();r=self.address(int(p['id']));self.assertEqual(r['commercial_rules']['zone_id'],'1');self.assertEqual(r['commercial_rules']['basis'],'registered_dealer')
 def test_zone_candidates_add_links_without_duplicates(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES('Bengaluru',1,now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,city,created_at,updated_at) VALUES(210,'Dealer road','Bengaluru',now(),now())")
  self.actor(103);a=self.address();self.address(id=int(a['id']),fields={'is_primary':True},version=a['version']);self.assertEqual(set(self.details(103)['dealer_ids']),{'110','210'})
 def test_relationship_change_fails_while_assignment_is_running(self):
  with connect() as other:
   other.execute('BEGIN');other.execute('SELECT pg_advisory_xact_lock_shared(20261107,2)')
   self.actor(100)
   with assert_app_conflict(self):self.save(11,{'name':'Role changed'},112,'0:0')
   other.execute('ROLLBACK')
 def test_new_assignment_fails_during_people_structure_change(self):
  with connect() as other:
   other.execute('BEGIN');other.execute('SELECT pg_advisory_xact_lock(20261107,2)')
   self.actor(103)
   with assert_app_conflict(self):rpc(self.c,'v1_profile_save',(Jsonb({'name':'Change'}),'0:0',uuid.uuid4()))
   other.execute('ROLLBACK')
 def test_refresh_discards_enrollment_intent(self):
  from domain_sync import after_publication
  self.actor(101);p=self.save();self.c.execute('RESET ROLE');result=after_publication(self.c)
  self.assertEqual(result['discarded_account_requests'],1)
  self.assertEqual(self.c.execute('SELECT state FROM sa_domain.account_requests WHERE id=%s',(p['account_request_id'],)).fetchone()[0],'discarded')
 def test_completed_order_archived_address_remains_available(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET status=1,dispatch_to=1 WHERE customer_id=103');self.actor(103)
  rpc(self.c,'v1_address_archive',(100,103,'0:0',uuid.uuid4()))
  self.assertEqual(rpc(self.c,'v1_order_get',(1001,))['dispatch_destination']['address']['id'],'100')

class ConcurrentPeople(unittest.TestCase):
 def setUp(self):
  with connect() as c:
   seed_catalogue(c);self.initial=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.keys=[];self.email=f'concurrent-{uuid.uuid4()}@example.invalid'
 def tearDown(self):
  with connect() as c,c.transaction():
   ids=[r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_users WHERE email=%s',(self.email,))]
   c.execute('DELETE FROM sa_domain.account_requests WHERE legacy_user_id=ANY(%s)',(ids,))
   for table in ['outbox','audit']:
    c.execute('DELETE FROM sa_domain.'+table+' WHERE command_key=ANY(%s)',(self.keys,))
   c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(self.keys,))
   c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=ANY(%s)",(ids,))
   c.execute('DELETE FROM sa_snapshot_20261019.sa_users WHERE id=ANY(%s)',(ids,))
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',self.initial)
 def pair(self,keys):
  barrier=threading.Barrier(2)
  def command(k):
   with connect() as c:
    try:
     with c.transaction():
      session(c,101);barrier.wait(timeout=3)
      return rpc(c,'v1_person_save',(None,3,Jsonb({'name':'Concurrent','email':self.email}),None,k))
    except psycopg.Error as e:return e.sqlstate
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return list(pool.map(command,keys))
 def test_different_keys_same_email_one_person(self):
  self.keys=[uuid.uuid4(),uuid.uuid4()];results=self.pair(self.keys);self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn('23505',results)
 def test_same_key_same_person(self):
  self.keys=[uuid.uuid4()];results=self.pair(self.keys*2);self.assertIsInstance(results[0],dict);self.assertEqual(results[0],results[1])

if __name__=='__main__':unittest.main(verbosity=2)
