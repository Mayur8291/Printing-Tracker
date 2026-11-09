"""Release refuses authority drift in every reviewed privileged guest bridge."""
import unittest
from local_db import connect
from release_mirror import security_check

HELPERS=('sa_domain.account_rehearsal_snapshot(uuid)','sa_domain.account_rehearsal_record(uuid,text,bigint)','sa_domain.account_rehearsal_publish_auth(uuid,uuid)')
class GuestBridgeRelease(unittest.TestCase):
 def setUp(self):self.c=connect();self.c.execute('BEGIN')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def test_reviewed_authority_passes(self):security_check(self.c)
 def test_each_api_or_executor_grant_is_rejected(self):
  for helper in HELPERS:
   for role in ['anon','authenticated','sa_app','service_role','sa_executor','sa_guard']:
    with self.subTest(helper=helper,role=role),self.assertRaises(RuntimeError),self.c.transaction():
     self.c.execute(f'GRANT EXECUTE ON FUNCTION {helper} TO {role}');security_check(self.c)
 def test_each_search_path_or_owner_change_is_rejected(self):
  for helper in HELPERS:
   for alteration in ['SET search_path=pg_catalog,public','OWNER TO sa_account_writer','SECURITY INVOKER']:
    with self.subTest(helper=helper,alteration=alteration),self.assertRaises(RuntimeError),self.c.transaction():
     self.c.execute(f'ALTER FUNCTION {helper} {alteration}');security_check(self.c)
 def test_required_private_executor_access_cannot_be_lost(self):
  for helper in HELPERS:
   with self.subTest(helper=helper),self.assertRaises(RuntimeError),self.c.transaction():
    self.c.execute(f'REVOKE EXECUTE ON FUNCTION {helper} FROM sa_account_writer');security_check(self.c)

if __name__=='__main__':unittest.main(verbosity=2)
