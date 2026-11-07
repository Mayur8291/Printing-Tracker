import concurrent.futures,datetime,decimal,threading,unittest,uuid
import psycopg
from local_db import connect
from fixtures import seed_orders,session,rpc

class Targets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_orders(c)
    def setUp(self):
        self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');session(self.c,100)
    def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
    def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
    def target(self,start='2026-11-01',end='2026-11-30',subject=101,key=None):
        return rpc(self.c,'v1_milestone_save',(None,subject,datetime.date.fromisoformat(start),datetime.date.fromisoformat(end),decimal.Decimal('10000'),'Sales target',None,key or uuid.uuid4()))
    def test_overlap_containment_rejected(self):
        self.target('2026-11-10','2026-11-20')
        with self.assertRaises(psycopg.errors.ExclusionViolation):self.target('2026-11-01','2026-11-30')
    def test_contained_interval_rejected(self):
        self.target()
        with self.assertRaises(psycopg.errors.ExclusionViolation):self.target('2026-11-10','2026-11-20')
    def test_adjacent_calendar_periods_allowed(self):
        self.target('2026-11-01','2026-11-07');self.target('2026-11-08','2026-11-14')
        self.assertEqual(len(rpc(self.c,'v1_milestones_list')['data']),2)
    def test_boundary_date_overlap_rejected(self):
        self.target('2026-11-01','2026-11-07')
        with self.assertRaises(psycopg.errors.ExclusionViolation):self.target('2026-11-07','2026-11-14')
    def test_kolkata_start_and_end_boundaries(self):
        target=self.target('2026-11-07','2026-11-07');self.c.execute('RESET ROLE')
        # One microsecond before start is outside; the final microsecond is inside.
        self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET created_at='2026-11-06 18:29:59.999999' WHERE customer_sc_id=101")
        self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET created_at='2026-11-06 18:30:00' WHERE id=1001")
        self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET created_at='2026-11-07 18:29:59.999999' WHERE id=1005")
        self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET created_at='2026-11-07 18:30:00' WHERE id=1002")
        self.actor(101);result=rpc(self.c,'v1_milestone_progress',(int(target['id']),))
        self.assertEqual(decimal.Decimal(result['placed_amount']),2000);self.assertEqual(decimal.Decimal(result['completed_amount']),1000)
        self.assertEqual(result['order_count'],2)
    def test_progress_excludes_cancelled_and_other_coordinator(self):
        target=self.target();self.actor(101)
        progress=rpc(self.c,'v1_milestone_progress',(int(target['id']),))
        self.assertEqual(decimal.Decimal(progress['placed_amount']),5000)
        self.assertEqual(decimal.Decimal(progress['completed_amount']),1000)
        page=rpc(self.c,'v1_milestones_list')['data'][0]
        self.assertEqual(decimal.Decimal(page['placed_amount']),5000);self.assertEqual(page['order_count'],5)
    def test_sales_coordinator_cannot_create_target(self):
        self.actor(101)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.target()
    def test_coordinator_cannot_read_other_target(self):
        target=self.target(subject=201);self.actor(101)
        with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_milestone_progress',(int(target['id']),))
    def test_archive_allows_replacement_without_deleting_history(self):
        target=self.target()
        rpc(self.c,'v1_milestone_archive',(int(target['id']),'Replaced target',target['version'],uuid.uuid4()))
        replacement=self.target();self.assertNotEqual(replacement['id'],target['id'])
        self.assertEqual(len(rpc(self.c,'v1_milestones_list')['data']),1)
        self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_milestones').fetchone()[0],2)
    def test_retry_does_not_create_second_target(self):
        key=uuid.uuid4();a=self.target(key=key);self.assertEqual(self.target(key=key),a)
    def test_target_invalid_amount(self):
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            rpc(self.c,'v1_milestone_save',(None,101,datetime.date(2027,1,1),datetime.date(2027,1,7),decimal.Decimal('-1'),'Invalid',None,uuid.uuid4()))

class ConcurrentTargets(unittest.TestCase):
    def test_overlapping_creates_serialize(self):
        keys=[uuid.uuid4(),uuid.uuid4()];barrier=threading.Barrier(2)
        with connect() as c:
            seed_orders(c);original=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
            c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
        def save(key):
            with connect() as c:
                try:
                    with c.transaction():
                        session(c,100);barrier.wait(timeout=3)
                        return rpc(c,'v1_milestone_save',(None,201,datetime.date(2029,1,1),datetime.date(2029,1,31),1000,'Race',None,key))
                except psycopg.Error as e:return e.sqlstate
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(save,keys))
            self.assertEqual(sum(isinstance(x,dict) for x in results),1);self.assertIn('23P01',results)
        finally:
            with connect() as c,c.transaction():
                ids=[r[0] for r in c.execute('SELECT entity_id FROM sa_domain.audit WHERE command_key=ANY(%s)',(keys,))]
                c.execute('DELETE FROM sa_snapshot_20261019.sa_milestones WHERE id=ANY(%s)',(ids,))
                c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='milestone' AND entity_id=ANY(%s)",(ids,))
                c.execute('DELETE FROM sa_domain.outbox WHERE command_key=ANY(%s)',(keys,))
                c.execute('DELETE FROM sa_domain.audit WHERE command_key=ANY(%s)',(keys,))
                c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,))
                c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
                c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',original)

if __name__=='__main__':unittest.main(verbosity=2)
