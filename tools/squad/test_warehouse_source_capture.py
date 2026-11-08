import unittest,uuid
import psycopg
from local_db import connect
from test_catalogue import seed_catalogue
from profile_hosted_business_journeys import fence_sequences,sequence_states
from warehouse_source_capture import capture

class WarehouseSourceCapture(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def test_real_sdk_builders_and_all_fixtures_and_sequences_roll_back(self):
  run=uuid.uuid4();email=f'squad-warehouse-{run.hex[:16]}@mailinator.com'
  with connect() as c:
   before=sequence_states(c);runtime=c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0]
   with c.transaction():
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=ARRAY[]::uuid[],test_write_expires_at=NULL')
    fence_sequences(c);data,report=capture(c,run,1950000000,1960000000,1,email)
    self.assertEqual(report['shared_sdk_rpc_calls'],5)
    initial=data['initial']['saleOrder'];replacement=data['replacement']['saleOrder']
    self.assertEqual(len(initial['saleOrderItems']),1);self.assertEqual(initial['customerCode'],'S-1950000000')
    self.assertEqual(initial['saleOrderItems'][0]['totalPrice'],105)
    self.assertEqual(replacement['saleOrderItems'][0]['totalPrice'],105)
    self.assertNotEqual(initial['saleOrderItems'][0]['code'],replacement['saleOrderItems'][0]['code'])
    self.assertIn(data['source']['request_id'].replace('-',''),replacement['saleOrderItems'][0]['code'])
    self.assertNotEqual(initial['fulfillmentTat'],replacement['fulfillmentTat'])
    self.assertEqual(initial['notificationEmail'],email)
    self.assertEqual(c.execute('SELECT cutover FROM sa_sync.environment_state').fetchone(),(False,))
    raise psycopg.Rollback()
   self.assertEqual(before,sequence_states(c));self.assertEqual(runtime,c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0])
   self.assertIsNone(c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id>=1950000000').fetchone())
   self.assertIsNone(c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_orders WHERE id=1960000000').fetchone())
   self.assertIsNone(c.execute('SELECT 1 FROM auth.users WHERE email=%s',(email,)).fetchone())
 def test_unfenced_capture_refused_before_source_writes(self):
  run=uuid.uuid4()
  with connect() as c,c.transaction():
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=ARRAY[]::uuid[],test_write_expires_at=NULL')
   with self.assertRaisesRegex(AssertionError,'Fence sequences'):
    capture(c,run,1950000000,1960000000,1,f'squad-warehouse-{run.hex[:16]}@mailinator.com')
   self.assertIsNone(c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id>=1950000000').fetchone())
   raise psycopg.Rollback()
 def test_existing_customer_id_cannot_become_provider_fixture(self):
  run=uuid.uuid4()
  with connect() as c,c.transaction():
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=ARRAY[]::uuid[],test_write_expires_at=NULL');fence_sequences(c)
   c.execute("INSERT INTO sa_snapshot_20261019.sa_users(id,name,role,created_at,updated_at) VALUES(1950000000,'Existing record',3,now(),now())")
   with self.assertRaisesRegex(AssertionError,'collision'):
    capture(c,run,1950000000,1960000000,1,f'squad-warehouse-{run.hex[:16]}@mailinator.com')
   self.assertEqual(c.execute('SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=1950000000').fetchone(),('Existing record',))
   raise psycopg.Rollback()

if __name__=='__main__':unittest.main(verbosity=2)
