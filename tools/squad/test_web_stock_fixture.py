"""Exact stock setup/repair/cleanup without modifying any recovery permission."""
import json,unittest,uuid,copy
import psycopg
from psycopg import sql
from unittest import mock
from contextlib import contextmanager
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_business_harness as existing
import test_hosted_business_journeys as business
import web_stock_fixture as stock
class StockFixture(unittest.TestCase):
 setUpClass=classmethod(existing.BusinessHarness.setUpClass.__func__)
 setUp=existing.BusinessHarness.setUp;tearDown=existing.BusinessHarness.tearDown
 def setup_stock(self):
  state=business.plan(self.c);state['created_at']=self.c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat();stock.plan(state);business.prepare(self.c,state);entries=[];stock.prepare(self.c,state,entries.append);return state,entries
 @contextmanager
 def restricted_login(self):
  # Local rollback-only role fixture models Supabase CLI session_user != current_user.
  name='stock_cli_'+uuid.uuid4().hex
  self.c.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOINHERIT').format(sql.Identifier(name)))
  self.c.execute(sql.SQL('GRANT postgres,sa_app TO {}').format(sql.Identifier(name)))
  self.c.execute(sql.SQL('SET SESSION AUTHORIZATION {}').format(sql.Identifier(name)))
  self.c.execute('SET LOCAL ROLE postgres')
  try:
   self.assertEqual(self.c.execute('SELECT session_user,current_user').fetchone(),(name,'postgres'))
   with self.c.transaction():
    self.c.execute('RESET ROLE')
    self.assertEqual(self.c.execute('SELECT current_user').fetchone()[0],name)
    self.assertFalse(self.c.execute("SELECT has_schema_privilege(current_user,'sa_snapshot_20261019','USAGE')").fetchone()[0])
    raise psycopg.Rollback()
   yield name
  finally:
   if self.c.info.transaction_status.name!='INERROR':self.c.execute('RESET SESSION AUTHORIZATION');self.c.execute('SET LOCAL ROLE postgres')
 def test_restricted_login_restores_captured_role_for_raw_stock_check_and_cleanup(self):
  with self.restricted_login() as login:
   state,entries=self.setup_stock()
   self.assertEqual(self.c.execute('SELECT session_user,current_user').fetchone(),(login,'postgres'))
   marker=state['web_stock_reconciliation']
   self.assertEqual(self.c.execute('SELECT dispatched_quantity,xmin::text FROM sa_snapshot_20261019.sa_stocks WHERE id=%s',(int(marker['receipt_id']),)).fetchone(),(1,str(marker['setup_xid'])))
   result=business.cleanup(self.c,state,entries)
   self.assertTrue(result['source_content_restored']);self.assertEqual(result['owned_commands'],8)
 def test_restricted_login_sql_failure_rolls_back_complete_setup_and_restores_role(self):
  with self.restricted_login():
   state=business.plan(self.c);state['created_at']=self.c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat();stock.plan(state);entries=[]
   original=stock.rpc
   def fail_review(c,name,args):
    if name=='v1_stock_reconciliation':return c.execute('SELECT 1/0').fetchone()
    return original(c,name,args)
   business.prepare(self.c,state)
   with self.assertRaises(psycopg.errors.DivisionByZero),mock.patch.object(stock,'rpc',side_effect=fail_review):stock.prepare(self.c,state,entries.append)
   self.assertEqual(self.c.info.transaction_status.name,'INERROR')
   self.c.rollback()  # Same whole-setup rollback as the hosted wrapper, not a savepoint.
   self.assertEqual(self.c.execute('SELECT session_user,current_user').fetchone(),('postgres','postgres'))
   self.assertEqual(business.source_state(self.c),state['source_before'])
   auths=[uuid.UUID(a['auth_id']) for a in state['identity']['actors']]
   self.assertEqual(self.c.execute('SELECT count(*) FROM auth.users WHERE id=ANY(%s)',(auths,)).fetchone()[0],0)
   self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.commands WHERE key=ANY(%s::uuid[])',([e['value']['key'] for e in entries if e['kind']=='command'],)).fetchone()[0],0)
 def test_setup_without_marker_denied(self):
  state=business.plan(self.c);business.prepare(self.c,state)
  with self.assertRaises(AssertionError):stock.prepare(self.c,state,lambda e:None)
 def test_unchanged_cleanup_recovers_interrupted_mismatch(self):
  state,entries=self.setup_stock();result=business.cleanup(self.c,state,entries);self.assertTrue(result['source_content_restored']);self.assertEqual(result['owned_commands'],8)
 def test_exact_ui_equivalent_rebuild_preserves_receipt_then_cleanup_retains_history(self):
  state,entries=self.setup_stock();m=state['web_stock_reconciliation'];actor=next(a for a in state['identity']['actors'] if a['role']==0);sid=uuid.uuid5(uuid.UUID(state['run_id']),'web.stock.setup.session.0')
  self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor['auth_id'],'session_id':str(sid),'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
  row=rpc(self.c,'v1_stock_reconciliation',(int(m['dealer_id']),'review',Jsonb({'receipt_id':m['receipt_id']}),None,1))['data'][0]
  key=uuid.uuid5(uuid.UUID(state['run_id']),'web.stock.browser.repair');entries.append({'kind':'command','value':{'label':'web.stock.browser.repair','key':str(key)}})
  args=(int(m['dealer_id']),'rebuild',Jsonb({'receipts':[{'id':m['receipt_id'],'expected_version':row['version']}],'reason':state['label']+' owned counter repair','idempotency_key':str(key)}),None,25)
  done=rpc(self.c,'v1_stock_reconciliation',args);self.assertEqual(done['state'],'completed');self.assertEqual(rpc(self.c,'v1_stock_reconciliation',args),done)
  row=rpc(self.c,'v1_stock_reconciliation',(int(m['dealer_id']),'review',Jsonb({'receipt_id':m['receipt_id']}),None,1))['data'][0];self.assertEqual(row['counter'],0);self.assertEqual(row['received'],2);self.assertEqual(row['issues'],[])
  self.c.execute('RESET ROLE');result=business.cleanup(self.c,state,entries);self.assertTrue(result['source_content_restored']);self.assertEqual(result['owned_commands'],9);self.assertEqual(business.cleanup(self.c,state,entries),result)
  self.assertEqual(self.c.execute('SELECT before_counter,after_counter FROM sa_domain.stock_reconciliations WHERE receipt_id=%s',(int(m['receipt_id']),)).fetchone(),(1,0))
 def test_missing_command_journal_refuses_cleanup(self):
  state,entries=self.setup_stock();missing=next(i for i,e in enumerate(entries) if e['kind']=='command');entries.pop(missing)
  with self.assertRaisesRegex(AssertionError,'Foreign or unjournaled'),self.c.transaction():business.cleanup(self.c,state,entries)
if __name__=='__main__':unittest.main(verbosity=2)
