import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from sqlstate_assertions import is_app_conflict
from fixtures import session,rpc,uid
from test_catalogue import seed_catalogue
from test_pricing import custom

class WebContracts(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute("UPDATE sa_sync.environment_state SET cutover=false,active_job=NULL,environment='staging'")
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def me(self,actor=103):session(self.c,actor);return rpc(self.c,'v1_me')['write_state']
 def test_mirror_truthful(self):self.assertEqual(self.me()['mode'],'mirror');self.assertFalse(self.me()['allowed'])
 def test_exact_actor_only(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '5 minutes'",([uid(103)],))
  state=self.me();self.assertTrue(state['allowed']);self.assertEqual(state['mode'],'test');self.assertIsNotNone(state['expires_at'])
  self.c.execute('RESET ROLE');self.assertFalse(self.me(203)['allowed'])
 def test_expiry_fails_closed(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()-interval '1 second'",([uid(103)],))
  self.assertFalse(self.me()['allowed'])
 def test_native_mode(self):
  self.c.execute("UPDATE sa_sync.environment_state SET cutover=true")
  self.assertEqual(self.me()['mode'],'native');self.assertTrue(self.me()['allowed'])
 def test_refresh_supersedes_native(self):
  self.c.execute("UPDATE sa_sync.environment_state SET cutover=true,active_job=%s",(uuid.uuid4(),))
  self.assertEqual(self.me()['mode'],'refresh');self.assertFalse(self.me()['allowed'])
 def test_production_cannot_use_test_allowlist(self):
  self.c.execute("UPDATE sa_sync.environment_state SET environment='production'")
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '5 minutes'",([uid(103)],))
  self.assertFalse(self.me()['allowed'])
 def test_sizes_match_type_and_canonical_exact_name(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_size_types(id,name,created_at,updated_at) VALUES(950001,'Web test type',now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_base_size_types(id,base_product_id,size_type_id,created_at,updated_at) VALUES(950001,1,950001,now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(950001,'Web size',now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_sc_sizes(id,name,size_type_id,created_at,updated_at) VALUES(950001,'Web size',950001,now(),now()),(950002,'Missing canonical',950001,now(),now())")
  session(self.c,103);result=rpc(self.c,'v1_configurator_options',(1,'sizes',950001,None,None,30))
  by_name={x['name']:x for x in result['data']}
  self.assertEqual(by_name['Web size']['id'],'950001');self.assertTrue(by_name['Web size']['available'])
  self.assertIsNone(by_name['Missing canonical']['id']);self.assertFalse(by_name['Missing canonical']['available'])
 def test_unrelated_size_type_denied(self):
  session(self.c,103)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_configurator_options',(1,'sizes',950002))
 def test_configure_only_worker_can_calculate_without_documents(self):
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET features=%s WHERE id=111",(Jsonb([{'key':'3','checked':True,'children':[{'key':'3.3','checked':True}]}]),))
  session(self.c,111);self.assertFalse(rpc(self.c,'v1_me')['capabilities']['documents'])
  result=rpc(self.c,'v1_configuration_quote',(Jsonb({'lines':[custom()]}),))
  self.assertEqual(result['purpose'],'configuration_display_only');self.assertNotIn('quote_id',result)
 def seed_size(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_size_types(id,name,created_at,updated_at) VALUES(950011,'Web resolver type',now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_base_size_types(id,base_product_id,size_type_id,created_at,updated_at) VALUES(950011,1,950011,now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_sc_sizes(id,name,size_type_id,created_at,updated_at) VALUES(950011,'Web resolved name',950011,now(),now())")
 def test_resolver_creates_once_and_replays(self):
  self.seed_size();self.c.execute("UPDATE sa_sync.environment_state SET cutover=true")
  session(self.c,103);key=uuid.uuid4();first=rpc(self.c,'v1_configuration_size_resolve',(1,950011,key));second=rpc(self.c,'v1_configuration_size_resolve',(1,950011,key));self.assertEqual(first,second)
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute("SELECT count(*) FROM sa_snapshot_20261019.sa_sizes WHERE name='Web resolved name'").fetchone()[0],1)
 def test_resolver_finds_existing_exact_name(self):
  self.seed_size();self.c.execute("UPDATE sa_sync.environment_state SET cutover=true")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(950011,'Web resolved name',now(),now())")
  session(self.c,103);self.assertEqual(rpc(self.c,'v1_configuration_size_resolve',(1,950011,uuid.uuid4()))['id'],'950011')
 def test_resolver_mirror_denied(self):
  self.seed_size();session(self.c,103)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_configuration_size_resolve',(1,950011,uuid.uuid4()))
 def test_resolver_unrelated_base_denied(self):
  self.seed_size();self.c.execute("UPDATE sa_sync.environment_state SET cutover=true");session(self.c,103)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_configuration_size_resolve',(999999,950011,uuid.uuid4()))
 def test_resolver_duplicate_name_requires_reconciliation(self):
  self.seed_size();self.c.execute("UPDATE sa_sync.environment_state SET cutover=true")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(950011,'Web resolved name',now(),now()),(950012,'Web resolved name',now(),now())")
  session(self.c,103)
  with self.assertRaises(psycopg.Error) as error:rpc(self.c,'v1_configuration_size_resolve',(1,950011,uuid.uuid4()))
  self.assertTrue(is_app_conflict(error.exception))
 def test_dealer_assigned_brands_only_manager_projection(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_assigned_brands(id,user_id,authorized_brand_id,created_at,updated_at) VALUES(950011,110,1,now(),now()) ON CONFLICT DO NOTHING")
  session(self.c,100);self.assertIn('1',rpc(self.c,'v1_person_get',(110,))['brand_ids'])
  self.c.execute('RESET ROLE');session(self.c,110);self.assertNotIn('brand_ids',rpc(self.c,'v1_person_get',(110,)))
 def test_responsibility_direct_link_is_scoped(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_responsibilities(id,note,responsibility_type,user_id,is_completed,created_by_id,user_role,created_at,updated_at) VALUES(950010,'Own responsibility',1,101,false,100,1,now(),now()),(950011,'Foreign responsibility',1,201,false,100,1,now(),now())")
  session(self.c,101);self.assertEqual(rpc(self.c,'v1_responsibility_get',(950010,))['note'],'Own responsibility')
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_responsibility_get',(950011,))
 def test_archived_responsibility_link_denied(self):
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_responsibilities(id,note,responsibility_type,user_id,is_completed,created_by_id,user_role,created_at,updated_at) VALUES(950010,'Archived',1,101,false,100,1,now(),now())")
  self.c.execute("INSERT INTO sa_domain.archived_entities(kind,entity_id,generation,actor_id,reason) VALUES('responsibility',950010,0,%s,'Archived fixture')",(uid(100),))
  session(self.c,100)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_responsibility_get',(950010,))
 def test_self_closure_bridge_acl_is_not_public_authority(self):
  from release_mirror import security_check
  security_check(self.c)
  self.c.execute('GRANT EXECUTE ON FUNCTION sa_domain.revoke_closed_self_sessions(uuid) TO sa_app')
  with self.assertRaisesRegex(RuntimeError,'Unsafe self-closure'):security_check(self.c)
 def test_quote_cannot_choose_customer_context(self):
  session(self.c,103)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_configuration_quote',(Jsonb({'customer_id':'203','lines':[custom()]}),))
 def test_no_configure_capability_denied(self):
  session(self.c,104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_configuration_quote',(Jsonb({'lines':[custom()]}),))
 def test_new_contract_not_anonymous_or_staff(self):
  for role in ['anon','authenticated']:
   self.assertFalse(self.c.execute("SELECT has_function_privilege(%s,'canto_api.v1_configuration_quote(jsonb)','EXECUTE')",(role,)).fetchone()[0])

if __name__=='__main__':unittest.main(verbosity=2)
