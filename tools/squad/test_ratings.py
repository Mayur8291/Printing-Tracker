"""RATE-01..03: real work targets, private feedback and immutable moderation."""
import unittest,uuid,json,concurrent.futures
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
class Ratings(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103');self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_by_id=102,assigned_worker_id=NULL WHERE id=1005')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,id=103):self.c.execute('RESET ROLE');session(self.c,id)
 def save(self,id=None,kind='Order',entity=1005,to=None,score='4.5',version=None,key=None,fields=None):return rpc(self.c,'v1_rating_save',(id,kind,entity,to,Jsonb(fields or {'score':score,'positive_comments':'Helpful , prompt','negative_comments':None}),version,key or uuid.uuid4()))
 def page(self,kind='Order',entity=1005,from_id=None,to_id=None,archived=False,cursor=None,limit=30):return rpc(self.c,'v1_ratings_list',(kind,entity,from_id,to_id,archived,cursor,limit))
 def archive(self,r,key=None):return rpc(self.c,'v1_rating_archive',(int(r['id']),'Controlled moderation',r['version'],key or uuid.uuid4()))
 def seed_feedback(self,from_id=103,to_id=101,score='4',kind='Order',entity=1005,from_role='Customer',to_role='SalesCoordinator'):
  self.c.execute('RESET ROLE');return self.c.execute("INSERT INTO sa_snapshot_20261019.sa_ratings(rating,from_role,to_role,from_id,to_id,rating_on_type,rating_on_id,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,now(),now()) RETURNING id",(score,from_role,to_role,from_id,to_id,kind,entity)).fetchone()[0]
 def test_customer_target_is_current_coordinator(self):
  self.actor();r=self.save();self.assertEqual(r['to_id'],'101');self.assertEqual(r['from_id'],'103');self.assertEqual(r['score'],'4.5');self.assertEqual(r['summary']['average'],'4.50')
 def test_customer_cannot_choose_another_coordinator(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(to=201)
 def test_sc_target_assigned_pc(self):
  self.actor(101);r=self.save();self.assertEqual(r['to_id'],'102');self.assertEqual(r['to_role'],'ProductionCoordinator')
 def test_pc_target_assigned_factory_manager(self):
  self.actor(102);r=self.save();self.assertEqual(r['to_id'],'104')
 def test_fm_target_actual_assigned_cutter(self):
  self.actor(104);r=self.save(to=109);self.assertEqual(r['to_id'],'109');self.assertEqual(r['from_role'],'FactoryManager')
 def test_fm_item_target_actual_assigned_cutter(self):
  self.actor(104);r=self.save(kind='Item',to=109);self.assertEqual(r['entity_kind'],'Item')
 def test_fm_other_factory_cutter_rejected(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(to=209)
 def test_fm_cannot_rate_tailor_without_approved_target_rule(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(to=105)
 def test_shared_factory_not_same_manager(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET factory_id=1 WHERE id=204');self.actor(204)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(to=109)
 def test_customer_cannot_rate_foreign_entity(self):
  self.actor()
  with self.assertRaises((psycopg.errors.InsufficientPrivilege,psycopg.errors.NoDataFound)):self.save(entity=2005)
 def test_pending_order_denied(self):
  self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save(entity=1001)
 def test_completed_cancelled_order_denied(self):
  self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='CANCELLED' WHERE id=1005");self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save()
 def test_sc_ready_made_order_denied(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=0 WHERE id=1005');self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_sc_mixed_order_denied(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=2 WHERE id=1005');self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_dealer_linked_customer_cannot_rate(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_disabled_target_denied(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=101');self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_admin_cannot_impersonate_author(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_spoofed_author_field_denied(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(fields={'score':'4','from_id':'203'})
 def test_dealer_cannot_submit(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_jobworker_cannot_submit(self):
  self.actor(111)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_duplicate_actor_target_entity_denied(self):
  self.actor();self.save()
  with self.assertRaises(psycopg.errors.UniqueViolation):self.save()
 def test_exact_retry_does_not_duplicate(self):
  self.actor();k=uuid.uuid4();r=self.save(key=k);self.assertEqual(r,self.save(key=k));self.assertEqual(self.page()['summary']['count'],1)
 def test_same_key_different_score_denied(self):
  self.actor();k=uuid.uuid4();self.save(key=k)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(key=k,score='2')
 def test_edit_own_retains_before_score_for_notifications(self):
  self.actor();r=self.save(score='2');r=self.save(id=int(r['id']),version=r['version'],score='5');self.assertEqual(r['summary']['average'],'5.00');self.c.execute('RESET ROLE');change=self.c.execute("SELECT changes FROM sa_domain.audit WHERE operation='rating.saved' ORDER BY id DESC LIMIT 1").fetchone()[0];self.assertEqual(change['before_score'],'2');self.assertTrue(change['score_changed'])
 def test_comment_only_change_not_score_notification(self):
  self.actor();r=self.save(score='4');self.save(id=int(r['id']),version=r['version'],fields={'score':'4','positive_comments':'Edited'});self.c.execute('RESET ROLE');self.assertFalse(self.c.execute("SELECT changes->'score_changed' FROM sa_domain.audit ORDER BY id DESC LIMIT 1").fetchone()[0])
 def test_cannot_edit_someone_elses_rating(self):
  self.actor();r=self.save();self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(id=int(r['id']),version=r['version'])
 def test_stale_edit_denied(self):
  self.actor();r=self.save()
  with self.assertRaises(psycopg.errors.SerializationFailure):self.save(id=int(r['id']),version='0:0')
 def test_relationship_change_does_not_redirect_old_rating(self):
  self.actor();r=self.save();self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET created_by_id=201 WHERE id=103');self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(id=int(r['id']),version=r['version'])
 def test_customer_does_not_see_private_staff_feedback(self):
  self.seed_feedback(from_id=102,to_id=104,from_role='ProductionCoordinator',to_role='FactoryManager');self.actor();self.save();r=self.page();self.assertEqual(r['summary']['count'],1);self.assertTrue(all(x['from_id']=='103' for x in r['data']))
 def test_admin_sees_feedback_parties_but_no_contact_secrets(self):
  self.seed_feedback();self.seed_feedback(from_id=102,to_id=104,from_role='ProductionCoordinator',to_role='FactoryManager');self.actor(100);r=self.page();self.assertEqual(r['summary']['count'],2);self.assertNotIn('email',json.dumps(r));self.assertNotIn('encrypted_password',json.dumps(r))
 def test_recipient_sees_own_feedback(self):
  self.seed_feedback();self.actor(101);self.assertEqual(self.page()['summary']['count'],1)
 def test_unrelated_visible_order_does_not_grant_feedback(self):
  self.seed_feedback();self.actor(104);self.assertEqual(self.page()['data'],[])
 def test_entity_visibility_required_even_if_old_recipient(self):
  self.seed_feedback(to_id=201);self.actor(201)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.page()
 def test_archive_preserves_source_row_and_recalculates(self):
  self.actor();r=self.save();self.actor(100);a=self.archive(r);self.assertEqual(a['summary']['count'],0);self.assertIsNone(a['summary']['average']);self.assertEqual(self.page()['data'],[]);self.assertTrue(self.page(archived=True)['data'][0]['archived']);self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_ratings WHERE id=%s',(int(r['id']),)).fetchone()[0],1)
 def test_archive_exact_retry(self):
  self.actor();r=self.save();self.actor(100);k=uuid.uuid4();a=self.archive(r,k);self.assertEqual(a,self.archive(r,k))
 def test_author_cannot_unmoderate_by_edit(self):
  self.actor();r=self.save();self.actor(100);a=self.archive(r);self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save(id=int(r['id']),version=a['version'])
 def test_author_cannot_recreate_moderated_feedback(self):
  self.actor();r=self.save();self.actor(100);self.archive(r);self.actor()
  with self.assertRaises(psycopg.errors.UniqueViolation):self.save()
 def test_nonadmin_cannot_archive(self):
  self.actor();r=self.save()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.archive(r)
 def test_nonadmin_cannot_read_moderated_notes(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.page(archived=True)
 def test_pagination_count_and_scope(self):
  self.seed_feedback();self.seed_feedback(from_id=102,to_id=104,from_role='ProductionCoordinator',to_role='FactoryManager');self.actor(100);p=self.page(limit=1);q=self.page(limit=1,cursor=p['next_cursor']);self.assertEqual(p['summary'],q['summary']);self.assertNotEqual(p['data'][0]['id'],q['data'][0]['id'])
 def test_cursor_rejects_changed_target_filter(self):
  self.seed_feedback();self.seed_feedback(from_id=102,to_id=104);self.actor(100);p=self.page(limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.page(to_id=101,cursor=p['next_cursor'])
 def test_invalid_source_score_reported_and_excluded(self):
  self.seed_feedback(score='9');self.seed_feedback(from_id=102,to_id=104,score='4');self.actor(100);r=self.page()['summary'];self.assertEqual(r['average'],'4.00');self.assertEqual(r['invalid_source_count'],1)
 def test_invalid_score_rejected(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(score='5.1')
 def test_score_not_arbitrary_numeric_expression(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(score='NaN')
 def test_overlong_comment_rejected(self):
  self.actor()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(fields={'score':'4','positive_comments':'x'*2001})
 def test_moderation_bound_to_refresh_generation(self):
  self.actor();r=self.save();self.actor(100);self.archive(r);self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1');self.actor();self.assertEqual(self.page()['summary']['count'],1)
 def test_mirror_write_denied(self):
  self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');self.actor()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save()

class ConcurrentRatings(unittest.TestCase):
 def setUp(self):
  with connect() as c:
   seed_catalogue(c);self.initial=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();self.person=c.execute('SELECT is_direct_deal FROM sa_snapshot_20261019.sa_users WHERE id=103').fetchone()[0]
   self.prior={r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_ratings')};c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103')
  self.keys=[]
 def tearDown(self):
  with connect() as c,c.transaction():
   ids=[r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_ratings') if r[0] not in self.prior]
   for table in ['outbox','audit']:c.execute('DELETE FROM sa_domain.'+table+' WHERE command_key=ANY(%s)',(self.keys,))
   c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(self.keys,));c.execute('DELETE FROM sa_domain.rating_moderation WHERE rating_id=ANY(%s)',(ids,));c.execute('DELETE FROM sa_snapshot_20261019.sa_ratings WHERE id=ANY(%s)',(ids,));c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='rating' AND entity_id=ANY(%s)",(ids,))
   c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=%s WHERE id=103',(self.person,));c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',self.initial)
 def pair(self,keys,rating=None,moderate=False):
  import threading
  barrier=threading.Barrier(2)
  def command(pair):
   idx,k=pair
   with connect() as c:
    try:
     with c.transaction():
      session(c,100 if moderate and idx==1 else 103);barrier.wait(timeout=3)
      if moderate and idx==1:return rpc(c,'v1_rating_archive',(int(rating['id']),'Concurrent moderation',rating['version'],k))
      return rpc(c,'v1_rating_save',(int(rating['id']) if rating else None,'Order',1005,None,Jsonb({'score':'4'}),rating['version'] if rating else None,k))
    except psycopg.Error as e:return e.sqlstate
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return list(pool.map(command,enumerate(keys)))
 def test_racing_creates_leave_one_rating(self):
  self.keys=[uuid.uuid4(),uuid.uuid4()];r=self.pair(self.keys);self.assertEqual(sum(isinstance(x,dict) for x in r),1);self.assertIn('23505',r)
 def test_racing_same_key_same_result(self):
  self.keys=[uuid.uuid4()];r=self.pair(self.keys*2);self.assertIsInstance(r[0],dict);self.assertEqual(r[0],r[1])
 def test_racing_edit_and_moderation_version_serializes(self):
  self.keys=[uuid.uuid4(),uuid.uuid4(),uuid.uuid4()]
  with connect() as c,c.transaction():session(c,103);rating=rpc(c,'v1_rating_save',(None,'Order',1005,None,Jsonb({'score':'3'}),None,self.keys[0]))
  r=self.pair(self.keys[1:],rating,True);self.assertEqual(sum(isinstance(x,dict) for x in r),1);self.assertIn('40001',r)
