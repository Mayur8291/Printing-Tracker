"""Exact existing business cleanup after staff/item feedback and moderation.
Uses real SQL commands plus retained audits; no new cleanup exception.
"""
import json,unittest,uuid
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_business_harness as existing_harness
from test_business_journey_composition import run_sdk
import test_hosted_business_journeys as harness

class FeedbackCleanup(unittest.TestCase):
 setUpClass=classmethod(existing_harness.BusinessHarness.setUpClass.__func__)
 setUp=existing_harness.BusinessHarness.setUp
 tearDown=existing_harness.BusinessHarness.tearDown
 prepared=existing_harness.BusinessHarness.prepared
 def test_completed_graph_item_feedback_and_moderation_cleanup_retains_audits(self):
  state=self.prepared();actors={}
  for actor in state['identity']['actors']:
   sid=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']));actors[actor['role']]={**actor,'session_id':str(sid)}
  result=run_sdk(self.c,state['fixture'],actors,state['run_id']);entries=result['journal'];commercial=result['report']['commercial'];order=int(commercial['entities']['factoryOrderId'])
  item=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s ORDER BY id',(order,)).fetchone()[0]
  def actor(role):
   self.c.execute('RESET ROLE');a=actors[role];self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':a['auth_id'],'session_id':a['session_id'],'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
  def command(role,name,args,label):
   actor(role);key=uuid.uuid5(uuid.UUID(state['run_id']),label);entries.append({'kind':'command','value':{'label':label,'key':str(key)}});return rpc(self.c,name,(*args,key))
  rating=command(4,'v1_rating_save',(None,'Item',item,state['base']+9,Jsonb({'score':'3','positive_comments':state['label']+' item feedback'}),None),'web.feedback.item')
  self.assertEqual(rating['to_id'],str(state['base']+9));self.assertEqual(rating['entity_kind'],'Item');self.assertEqual(rating['entity_id'],str(item))
  # Existing composition created Customer→SC, SC→PC and PC→FM on this order.
  actor(0);before=rpc(self.c,'v1_ratings_list',('Order',order));self.assertEqual(len(before['data']),3);target=next(r for r in before['data'] if r['from_id']==str(state['base']+1))
  moderated=command(0,'v1_rating_archive',(int(target['id']),state['label']+' moderation',target['version']),'web.feedback.moderate')
  self.assertTrue(moderated['archived']);self.assertEqual(rpc(self.c,'v1_ratings_list',('Order',order))['summary']['count'],2)
  history=rpc(self.c,'v1_ratings_list',('Order',order,None,None,True));retained=next(r for r in history['data'] if r['id']==target['id']);self.assertTrue(retained['archived']);self.assertEqual(retained['moderation_reason'],state['label']+' moderation')
  actor(3);self.assertFalse(any(r['id']==rating['id'] for r in rpc(self.c,'v1_ratings_list',('Item',item))['data']))
  self.c.execute('RESET ROLE');count=self.c.execute('SELECT count(*) FROM sa_domain.audit WHERE id>%s',(state['audit_start'],)).fetchone()[0]
  cleaned=harness.cleanup(self.c,state,entries);self.assertTrue(cleaned['source_content_restored']);self.assertEqual(cleaned['owned_commands'],count)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_ratings WHERE id=ANY(%s)',([int(rating['id']),int(target['id'])],)).fetchone()[0],0)
  self.assertTrue(self.c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rating.archived' AND entity_id=%s",(int(target['id']),)).fetchone());self.assertEqual(harness.cleanup(self.c,state,entries),cleaned)

if __name__=='__main__':unittest.main(verbosity=2)
