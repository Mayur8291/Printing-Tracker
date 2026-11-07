"""METRIC-02/03: scoped work history, explicit time bases and shared rankings."""
import unittest,decimal,uuid
import psycopg
from fixtures import rpc
import test_tailor_earnings as earnings
D=decimal.Decimal
class WorkReports(unittest.TestCase):
 setUpClass=classmethod(earnings.Earnings.setUpClass.__func__)
 setUp=earnings.Earnings.setUp;tearDown=earnings.Earnings.tearDown
 actor=earnings.Earnings.actor;raw=earnings.Earnings.raw;iv=earnings.Earnings.iv;cut=earnings.Earnings.cut;assign=earnings.Earnings.assign;inspect=earnings.Earnings.inspect
 def leaders(self,factory=None,from_='2026-10-24',before='2026-10-31',cursor=None,limit=30):return rpc(self.c,'v1_tailor_leaderboard',(factory,from_,before,cursor,limit))
 def metrics(self,from_='2026-10-24',before='2026-10-31',subject=None,factory=None):return rpc(self.c,'v1_work_metrics',(from_,before,subject,factory))
 def test_leaderboard_reuses_weekly_earnings_formula(self):
  r=self.leaders();t=next(x for x in r['data'] if x['id']=='105');e=rpc(self.c,'v1_tailor_earnings',(105,'2026-10-24'))['summary'];self.assertEqual(t['completed'],e['completed']);self.assertEqual(D(t['amount']),D(e['amount']))
 def test_subtailors_are_separate_without_double_count(self):
  r=self.leaders();self.assertEqual({x['id'] for x in r['data']},{'105','106'});self.assertEqual(r['summary']['completed'],7);self.assertEqual([x['completed'] for x in r['data']],[6,1]);self.assertEqual(r['data'][1]['parent_tailor_id'],'105')
 def test_inspector_and_dispatch_do_not_receive_pay_amounts(self):
  for actor in [107,108]:
   self.actor(actor);r=self.leaders();self.assertNotIn('amount',str(r));self.assertEqual(r['summary']['completed'],7)
 def test_foreign_factory_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.leaders(factory=2)
 def test_foreign_factory_does_not_rank_transferred_work(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=204 WHERE id=105');self.actor(204);r=self.leaders();self.assertEqual(r['summary']['completed'],0)
 def test_customer_cannot_browse_workers(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.leaders()
 def test_pagination_keeps_global_rank_and_summary(self):
  p=self.leaders(limit=1);q=self.leaders(cursor=p['next_cursor'],limit=1);self.assertEqual(p['data'][0]['position'],1);self.assertEqual(q['data'][0]['position'],2);self.assertEqual(p['summary'],q['summary']);self.assertIsNone(q['next_cursor'])
 def test_report_cursor_invalidated_by_business_write(self):
  p=self.leaders(limit=1);self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.leaders(cursor=p['next_cursor'])
 def test_cursor_bound_to_factory_and_period(self):
  p=self.leaders(limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.leaders(from_='2026-10-25',cursor=p['next_cursor'])
 def test_missing_rate_does_not_erase_real_work_ranking(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET base_of=NULL WHERE id=1');r=self.leaders();self.assertEqual(r['data'][0]['completed'],6);self.assertIsNone(r['data'][0]['amount']);self.assertTrue(r['data'][0]['needs_reconciliation']);self.actor(108);self.assertFalse(self.leaders()['data'][0]['needs_reconciliation'])
 def test_invalid_quantities_not_ranked_as_high_performance(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_job_sheet_assign_quantities SET completed_quantity=100 WHERE item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors WHERE tailor_id=105)');r=self.leaders();self.assertEqual(r['data'][0]['id'],'106');self.assertIsNone(r['data'][-1]['completed']);self.assertTrue(r['data'][-1]['needs_reconciliation'])
 def test_unfinished_assignments_included_in_work_totals(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_job_sheet_assign_quantities SET completed_quantity=0 WHERE item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors WHERE tailor_id=105)');r=self.leaders();t=next(x for x in r['data'] if x['id']=='105');self.assertEqual(t['assigned'],6);self.assertEqual(t['completed'],0)
 def test_shared_helper_is_private(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT * FROM sa_domain.tailor_work_rows(ARRAY[105]::bigint[],now(),now(),NULL)")
 def test_period_must_be_bounded(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.metrics(from_='2000-01-01')
 def test_exclusive_period_boundary(self):
  self.assertEqual(self.leaders(before='2026-10-24',from_='2026-10-23')['summary']['completed'],0)
 def test_work_event_date_not_assignment_cohort_for_inspection(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates SET marked_at='2026-11-03 00:00:00' WHERE item_id=1001");r=self.metrics();self.assertEqual(r['work_in_period']['assigned'],10);self.assertEqual(r['work_in_period']['inspected'],0);r=self.metrics(from_='2026-11-01',before='2026-11-05');self.assertEqual(r['work_in_period']['assigned'],0);self.assertEqual(r['work_in_period']['inspected'],7)
 def test_backlog_not_disguised_as_period_work(self):
  r=self.metrics();self.assertGreater(r['backlog']['pending_orders'],0);self.assertEqual(r['cohort']['orders'],0);self.assertEqual(r['basis']['backlog'],'current_all_dates')
 def test_factory_quantity_balances_without_money(self):
  r=self.metrics();self.assertNotIn('amount',str(r));self.assertNotIn('cost',str(r));self.assertEqual(r['factory_balances']['remaining_inspection'],3);self.assertEqual(r['factory_balances']['remaining_dispatch'],7)
 def test_invalid_source_balances_require_review(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET cutting_done=1000 WHERE item_id=1001');r=self.metrics()['factory_balances'];self.assertTrue(r['needs_reconciliation']);self.assertIsNone(r['remaining_cut'])
 def test_other_factory_work_hidden(self):
  self.actor(204);self.assertEqual(self.metrics()['work_in_period']['assigned'],0)
 def test_cutter_cannot_select_another_cutter(self):
  self.actor(109)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.metrics(subject=209)
 def test_factory_cannot_select_foreign_subject(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.metrics(subject=209)
 def test_customer_denied_operational_metrics(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.metrics()
 def test_admin_can_filter_actual_cutter(self):
  self.actor(100);self.assertEqual(self.metrics(subject=109)['work_in_period']['assigned'],10)
 def test_worker_original_due_date_retains_lateness(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=111,status=1,created_on='2026-10-25',delivered_on='2026-10-29',due_on='2026-11-05' WHERE id=1001")
  self.raw("INSERT INTO sa_domain.worker_due_baselines(order_id,generation,assignment_revision,worker_id,original_due_at,basis) VALUES(1001,0,1,111,'2026-10-27Z','assignment')")
  self.actor(111);r=self.metrics();self.assertEqual(r['cohort']['completed_with_dates'],1);self.assertEqual(r['cohort']['completed_on_time'],0);self.assertEqual(D(r['cohort']['on_time_percent']),0)
 def test_worker_unknown_baseline_not_fake_on_time(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=111,status=1,created_on='2026-10-25',delivered_on='2026-10-29',due_on='2026-11-05' WHERE id=1001");self.actor(111);r=self.metrics();self.assertIsNone(r['cohort']['on_time_percent']);self.assertGreater(r['backlog']['worker_original_due_unknown'],0)
