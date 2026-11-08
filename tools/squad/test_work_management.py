from sqlstate_assertions import assert_app_conflict
import datetime,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc

class WorkManagement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_orders(c)
    def setUp(self):
        self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
        self.deadline=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=3)
    def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
    def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
    def task(self,assignees=None,order=None,key=None):
        return rpc(self.c,'v1_task_save',(None,'A controlled task',self.deadline,order,assignees or [102],None,key or uuid.uuid4()))
    def goal(self,subject=101,kind=1,key=None):
        return rpc(self.c,'v1_responsibility_save',(Jsonb([{'subject_id':str(subject),'kind':kind,'note':'A controlled responsibility'}]),key or uuid.uuid4()))['items'][0]
    def test_task_create_retry_and_assignee_read(self):
        self.actor(101);key=uuid.uuid4();a=self.task(key=key);b=self.task(key=key);self.assertEqual(a,b)
        self.actor(102);task=rpc(self.c,'v1_task_get',(int(a['id']),));self.assertEqual(task['assignee_ids'],['102'])
        done=rpc(self.c,'v1_task_transition',(int(a['id']),1,a['version'],uuid.uuid4()));self.assertEqual(done['state'],1)
    def test_unrelated_person_cannot_see_task(self):
        self.actor(101);task=self.task();self.actor(201)
        self.assertEqual(rpc(self.c,'v1_tasks_list')['data'],[])
        with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_task_get',(int(task['id']),))
    def test_assignee_cannot_edit_owner_content(self):
        self.actor(101);task=self.task();self.actor(102)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            rpc(self.c,'v1_task_save',(int(task['id']),'Forged',self.deadline,None,[102],task['version'],uuid.uuid4()))
    def test_assignee_cannot_archive(self):
        self.actor(101);task=self.task();self.actor(102)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_task_transition',(int(task['id']),2,task['version'],uuid.uuid4()))
    def test_assignee_removal_changes_access_and_preserves_event(self):
        self.actor(101);task=self.task()
        rpc(self.c,'v1_task_save',(int(task['id']),'Updated',self.deadline,None,[],task['version'],uuid.uuid4()))
        self.actor(102);self.assertEqual(rpc(self.c,'v1_tasks_list')['data'],[])
        self.c.execute('RESET ROLE')
        payloads=[r[0] for r in self.c.execute("SELECT payload FROM sa_domain.outbox WHERE aggregate_kind='task' AND aggregate_id=%s",(int(task['id']),))]
        self.assertTrue(any(p.get('assignees_removed')==['102'] for p in payloads))
    def test_admin_edit_preserves_original_creator_assignment_rule(self):
        self.actor(101);task=self.task();self.actor(100)
        rpc(self.c,'v1_task_save',(int(task['id']),'Admin edit',self.deadline,None,[100,101,102],task['version'],uuid.uuid4()))
        value=rpc(self.c,'v1_task_get',(int(task['id']),))
        self.assertEqual(value['creator_id'],'101');self.assertEqual(set(value['assignee_ids']),{'100','102'})
    def test_task_timestamp_has_explicit_timezone(self):
        self.c.execute("SET LOCAL timezone='Australia/Sydney'");self.actor(101);task=self.task()
        value=rpc(self.c,'v1_task_get',(int(task['id']),))
        actual=datetime.datetime.strptime(value['deadline'],'%Y-%m-%dT%H:%M:%S.%f%z') if '.' in value['deadline'] else datetime.datetime.fromisoformat(value['deadline'])
        self.assertEqual(actual.utcoffset(),datetime.timedelta(0))
        self.assertEqual(actual,self.deadline)
    def test_ineligible_customer_cannot_receive_staff_task(self):
        self.actor(101)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.task(assignees=[103])
    def test_task_order_scope(self):
        self.actor(101)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.task(order=2001)
    def test_worker_notes_flag_is_enforced(self):
        self.actor(111)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_tasks_list')
    def test_worker_with_flag_can_create_own_task(self):
        self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET features='[{\"key\":\"1\",\"checked\":\"true\"}]' WHERE id=111")
        self.actor(111);task=self.task()
        self.assertEqual(rpc(self.c,'v1_task_get',(int(task['id']),))['creator_id'],'111')
    def test_assignee_directory_is_not_customer_directory(self):
        self.actor(101);people=rpc(self.c,'v1_task_assignees')['data']
        self.assertTrue(all(p['role'] in [0,1,2,4,11,12] for p in people))
        self.assertTrue(all(set(p)=={'id','name','role'} for p in people))
    def test_goal_admin_assign_self_complete(self):
        self.actor(100);goal=self.goal();self.actor(101)
        result=rpc(self.c,'v1_responsibility_transition',(int(goal['id']),'completed',None,goal['version'],uuid.uuid4()))
        self.assertEqual(result['state'],'completed');self.assertTrue(rpc(self.c,'v1_responsibilities_list')['data'][0]['completed'])
    def test_goal_subject_cannot_assign(self):
        self.actor(101)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.goal()
    def test_goal_other_subject_denied(self):
        self.actor(100);goal=self.goal();self.actor(201)
        self.assertEqual(rpc(self.c,'v1_responsibilities_list')['data'],[])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_responsibility_transition',(int(goal['id']),'completed',None,goal['version'],uuid.uuid4()))
    def test_team_role_12_goal_supported_with_flag(self):
        self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET features='[{\"key\":\"2\",\"checked\":\"true\"}]' WHERE id=112")
        self.actor(100);goal=self.goal(112);self.actor(112)
        self.assertEqual(rpc(self.c,'v1_responsibilities_list')['data'][0]['id'],goal['id'])
        self.assertEqual(rpc(self.c,'v1_responsibility_transition',(int(goal['id']),'completed',None,goal['version'],uuid.uuid4()))['state'],'completed')
    def test_archive_preserves_goal_row_and_is_generation_scoped(self):
        self.actor(100);goal=self.goal()
        rpc(self.c,'v1_responsibility_transition',(int(goal['id']),'archived','No longer relevant',goal['version'],uuid.uuid4()))
        self.assertEqual(rpc(self.c,'v1_responsibilities_list')['data'],[])
        self.c.execute('RESET ROLE')
        self.assertIsNotNone(self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_responsibilities WHERE id=%s',(int(goal['id']),)).fetchone())
        self.c.execute('UPDATE sa_domain.runtime_state SET generation=1');self.actor(100)
        self.assertEqual(len(rpc(self.c,'v1_responsibilities_list')['data']),1)
    def test_goal_bulk_failure_rolls_back_all_items(self):
        self.actor(100)
        try:
            with self.c.transaction():
                rpc(self.c,'v1_responsibility_save',(Jsonb([{'subject_id':'101','kind':1,'note':'Valid'},{'subject_id':'103','kind':1,'note':'Invalid customer subject'}]),uuid.uuid4()))
        except psycopg.errors.InsufficientPrivilege:pass
        else:self.fail('Expected atomic batch rejection')
        self.assertEqual(rpc(self.c,'v1_responsibilities_list')['data'],[])
    def test_stale_task_transition(self):
        self.actor(101);task=self.task()
        rpc(self.c,'v1_task_transition',(int(task['id']),1,task['version'],uuid.uuid4()))
        with assert_app_conflict(self):rpc(self.c,'v1_task_transition',(int(task['id']),0,task['version'],uuid.uuid4()))

if __name__=='__main__':unittest.main(verbosity=2)
