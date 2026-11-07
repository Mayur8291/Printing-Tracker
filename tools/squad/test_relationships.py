"""CRM-01/03/04: approval, commercial scope and atomic attribution changes."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue

class Relationships(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET created_by_id=103 WHERE customer_id=103')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def review(self,fields,id=103,version='0:0',key=None):return rpc(self.c,'v1_customer_review',(id,Jsonb(fields),'Controlled review',version,key or uuid.uuid4()))
 def links(self,id=103,coordinator=101,dealers=None,direct=True,version='0:0',key=None):return rpc(self.c,'v1_customer_links_save',(id,coordinator,dealers or [],direct,'Controlled links',version,key or uuid.uuid4()))
 def reassign(self,customers=None,to=201,key=None):return rpc(self.c,'v1_customers_reassign',(Jsonb(customers or [{'id':'103','version':'0:0'}]),to,'Controlled reassignment',key or uuid.uuid4()))
 def request(self,coordinator=201,key=None):return rpc(self.c,'v1_coordinator_change_request',(coordinator,'Need a new coordinator',key or uuid.uuid4()))
 def decide(self,r,decision='approved',cv='0:0',key=None):return rpc(self.c,'v1_coordinator_change_decide',(int(r['id']),decision,'Reviewed request',r['version'],cv,key or uuid.uuid4()))
 def rules(self,fields,id=110,version='0:0'):return rpc(self.c,'v1_dealer_rules_save',(id,Jsonb(fields),'Controlled dealer rules',version,uuid.uuid4()))
 def commercial(self,fields,id=103,version='0:0',key=None):return rpc(self.c,'v1_customer_commercial_rules_save',(id,Jsonb(fields),'Controlled commercial rules',version,key or uuid.uuid4()))
 def test_approval_and_onboarding_independent_no_password_change(self):
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET approved=false,onboarded=false,encrypted_password='synthetic-hash' WHERE id=103");self.actor(101)
  p=self.review({'onboarded':True});self.assertFalse(p['approved']);self.assertTrue(p['onboarded'])
  p=self.review({'approved':True},version=p['version']);self.assertTrue(p['approved']);self.c.execute('RESET ROLE')
  self.assertEqual(self.c.execute('SELECT encrypted_password FROM sa_snapshot_20261019.sa_users WHERE id=103').fetchone()[0],'synthetic-hash')
 def test_review_exact_retry(self):
  self.actor(101);k=uuid.uuid4();r=self.review({'approved':True},key=k);self.assertEqual(r,self.review({'approved':True},key=k))
 def test_rejection_immediately_denies_existing_customer_session(self):
  self.actor(101);self.review({'approved':False});self.actor(103)
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):rpc(self.c,'v1_me')
 def test_dealer_cannot_manually_review(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.review({'approved':True})
 def test_sc_cannot_review_foreign_customer(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.review({'approved':True},203)
 def test_review_rejects_null_and_unknown_fields(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.review({'approved':None})
 def test_review_cannot_promote_role(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.review({'role':0})
 def test_bulk_reassign_pending_only_preserves_creator(self):
  self.actor(100);r=self.reassign();self.assertEqual(r['updated_pending_orders'],4);self.c.execute('RESET ROLE')
  rows=self.c.execute('SELECT id,customer_sc_id,created_by_id FROM sa_snapshot_20261019.sa_orders WHERE customer_id=103 ORDER BY id').fetchall()
  self.assertTrue(all(sc==(101 if id in [1005,1006] else 201) and creator==103 for id,sc,creator in rows))
  self.actor(201);self.assertEqual(rpc(self.c,'v1_person_get',(103,))['coordinator_id'],'201')
  self.actor(101);self.assertEqual({x['id'] for x in rpc(self.c,'v1_orders_list')['data']},{'1005','1006'})
 def test_bulk_reassign_atomic_on_stale_second_customer(self):
  self.actor(100)
  with self.c.transaction():
   try:
    with self.c.transaction():self.reassign([{'id':'103','version':'0:0'},{'id':'203','version':'0:99'}])
   except psycopg.errors.SerializationFailure:pass
   else:self.fail('Expected stale second member')
   self.assertEqual(rpc(self.c,'v1_person_get',(103,))['coordinator_id'],'101')
 def test_bulk_reassign_rejects_duplicate_targets(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reassign([{'id':'103','version':'0:0'}]*2)
 def test_bulk_reassign_exact_retry(self):
  self.actor(100);k=uuid.uuid4();r=self.reassign(key=k);self.assertEqual(r,self.reassign(key=k))
 def test_sc_cannot_bulk_transfer(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.reassign()
 def test_non_coordinator_target_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reassign(to=110)
 def test_disabled_coordinator_target_denied(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=201');self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reassign()
 def test_request_then_admin_decision_updates_pending(self):
  self.actor(103);r=self.request();rows=rpc(self.c,'v1_coordinator_requests')['data'];self.assertEqual(rows[0]['id'],r['id']);self.assertEqual(rows[0]['customer_version'],'0:0')
  self.actor(100);k=uuid.uuid4();d=self.decide(r,key=k);self.assertEqual(d['state'],'approved');self.assertEqual(d['assignment']['updated_pending_orders'],4);self.assertEqual(d,self.decide(r,key=k))
  self.actor(103);self.assertEqual(rpc(self.c,'v1_coordinator_requests',('approved',))['data'][0]['state'],'approved')
 def test_non_direct_customer_cannot_request(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.request()
 def test_customer_cannot_request_same_coordinator(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.request(101)
 def test_duplicate_pending_request_denied(self):
  self.actor(103);self.request()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.request()
 def test_request_exact_retry(self):
  self.actor(103);k=uuid.uuid4();r=self.request(key=k);self.assertEqual(r,self.request(key=k))
 def test_customer_cannot_approve_request(self):
  self.actor(103);r=self.request()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.decide(r)
 def test_other_customer_does_not_see_request(self):
  self.actor(103);self.request();self.actor(203);self.assertEqual(rpc(self.c,'v1_coordinator_requests')['data'],[])
 def test_decision_requires_current_customer_version(self):
  self.actor(103);r=self.request();rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',uuid.uuid4()));self.actor(100)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.decide(r)
 def test_rejection_keeps_current_coordinator(self):
  self.actor(103);r=self.request();self.actor(100);self.decide(r,'rejected');self.assertEqual(rpc(self.c,'v1_person_get',(103,))['coordinator_id'],'101')
 def test_decided_request_cannot_apply_again_with_new_key(self):
  self.actor(103);r=self.request();self.actor(100);d=self.decide(r)
  r['version']=d['version']
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.decide(r,cv=d['assignment']['people'][0]['version'])
 def test_request_cursor_bound_to_state(self):
  self.actor(103);r=self.request();self.actor(100);self.decide(r,'rejected');self.actor(103);self.request();self.actor(100)
  page=rpc(self.c,'v1_coordinator_requests',('all',None,None,1));self.assertIsNotNone(page['next_cursor'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_coordinator_requests',('pending',None,page['next_cursor'],1))
 def test_direct_conversion_unstarted_pending_only(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=NULL,customer_dealer_id=110 WHERE customer_id=103');self.actor(101)
  r=self.links();self.assertEqual(r['rerouted_pending_orders'],4);self.assertEqual(r['integration'],'queued');self.c.execute('RESET ROLE')
  rows=self.c.execute('SELECT id,customer_dealer_id,created_by_id FROM sa_snapshot_20261019.sa_orders WHERE customer_id=103').fetchall();self.assertTrue(all(d==(110 if id in [1005,1006] else None) and creator==103 for id,d,creator in rows))
  self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.outbox WHERE event_type='order.routing_changed'").fetchone()[0],4)
 def test_direct_conversion_blocks_production_assignment(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.links()
 def test_direct_conversion_blocks_partial_dispatch(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=NULL WHERE customer_id=103');self.c.execute('UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=1 WHERE item_id=1004');self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.links()
 def test_direct_conversion_blocks_procurement(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=NULL WHERE customer_id=103');self.c.execute('INSERT INTO sa_snapshot_20261019.sa_back_order_links(order_id,back_order_id,created_at,updated_at) VALUES(1004,2004,now(),now())');self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.links()
 def test_cannot_unlink_dealer_with_pending_fulfillment(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.links(dealers=[],direct=False)
 def test_explicit_dealer_list_not_expanded_by_zone(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_dealer_id=NULL WHERE customer_id=103');self.c.execute("INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES('Bengaluru',1,now(),now())")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET city='Bengaluru',is_primary=true WHERE user_id=103")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,city,created_at,updated_at) VALUES(210,'Other','Bengaluru',now(),now())")
  self.actor(101);r=self.links(dealers=[110],direct=False);self.assertEqual(r['dealer_ids'],['110']);self.assertEqual(rpc(self.c,'v1_person_get',(103,))['dealer_ids'],['110'])
 def test_sc_cannot_move_customer_to_other_sc(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.links(coordinator=201)
 def test_sc_cannot_link_unrelated_dealer_outside_zone(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.links(dealers=[210],direct=False)
 def test_dealer_can_toggle_own_autoapproval(self):
  self.actor(110);r=self.rules({'auto_approve_customers':True});self.assertEqual(r['applies_to'],'future_onboarding');self.assertTrue(rpc(self.c,'v1_person_get',(110,))['auto_approve_customers'])
 def test_dealer_cannot_override_zone(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.rules({'zone_id':'1'})
 def test_dealer_cannot_change_other_dealer_rules(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.rules({'auto_approve_customers':True},210)
 def test_admin_zone_override(self):
  self.actor(100);self.rules({'zone_id':'1'});self.assertEqual(rpc(self.c,'v1_person_get',(110,))['zone_id'],'1')
 def test_dealer_cannot_grant_own_brands(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.commercial({'brand_ids':['2']},110)
 def test_sc_can_replace_owned_dealer_brands(self):
  self.actor(101);self.commercial({'brand_ids':['2']},110);self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT authorized_brand_id FROM sa_snapshot_20261019.sa_assigned_brands WHERE user_id=110').fetchall(),[(2,)])
 def test_dealer_customer_percentage_does_not_change_stock(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.actor(110);self.commercial({'stock_visibility_percentage':25});self.assertEqual(rpc(self.c,'v1_person_get',(103,))['stock_visibility_percentage'],25)
 def test_foreign_customer_percentage_denied(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.commercial({'stock_visibility_percentage':25},203)
 def test_invalid_percentage_rejected(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.commercial({'stock_visibility_percentage':101})
 def test_customer_cannot_choose_own_price_class(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.commercial({'price_type_id':'3'})
 def test_price_assignment_preserves_existing_order(self):
  self.actor(101);self.commercial({'price_type_id':'3'});self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT total_amount FROM sa_snapshot_20261019.sa_orders WHERE id=1001').fetchone()[0],1000)
 def test_commercial_exact_retry(self):
  self.actor(101);k=uuid.uuid4();r=self.commercial({'price_type_id':'3'},key=k);self.assertEqual(r,self.commercial({'price_type_id':'3'},key=k))
 def test_customer_coordinator_selector_has_no_private_contacts(self):
  self.actor(103);r=rpc(self.c,'v1_relationship_options',('coordinators',));self.assertEqual({x['id'] for x in r['data']},{'101','201'});self.assertTrue(all(set(x)=={'id','name','parent_id'} for x in r['data']))
 def test_customer_cannot_browse_price_admin_selector(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_relationship_options',('price_types',))
 def test_non_direct_customer_cannot_browse_coordinators(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_relationship_options',('coordinators',))
 def test_people_approval_null_false_filter_before_page(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET approved=NULL WHERE id=103');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET approved=false WHERE id=203');self.actor(100)
  page=rpc(self.c,'v1_people_list',(3,'',None,1,Jsonb({'approved':[False,None]})));self.assertEqual(page['data'][0]['id'],'203')
  page2=rpc(self.c,'v1_people_list',(3,'',page['next_cursor'],1,Jsonb({'approved':[False,None]})));self.assertEqual(page2['data'][0]['id'],'103')
 def test_people_filter_cannot_expand_sc_scope(self):
  self.actor(101);self.assertEqual(rpc(self.c,'v1_people_list',(3,'',None,30,Jsonb({'coordinator_id':'201'})))['data'],[])
 def test_people_factory_filter_uses_inherited_membership(self):
  self.actor(102);rows=rpc(self.c,'v1_people_list',(None,'',None,30,Jsonb({'factory_id':'2'})))['data'];self.assertEqual({x['id'] for x in rows},{'204','205','206','207','208','209'})
 def test_people_manager_filter_includes_legacy_subtailor(self):
  self.actor(104);rows=rpc(self.c,'v1_people_list',(None,'',None,30,Jsonb({'manager_id':'104'})))['data'];self.assertEqual({x['id'] for x in rows},{'105','106','107','108','109'})
 def test_people_unknown_filter_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_people_list',(None,'',None,30,Jsonb({'sql':'true'})))
 def test_people_invalid_approval_filter_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_people_list',(None,'',None,30,Jsonb({'approved':['false']})))
 def test_people_email_search_only_contact_authority(self):
  self.actor(100);self.assertEqual(rpc(self.c,'v1_people_list',(None,'persona-104@',None,30))['data'][0]['id'],'104')
  self.actor(108);self.assertEqual(rpc(self.c,'v1_people_list',(None,'persona-104@',None,30))['data'],[])
 def test_people_cursor_rejects_changed_approval_filter(self):
  self.actor(100);page=rpc(self.c,'v1_people_list',(3,'',None,1,Jsonb({'approved':[True]})))
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_people_list',(3,'',page['next_cursor'],1,Jsonb({'approved':[False]})))
 def test_source_dispatch_history_blocks_conversion_even_with_zero_counters(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=NULL WHERE customer_id=103')
  self.c.execute('INSERT INTO sa_snapshot_20261019.sa_job_sheet_dispatched_dates(item_id,dispatched_at,created_at,updated_at) VALUES(1004,now(),now(),now())');self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.links()
 def test_stale_dealer_link_does_not_expose_direct_customer(self):
  self.actor(110);self.assertNotIn('103',{x['id'] for x in rpc(self.c,'v1_people_list')['data']})
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_person_get',(103,))
 def test_sc_must_escalate_inconsistent_pending_order_attribution(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_sc_id=201 WHERE id=1004');self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.links(dealers=[110],direct=False)


class ConcurrentCoordinatorRequests(unittest.TestCase):
 def setUp(self):
  with connect() as c:
   seed_catalogue(c);self.initial=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
   self.person=c.execute('SELECT is_direct_deal,created_by_id FROM sa_snapshot_20261019.sa_users WHERE id=103').fetchone()
   self.orders=c.execute('SELECT id,customer_sc_id FROM sa_snapshot_20261019.sa_orders WHERE customer_id=103').fetchall()
   self.prior_requests={r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_customer_requests WHERE user_id=103')}
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103')
  self.keys=[]
 def tearDown(self):
  with connect() as c,c.transaction():
   ids=[r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_customer_requests WHERE user_id=103') if r[0] not in self.prior_requests]
   for table in ['outbox','audit']:c.execute('DELETE FROM sa_domain.'+table+' WHERE command_key=ANY(%s)',(self.keys,))
   c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(self.keys,));c.execute('DELETE FROM sa_domain.coordinator_request_notes WHERE request_id=ANY(%s)',(ids,));c.execute('DELETE FROM sa_snapshot_20261019.sa_customer_requests WHERE id=ANY(%s)',(ids,))
   c.execute("DELETE FROM sa_domain.entity_versions WHERE(kind='coordinator_request' AND entity_id=ANY(%s)) OR(kind='person' AND entity_id=103) OR(kind='order' AND entity_id=ANY(%s))",(ids,[o[0] for o in self.orders]))
   for id,sc in self.orders:c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_sc_id=%s WHERE id=%s',(sc,id))
   c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=%s,created_by_id=%s WHERE id=103',self.person)
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',self.initial)
 def pair(self,keys,request=None):
  import concurrent.futures,threading
  barrier=threading.Barrier(2)
  def command(k):
   with connect() as c:
    try:
     with c.transaction():
      session(c,103 if request is None else 100);barrier.wait(timeout=3)
      if request is None:return rpc(c,'v1_coordinator_change_request',(201,'Concurrent request',k))
      return rpc(c,'v1_coordinator_change_decide',(int(request['id']),'approved','Concurrent decision',request['version'],'0:0',k))
    except psycopg.Error as e:return e.sqlstate
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return list(pool.map(command,keys))
 def test_concurrent_requests_leave_one_pending(self):
  self.keys=[uuid.uuid4(),uuid.uuid4()];results=self.pair(self.keys);self.assertEqual(sum(isinstance(x,dict) for x in results),1);self.assertIn('55000',results)
 def test_concurrent_same_key_returns_one_request(self):
  self.keys=[uuid.uuid4()];results=self.pair(self.keys*2);self.assertIsInstance(results[0],dict);self.assertEqual(results[0],results[1])
 def test_concurrent_decisions_apply_once_with_bounded_conflict_retry(self):
  self.keys=[uuid.uuid4(),uuid.uuid4(),uuid.uuid4()]
  with connect() as c,c.transaction():session(c,103);r=rpc(c,'v1_coordinator_change_request',(201,'Request for racing decisions',self.keys[0]))
  results=self.pair(self.keys[1:],r)
  if not any(isinstance(x,dict) for x in results):
   self.assertEqual(results,['40001','40001'])
   with connect() as c,c.transaction():session(c,100);results[0]=rpc(c,'v1_coordinator_change_decide',(int(r['id']),'approved','Concurrent decision',r['version'],'0:0',self.keys[1]))
  self.assertEqual(sum(isinstance(x,dict) for x in results),1)
  with connect() as c:self.assertEqual(c.execute("SELECT count(*) FROM sa_domain.audit WHERE operation='customer.coordinator_decided' AND entity_id=%s",(int(r['id']),)).fetchone()[0],1)

if __name__=='__main__':unittest.main(verbosity=2)
