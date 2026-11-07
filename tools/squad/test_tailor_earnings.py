import decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_pricing import CONFIG
import test_production_execution as work
D=decimal.Decimal
class Earnings(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 actor=work.Execution.actor;raw=work.Execution.raw;iv=work.Execution.iv;cut=work.Execution.cut;assign=work.Execution.assign;inspect=work.Execution.inspect;tearDown=work.Execution.tearDown
 def setUp(self):
  work.Execution.setUp(self);self.actor(103);p=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Earnings fixture','',uuid.uuid4()))
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=%s WHERE id=1001',(int(p['id']),));self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET base_of=10,base_sn=20 WHERE id=1');self.raw('UPDATE sa_snapshot_20261019.sa_add_ons SET add_on_of=2,add_on_sn=3 WHERE id=1')
  self.actor(109);self.cut();self.assign(6,105);self.assign(4,106)
  rows=self.raw('SELECT tq.id,it.tailor_id FROM sa_snapshot_20261019.sa_item_tailor_quantities tq JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=tq.item_tailor_id WHERE it.item_id=1001 ORDER BY tq.id')
  self.inspect(rows=[{'item_tailor_quantity_id':str(id_),'quantity':6 if tailor==105 else 1} for id_,tailor in rows])
  self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET assign_at='2026-10-24 04:30:00' WHERE item_id=1001");self.actor(104)
 def report(self,tailor=105,week='2026-10-24',team=False,cursor=None,limit=30):return rpc(self.c,'v1_tailor_earnings',(tailor,week,team,cursor,limit))
 def test_exact_legacy_rate_and_completed_quantity(self):
  r=self.report();x=r['data'][0];self.assertEqual((x['assigned'],x['completed']), (6,6));self.assertEqual(D(x['of_rate']),12);self.assertEqual(D(x['sn_rate']),23);self.assertEqual(D(x['amount']),210)
  self.assertEqual(r['basis'],{'formula':'legacy-tailor-v1','rates':'current_master','addons':'all_linked_base_addons','period':'assignment_date','completion':'current_at_read'})
 def test_team_rollup_keeps_subtailor_rows_separate(self):
  r=self.report(team=True);self.assertEqual(len(r['data']),2);self.assertEqual(r['summary']['completed'],7);self.assertEqual(D(r['summary']['amount']),245);self.assertEqual(r['summary']['pending'],3)
 def test_subtailor_individual_report(self):
  r=self.report(tailor=106);self.assertEqual(r['summary']['completed'],1);self.assertEqual(D(r['summary']['amount']),35)
 def test_current_rate_changes_apply_to_historical_assignment_week(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET base_of=11 WHERE id=1');self.assertEqual(D(self.report()['summary']['amount']),216)
 def test_unselected_linked_addon_rate_is_included_as_in_source(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_add_on_base_products(base_product_id,add_on_id,is_deleted,created_at,updated_at) VALUES(1,2,true,now(),now())');self.raw('UPDATE sa_snapshot_20261019.sa_add_ons SET add_on_of=4,add_on_sn=6,is_deleted=true WHERE id=2')
  self.assertEqual(D(self.report()['summary']['amount']),270)
 def test_assignment_week_not_inspection_week(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates SET marked_at='2026-11-03 00:00:00'");self.assertEqual(self.report()['summary']['completed'],6)
 def test_saturday_midnight_boundary_in_kolkata(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET assign_at='2026-10-23 18:30:00' WHERE item_id=1001");self.assertEqual(self.report()['summary']['completed'],6)
  self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET assign_at='2026-10-23 18:29:59.999999' WHERE item_id=1001");self.assertEqual(self.report()['summary']['completed'],0)
 def test_end_saturday_exclusive(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET assign_at='2026-10-30 18:30:00' WHERE item_id=1001");self.assertEqual(self.report()['summary']['completed'],0)
 def test_pagination_does_not_change_totals(self):
  p=self.report(team=True,limit=1);n=self.report(team=True,cursor=p['next_cursor'],limit=1);self.assertNotEqual(p['data'][0]['id'],n['data'][0]['id']);self.assertEqual(p['summary'],n['summary'])
 def test_cursor_cannot_change_week(self):
  p=self.report(team=True,limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(team=True,week='2026-10-31',cursor=p['next_cursor'])
 def test_other_factory_denied(self):
  self.actor(204)
  with self.assertRaises(psycopg.errors.NoDataFound):self.report()
 def test_customer_cannot_read_payroll(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.report()
 def test_admin_and_pc_allowed(self):
  for n in (100,102):self.actor(n);self.assertEqual(self.report()['summary']['completed'],6)
 def test_missing_rate_requires_review_not_zero_wage(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET base_of=NULL WHERE id=1');r=self.report();self.assertIsNone(r['summary']['amount']);self.assertTrue(r['summary']['needs_reconciliation']);self.assertIsNone(r['data'][0]['amount'])
 def test_over_completed_history_requires_review(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_job_sheet_assign_quantities SET completed_quantity=100 WHERE item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors WHERE tailor_id=105)');self.assertTrue(self.report()['summary']['needs_reconciliation'])
 def test_invalid_week_start_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(week='2026-10-25')
 def test_subtailor_cannot_be_team_root(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(tailor=106,team=True)
 def test_old_factory_work_hidden_after_subject_moves(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=204 WHERE id=105');self.actor(204);self.assertEqual(self.report()['data'],[])
 def test_private_rate_projection_is_not_client_callable(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT * FROM sa_domain.tailor_earnings_rows(105,now(),now(),false)")

if __name__=='__main__':unittest.main(verbosity=2)
