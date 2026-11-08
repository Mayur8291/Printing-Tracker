"""Claim ordering and slow-job isolation exercise real database queue selection."""
import json,unittest,uuid
from local_db import connect
from fixtures import seed_orders,uid

class WorkerDispatch(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute('UPDATE sa_sync.environment_state SET cutover=true')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def add(self,event,age=0):
  self.c.execute('RESET ROLE')
  return self.c.execute("INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload,available_at) VALUES(%s,%s,'integration',1,%s,0,'{}',now()-make_interval(secs=>%s)) RETURNING id",(uid(100),event,uuid.uuid4(),age)).fetchone()[0]
 def claim(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role'}),));self.c.execute('SET LOCAL ROLE service_role')
  return self.c.execute('SELECT canto_api.squad_job_claim(5)').fetchone()[0]['jobs']
 def test_order_is_due_time_then_sequence_not_update_return_order(self):
  newest=self.add('notification.fanout',1);older=self.add('notification.fanout',2);same=self.add('notification.fanout',2)
  self.assertEqual([j['id'] for j in self.claim()],[str(older),str(same),str(newest)])
 def test_slow_handlers_do_not_consume_unstarted_attempts(self):
  heavy=[self.add('warehouse.order_reconcile',10),self.add('business.mail_delivery',9),self.add('airtable.report_customer',8),self.add('airtable.statistics',7)]
  quick=self.add('notification.fanout',6)
  jobs=self.claim();self.assertEqual([j['id'] for j in jobs],[str(heavy[0]),str(quick)])
  self.c.execute('RESET ROLE')
  self.assertEqual(self.c.execute('SELECT status,attempts FROM sa_domain.outbox WHERE id=ANY(%s) ORDER BY sequence_id',(heavy[1:],)).fetchall(),[('pending',0)]*3)
  # A second consumer can lease the next available heavy job without waiting
  # for the first consumer's network response; it cannot steal its active lease.
  self.assertEqual([j['id'] for j in self.claim()],[str(heavy[1])])
 def test_mirror_never_claims_even_due_provider_jobs(self):
  self.add('warehouse.order_reconcile',10);self.c.execute('UPDATE sa_sync.environment_state SET cutover=false')
  self.assertEqual(self.claim(),[])
 def test_future_retry_does_not_block_other_ready_heavy_work(self):
  self.add('warehouse.order_reconcile',-60);ready=self.add('business.mail_delivery',1)
  self.assertEqual([j['id'] for j in self.claim()],[str(ready)])

if __name__=='__main__':unittest.main(verbosity=2)
