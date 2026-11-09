"""Person-context reads remain intersections, managed photos use existing owner rules."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc
from test_media_uploads import Uploads

class PersonOrderContext(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):self.c=connect();self.c.execute('BEGIN');session(self.c,103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def page(self,filters,cursor=None):return rpc(self.c,'v1_orders_list',(Jsonb(filters),cursor,2))
 def test_context_filter_intersects_customer_scope(self):
  self.assertEqual([r['id'] for r in self.page({'manager_id':'104'})['data']],['1006','1005'])
  self.assertEqual(self.page({'manager_id':'204'})['data'],[])
  self.assertEqual(self.page({'coordinator_id':'201'})['data'],[])
  self.assertEqual(self.page({'coordinator_id':'101','customer_id':'203'})['data'],[])
 def test_admin_manager_and_coordinator_views_use_exact_relationships(self):
  self.actor(100)
  for filters in [{'manager_id':'104'},{'coordinator_id':'101'}]:
   self.assertEqual([r['id'] for r in self.page(filters)['data']],['1006','1005'])
  self.assertEqual(self.page({'manager_id':'204','coordinator_id':'101'})['data'],[])
 def test_context_cursor_cannot_switch_selected_person(self):
  cursor=self.page({'manager_id':'104'})['next_cursor']
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.page({'manager_id':'204'},cursor)
 def test_invalid_context_identifiers_refused(self):
  for key in ['manager_id','coordinator_id']:
   for value in [0,-1,'nonsense',[],None]:
    with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page({key:value})
 def test_person_edit_authority_is_exact_not_role_based(self):
  self.actor(101);own=rpc(self.c,'v1_person_get',(103,));self.assertTrue(own['can_manage']);self.assertTrue(own['can_edit_photo'])
  self.actor(103);own=rpc(self.c,'v1_person_get',(103,));self.assertFalse(own['can_manage']);self.assertTrue(own['can_edit_photo'])
  self.actor(102);manager=rpc(self.c,'v1_person_get',(104,));self.assertTrue(manager['can_manage']);self.assertTrue(manager['can_edit_photo'])
  tailor=rpc(self.c,'v1_person_get',(105,));self.assertTrue(tailor['can_manage']);self.assertTrue(tailor['can_edit_photo'])
 def test_customer_contact_projection_is_only_existing_active_relationship(self):
  self.actor(103);linked=rpc(self.c,'v1_person_get',(103,));self.assertEqual(linked['linked_dealers'][0]['id'],'110');self.assertEqual(set(linked['linked_dealers'][0]),{'id','name','phone'});self.assertEqual(linked['coordinator_contact']['id'],'101')
  self.c.execute('RESET ROLE');self.c.execute('DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=103');session(self.c,103)
  direct=rpc(self.c,'v1_person_get',(103,));self.assertEqual(direct['linked_dealers'],[]);self.assertEqual(direct['coordinator_contact']['id'],'101')
 def test_dealer_contact_order_is_stable_and_inactive_contacts_are_excluded(self):
  self.c.execute('RESET ROLE');self.c.execute('DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=103');self.c.execute("INSERT INTO sa_snapshot_20261019.sa_user_dealers(id,user_id,dealer_id,created_at,updated_at) VALUES(90001,103,210,now(),now()),(90002,103,110,now(),now())");session(self.c,103)
  linked=rpc(self.c,'v1_person_get',(103,))['linked_dealers'];self.assertEqual([row['id']for row in linked],['210','110'])
  self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=210');session(self.c,103)
  self.assertEqual([row['id']for row in rpc(self.c,'v1_person_get',(103,))['linked_dealers']],['110'])
 def test_foreign_customer_contact_unavailable_and_staff_contact_not_projected(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():rpc(self.c,'v1_person_get',(203,))
  self.actor(100);staff=rpc(self.c,'v1_person_get',(112,));self.assertEqual(staff.get('linked_dealers',[]),[]);self.assertIsNone(staff.get('coordinator_contact'))

class ManagedPhotos(unittest.TestCase):
 setUpClass=classmethod(Uploads.setUpClass.__func__)
 setUp=Uploads.setUp
 tearDown=Uploads.tearDown
 media=Uploads.media
 reserve=Uploads.reserve
 verify=Uploads.verify
 attach=Uploads.attach
 actor=Uploads.actor
 def target_for(self,id):
  self.target={'resource':'users','record_id':str(id),'field':'profile_image'};self.version=self.media(self.target)['version']
 def test_sc_managed_customer_photo_uses_verified_media_pipeline(self):
  self.actor(101);self.target_for(103);u=self.reserve();self.verify(u);r=self.attach(u);self.assertEqual(r['record_id'],'103');self.assertEqual(self.media(self.target)['status'],'ready')
 def test_pc_managed_factory_manager_photo(self):
  self.actor(102);self.target_for(104);u=self.reserve();self.verify(u);self.assertEqual(self.attach(u)['record_id'],'104')
 def test_foreign_and_unrelated_people_remain_denied(self):
  for actor,target in [(101,203),(101,104),(102,103),(104,205),(100,200),(103,203)]:
   with self.subTest(actor=actor,target=target),self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():
    self.actor(actor);self.target_for(target);self.reserve()
 def test_source_backed_managed_staff_and_workforce_photos(self):
  for actor,target in [(100,112),(102,105),(104,106),(101,110)]:
   with self.subTest(actor=actor,target=target):
    self.actor(actor);self.target_for(target);u=self.reserve();self.verify(u);self.assertEqual(self.attach(u)['record_id'],str(target))
 def test_relationship_reassignment_invalidates_reserved_photo(self):
  self.actor(101);self.target_for(103);u=self.reserve();self.verify(u)
  self.f.raw('UPDATE sa_snapshot_20261019.sa_users SET created_by_id=201 WHERE id=103')
  with self.assertRaises(psycopg.errors.NoDataFound):self.attach(u)
 def test_customer_deletion_invalidates_reserved_photo(self):
  self.actor(101);self.target_for(103);u=self.reserve();self.verify(u)
  self.f.raw('UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() WHERE id=103')
  with self.assertRaises(psycopg.errors.NoDataFound):self.attach(u)
