"""Exercise prepared hosted-fixture creation/cleanup in isolated local Postgres."""
import copy
import json
import unittest

import psycopg
from local_db import connect
from test_catalogue import seed_catalogue
import test_hosted_personas as harness


class PersonaHarness(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute('CREATE SCHEMA IF NOT EXISTS extensions;CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions')
  # Only the isolated synthetic Auth catalog lacks these standard GoTrue fields.
  self.c.execute("""ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid,ADD COLUMN IF NOT EXISTS aud text,ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,ADD COLUMN IF NOT EXISTS confirmation_token text,ADD COLUMN IF NOT EXISTS recovery_token text,ADD COLUMN IF NOT EXISTS email_change_token_new text,ADD COLUMN IF NOT EXISTS email_change text,ADD COLUMN IF NOT EXISTS is_super_admin boolean;
   CREATE TABLE IF NOT EXISTS auth.identities(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,provider_id text,user_id uuid REFERENCES auth.users,identity_data jsonb,provider text,created_at timestamptz,updated_at timestamptz,UNIQUE(provider_id,provider));""")
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def test_complete_owned_graph_and_bcrypt_identity_cleanup(self):
  before=self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_users').fetchone()[0];state=harness.plan(self.c);credentials=harness.create(self.c,state)
  self.assertEqual(len(credentials),11)
  for actor in credentials:
   self.assertTrue(self.c.execute('SELECT encrypted_password=extensions.crypt(%s,encrypted_password) FROM auth.users WHERE id=%s',(actor['password'],actor['auth_id'])).fetchone()[0])
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_identity.sa_auth_identities WHERE legacy_user_id=ANY(%s::bigint[])',([state['base']+5,state['base']+6],)).fetchone()[0],0)
  harness.cleanup(self.c,state);self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_users').fetchone()[0],before)
  self.assertEqual(self.c.execute("SELECT count(*) FROM sa_identity.sa_auth_identities WHERE legacy_user_id BETWEEN %s AND %s AND enrollment_state='blocked'",(state['base'],state['base']+12)).fetchone()[0],11)
  harness.cleanup(self.c,state) # Recovery may repeat after cleanup committed.
 def test_source_identity_collision_fails_atomically_and_cleanup_refuses_foreign_row(self):
  state=harness.plan(self.c);target=state['base']+3
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,role,created_at,updated_at) VALUES(%s,'foreign@squad.invalid','Unrelated fixture',3,now(),now())",(target,))
  with self.assertRaises(psycopg.errors.UniqueViolation),self.c.transaction():harness.create(self.c,state)
  with self.assertRaises(AssertionError),self.c.transaction():harness.cleanup(self.c,state)
  self.assertEqual(self.c.execute('SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=%s',(target,)).fetchone()[0],'Unrelated fixture')
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_factories WHERE id=ANY(%s::bigint[])',(state['objects']['factories'],)).fetchone()[0],0)
 def test_recovery_does_not_cross_changed_generation_or_revision(self):
  state=harness.plan(self.c);harness.create(self.c,state)
  for query in ['UPDATE sa_domain.runtime_state SET generation=generation+1','UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1']:
   with self.assertRaises(AssertionError),self.c.transaction():self.c.execute(query);harness.cleanup(self.c,state)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE id BETWEEN %s AND %s',(state['base'],state['base']+14)).fetchone()[0],15)
 def test_recovery_refuses_a_foreign_child_reference(self):
  state=harness.plan(self.c);harness.create(self.c,state);self.c.execute('UPDATE sa_snapshot_20261019.sa_items SET order_id=1001 WHERE id=%s',(state['objects']['items'][0],))
  with self.assertRaises(AssertionError),self.c.transaction():harness.cleanup(self.c,state)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE id BETWEEN %s AND %s',(state['base'],state['base']+14)).fetchone()[0],15)
 def test_all_eleven_roles_use_expected_fixture_order_scopes(self):
  state=harness.plan(self.c);harness.create(self.c,state)
  for actor in state['actors']:
   self.c.execute('RESET ROLE');sid=self.c.execute('SELECT gen_random_uuid()').fetchone()[0];self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']));self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':actor['auth_id'],'session_id':str(sid)}),));self.c.execute('SET LOCAL ROLE sa_app')
   me=self.c.execute('SELECT canto_api.v1_me()').fetchone()[0];self.assertEqual(me['role'],actor['role'])
   if actor['role']==12:
    with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT canto_api.v1_order_get(%s)',(state['objects']['orders'][0],))
   else:
    positive=state['objects']['orders'][1 if actor['role']==2 else 0]
    self.assertEqual(self.c.execute('SELECT canto_api.v1_order_get(%s)',(positive,)).fetchone()[0]['id'],str(positive),f"Role {actor['role']}")
    if actor['role']==2:
     # Production coordinators see direct custom orders, excluding dealer orders.
     with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.c.execute('SELECT canto_api.v1_order_get(%s)',(state['objects']['orders'][0],))
    elif actor['role']==0:self.assertEqual(self.c.execute('SELECT canto_api.v1_order_get(%s)',(state['objects']['orders'][1],)).fetchone()[0]['id'],str(state['objects']['orders'][1]))
    else:
     with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.c.execute('SELECT canto_api.v1_order_get(%s)',(state['objects']['orders'][1],))
 def test_checkpoint_cannot_redirect_environment_or_foreign_range(self):
  state=harness.plan(self.c)
  for field,value in [('environment','production'),('url','https://example.com'),('base',100),('label','Foreign')]:
   altered=copy.deepcopy(state);altered[field]=value
   with self.assertRaises(AssertionError):harness.validate(altered)
 def test_managed_subjects_and_factory_scopes_use_public_projection(self):
  state=harness.plan(self.c);harness.create(self.c,state)
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET phone='+919000000001' WHERE id=ANY(%s::bigint[])",([state['base']+5,state['base']+6],))
  for viewer_role in [4,7,8]:
   self.c.execute('RESET ROLE');actor=next(x for x in state['actors'] if x['role']==viewer_role);sid=self.c.execute('SELECT gen_random_uuid()').fetchone()[0]
   self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']));self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':actor['auth_id'],'session_id':str(sid)}),));self.c.execute('SET LOCAL ROLE sa_app')
   for role in [5,6]:
    subject=self.c.execute('SELECT canto_api.v1_person_get(%s)',(state['base']+role,)).fetchone()[0]
    if viewer_role==4:self.assertIn('email',subject);self.assertIsNone(subject['email']);self.assertEqual(subject['phone'],'+919000000001')
    else:self.assertNotIn('email',subject);self.assertNotIn('phone',subject)
    for field in ['encrypted_password','password','reset_password_token','confirmation_token','unlock_token','auth_user_id','canonical_email']:self.assertNotIn(field,subject)
    self.assertNotIn('@managed.invalid',json.dumps(subject))
   with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.c.execute('SELECT canto_api.v1_person_get(%s)',(state['base']+13,))


if __name__=='__main__':unittest.main()
