"""Imported operational history is visible without replaying or leaking old errors."""
import json,unittest,uuid
import psycopg
from local_db import connect
from fixtures import session
class TransferHistory(unittest.TestCase):
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_sync_airtables(id,sync_time,sync_status,sync_errors,created_at,updated_at) SELECT n,now(),n%3,'{\"secret\":\"do-not-expose\"}',now(),now() FROM generate_series(8001,8003)n")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_bulk_uploads(id,user_id,status,upload_type,total,inserted,updated,skipped,duplicates,failed_count,error_details,file,created_at,updated_at) VALUES(8001,100,2,0,100,80,10,5,3,2,'{\"token\":\"do-not-expose\"}','private/source.csv',now(),now())")
  self.actor(999)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def call(self,kind='airtable',cursor=None,limit=25,id=None):return self.c.execute('SELECT canto_api.v1_import_status(%s,%s,%s,%s)',(id,cursor,limit,kind)).fetchone()[0]
 def test_staff_airtable_and_prices(self):
  self.assertEqual(len(self.call()['data']),3);r=self.call('prices')['data'][0];self.assertEqual(r['source_state'],'completed');self.assertEqual(r['inserted_rows'],80)
 def test_legacy_admin_airtable_only(self):
  self.actor(100);self.assertEqual(len(self.call()['data']),3)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.call('prices')
 def test_customer_denied(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.call()
 def test_pagination_no_duplicate_and_bound_to_kind(self):
  first=self.call(limit=2);second=self.call(cursor=first['next_cursor'],limit=2);self.assertEqual(len(second['data']),1);self.assertNotIn(second['data'][0]['id'],[r['id'] for r in first['data']])
  with self.assertRaises(psycopg.Error):self.call('prices',first['next_cursor'])
 def test_cursor_bound_to_actor(self):
  first=self.call(limit=1);self.actor(100)
  with self.assertRaises(psycopg.Error):self.call(cursor=first['next_cursor'])
 def test_cursor_bound_to_generation(self):
  first=self.call(limit=1);self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1');self.actor(999)
  with self.assertRaises(psycopg.Error):self.call(cursor=first['next_cursor'])
 def test_no_raw_source_secrets_or_file_paths(self):
  output=json.dumps([self.call(),self.call('prices')]);self.assertNotIn('do-not-expose',output);self.assertNotIn('private/source.csv',output);self.assertTrue(self.call('prices')['data'][0]['has_errors'])
 def test_history_does_not_replay_pending_work(self):
  r=self.call();self.assertTrue(all(x['resumable'] is False for x in r['data']));self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.outbox').fetchone()[0],0)
 def test_current_history_remains_compatible(self):self.assertEqual(self.c.execute('SELECT canto_api.v1_import_status(NULL,NULL,25)').fetchone()[0]['data'],[])
 def test_current_id_cannot_be_mixed_with_legacy(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call(id=uuid.uuid4())
 def test_unknown_kind_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call('auth')
 def test_raw_history_tables_are_not_client_readable(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_snapshot_20261019.sa_sync_airtables')
if __name__=='__main__':unittest.main()
