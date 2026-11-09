import copy,hashlib,json,unittest,uuid
from psycopg.types.json import Jsonb
import test_business_harness as base
import test_hosted_business_journeys as harness
from business_nested_milestones import owned_nested_milestones

class NestedTargetReceipts(unittest.TestCase):
 def rows(self):
  actor,key=uuid.uuid4(),uuid.uuid4();child=uuid.UUID(hashlib.md5((str(key)+':milestone:1').encode()).hexdigest())
  return actor,key,[(actor,key,'milestones.created','milestone',42,{'subject_id':'101','ids':['42']},'123'),(actor,child,'milestone.saved','milestone',42,{'subject_id':'101'},'123')]
 def test_exact_child_only(self):
  actor,key,rows=self.rows();self.assertEqual(owned_nested_milestones(rows,[actor],{key}),{rows[1][:5]})
 def test_unjournaled_parent_never_authorizes_children(self):
  actor,key,rows=self.rows();self.assertEqual(owned_nested_milestones(rows,[actor],set()),set())
 def test_changed_child_actor_key_kind_id_subject_or_transaction_refused(self):
  for index,value in [(0,uuid.uuid4()),(1,uuid.uuid4()),(2,'person.saved'),(3,'person'),(4,99),(5,{'subject_id':'999'}),(6,'124')]:
   actor,key,rows=self.rows();changed=list(rows[1]);changed[index]=value;rows[1]=tuple(changed)
   with self.subTest(index=index),self.assertRaises(AssertionError):owned_nested_milestones(rows,[actor],{key})
 def test_missing_duplicate_or_unbounded_child_receipt_refused(self):
  for variation in ['missing','duplicate','unbounded']:
   actor,key,rows=self.rows()
   if variation=='missing':rows.pop()
   elif variation=='duplicate':rows.append(rows[1])
   else:rows[0][5]['ids']=['42']*25
   with self.subTest(variation=variation),self.assertRaises(AssertionError):owned_nested_milestones(rows,[actor],{key})

class NestedTargetCleanup(unittest.TestCase):
 @classmethod
 def setUpClass(cls):base.BusinessHarness.setUpClass()
 def setUp(self):
  self.f=base.BusinessHarness();self.f.setUp();self.c=self.f.c
 def tearDown(self):self.f.tearDown()
 def test_real_batch_cleanup_keeps_audits_and_restores_source(self):
  state=self.f.prepared();actor=next(a for a in state['identity']['actors'] if a['role']==0);sid=uuid.uuid4()
  self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']))
  self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor['auth_id'],'session_id':str(sid),'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
  label='web.role0.0';key=uuid.uuid5(uuid.UUID(state['run_id']),label)
  targets=[{'name':state['label']+' target1','start':'2028-01-01','end':'2028-01-31','amount':'500'},{'name':state['label']+' target2','start':'2028-02-01','end':'2028-02-28','amount':'500'}]
  result=self.c.execute('SELECT canto_api.v1_milestones_create(%s,%s,%s)',(state['base']+1,Jsonb(targets),key)).fetchone()[0];self.assertEqual(result['created'],2)
  self.c.execute('RESET ROLE');receipt=harness.cleanup(self.c,state,[{'kind':'command','value':{'label':label,'key':str(key)}}])
  self.assertEqual(receipt['owned_commands'],3);self.assertEqual(receipt['tables']['sa_milestones'],2);self.assertTrue(receipt['source_content_restored']);self.assertEqual(receipt['edit_revision_after']-receipt['edit_revision_before'],3)

if __name__=='__main__':unittest.main()
