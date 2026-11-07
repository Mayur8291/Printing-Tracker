"""Sales reports: grouping before paging, precise money, history and scoped SC metrics."""
import unittest,decimal,datetime
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
D=decimal.Decimal
class SalesReports(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-26',created_at='2026-10-26',due_on='2026-10-30'")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_items SET item_type=1,rmp_brand_id=1,rmp_class_id=1,rmp_category_id=1 WHERE id IN(1002,2002)")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET phone='+0910123456789' WHERE id=103");session(self.c,100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):self.c.execute('RESET ROLE');self.c.execute(q,args);session(self.c,100)
 def report(self,kind='customers',filters=None,cursor=None,limit=30,from_='2026-10-24',before='2026-10-31'):
  return rpc(self.c,'v1_sales_report',(kind,from_,before,Jsonb(filters or {}),cursor,limit))
 def metrics(self,subject=101):return rpc(self.c,'v1_sales_coordinator_metrics',(subject,'2026-10-24','2026-10-31'))
 def test_customer_aggregated_before_paging(self):
  p=self.report(limit=1);q=self.report(cursor=p['next_cursor'],limit=1);self.assertEqual(p['data'][0]['orders'],6);self.assertEqual(q['data'][0]['orders'],6);self.assertEqual(p['summary']['groups'],2);self.assertIsNone(q['next_cursor']);self.assertEqual(q['data'][0]['quantity'],60)
 def test_brand_filters_individual_lines_not_parent_orders(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET rmp_brand_id=2,rmp_class_id=2 WHERE id=2002');r=self.report('brands',{'brand_id':'1'});self.assertEqual(len(r['data']),1);self.assertEqual(r['data'][0]['quantity'],10)
 def test_aggregates_only_pure_rmp_orders(self):
  r=self.report('brands')['data'][0];self.assertEqual(r['quantity'],20);self.assertEqual(r['orders'],2)
 def test_closed_spellings_and_dispatched_unified(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET uc_order_status='COMPLETE' WHERE id=1002");self.raw('UPDATE sa_snapshot_20261019.sa_items SET dispatched_status=1 WHERE id=2002');r=self.report('brands')['data'][0];self.assertEqual(r['closed_quantity'],20);self.assertEqual(D(r['fill_rate']),100)
 def test_completed_filter_canonical_order_status(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1002');r=self.report('brands',{'status':'completed'})['data'][0];self.assertEqual(r['quantity'],10)
 def test_unique_customers_counts_mixed_separately(self):
  r=self.report('unique_customers');self.assertEqual(r['summary'],{'total_unique_customers':2,'custom_order_customers':2,'rmp_order_customers':2,'mixed_order_customers':2});self.assertEqual(r['data'],[])
 def test_unique_customer_with_no_item_is_not_lost(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110 WHERE id=1004");self.raw('DELETE FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1004');self.raw('DELETE FROM sa_snapshot_20261019.sa_items WHERE id=1004');self.assertEqual(self.report('unique_customers')['summary']['total_unique_customers'],3)
 def test_cancelled_not_counted_as_completed(self):
  self.assertEqual(self.metrics()['orders']['completed'],1);self.assertEqual(self.metrics()['orders']['cancelled'],1)
 def test_money_precision_and_branding_not_truncated(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET total_amount=1000.37,branding_amount=10.20,igst_amount=50.17 WHERE id=1002")
  r=self.report('rmp_items',{'item_id':'1002'})['data'][0];self.assertEqual(D(r['gross']),D('1060.74'));self.assertEqual(D(r['unit_subtotal']),D('100.037'));self.assertEqual(r['customer']['phone'],'+0910123456789')
 def test_item_amount_not_parent_order_repeated(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET total_amount=250 WHERE id=1002');r=self.report('order_items',{'item_id':'1002'})['data'][0];self.assertEqual(D(r['subtotal']),250);self.assertEqual(D(r['order_amounts']['gross']),1000);self.assertEqual(D(r['order_amounts']['difference']),750)
 def test_invalid_amounts_do_not_produce_valid_totals(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET total_amount='NaN' WHERE id=1002");r=self.report();p=next(x for x in r['data'] if x['id']=='103');self.assertTrue(p['needs_reconciliation']);self.assertIsNone(p['subtotal']);self.assertIsNone(p['closed_subtotal']);self.assertIsNone(r['summary']['subtotal'])
 def test_invalid_previous_comparison_reported(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-20' WHERE id=1001");self.raw("UPDATE sa_snapshot_20261019.sa_items SET total_amount=-1 WHERE id=1001");p=next(x for x in self.report()['data'] if x['id']=='103');self.assertTrue(p['previous_needs_reconciliation']);self.assertIsNone(p['subtotal_difference'])
 def test_zero_base_growth_undefined(self):
  r=self.report()['data'][0];self.assertIsNone(r['subtotal_growth_percent']);self.assertEqual(r['growth_basis'],'zero_base_percentage_undefined')
 def test_growth_not_clamped_at_100_percent(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-20' WHERE id=1001");r=next(x for x in self.report()['data'] if x['id']=='103');self.assertEqual(D(r['subtotal_growth_percent']),400)
 def test_kolkata_exclusive_boundary(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-23 18:30:00' WHERE id=1002");r=self.report('rmp_items',{'item_id':'1002'});self.assertEqual(len(r['data']),1);self.raw("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-30 18:30:00' WHERE id=1002");self.assertEqual(self.report('rmp_items',{'item_id':'1002'})['data'],[])
 def test_cursor_changes_require_restart(self):
  p=self.report(limit=1);self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(cursor=p['next_cursor'])
 def test_cursor_is_filter_bound(self):
  p=self.report(limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(filters={'status':'completed'},cursor=p['next_cursor'])
 def test_unknown_report_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report('users')
 def test_unknown_filter_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(filters={'sql':'anything'})
 def test_irrelevant_filter_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report('brands',{'no_orders':True})
 def test_directory_rejects_ignored_status(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report('customer_directory',{'status':'completed'})
 def test_non_admin_report_denied(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.report()
 def test_private_report_helpers_not_callable(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.sales_customer_directory('{}',999999,30)")
 def test_sc_cannot_query_other_sc(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.metrics(201)
 def test_sc_default_self(self):
  self.actor(101);self.assertEqual(self.metrics(None)['subject_id'],'101')
 def test_customer_cannot_query_coordinator_metrics(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.metrics()
 def test_pc_metrics_have_no_money_or_targets(self):
  self.actor(102);r=self.metrics();self.assertNotIn('sales',r);self.assertNotIn('targets',r);self.assertLess(r['orders']['total'],6)
 def test_sc_sales_exclude_cancelled_orders(self):
  r=self.metrics();self.assertEqual(D(r['sales']['placed']),5000);self.assertEqual(D(r['sales']['completed']),1000)
 def test_customer_directory_primary_address_and_phone(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_addresses SET is_primary=true,city='Test City' WHERE id=100");r=self.report('customer_directory',{'customer_id':'103'})['data'][0];self.assertEqual(r['address']['city'],'Test City');self.assertEqual(r['phone'],'+0910123456789');self.assertEqual(r['dealer_count'],1)
 def test_direct_customer_stale_dealer_link_ignored(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103');r=self.report('customer_directory',{'customer_id':'103'})['data'][0];self.assertEqual(r['dealer_count'],0);self.assertIsNone(r['first_dealer'])
 def test_directory_no_orders_filter(self):self.assertEqual(self.report('customer_directory',{'no_orders':True})['data'],[])
 def test_sku_report_marks_inference(self):
  r=self.report('rmp_items',{'item_id':'1002'})['data'][0]['sku'];self.assertIn('inferred',r['basis']);self.assertEqual(r['data'][0]['sku_id'],'1')
 def test_sku_ambiguity_not_duplicate_item(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_skus(id,name,rmp_class_id,rmp_brand_id,rmp_size_id,created_at,updated_at) VALUES(999,'Duplicate SKU',1,1,1,now(),now())");r=self.report('rmp_items',{'item_id':'1002'})['data'];self.assertEqual(len(r),1);self.assertEqual(r[0]['sku']['data'][0]['candidate_count'],2)
 def test_costs_current_master_basis(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_products(id,product_type,name,base_product_id,fabric_id,created_at,updated_at) VALUES(999,0,'Custom',1,1,now(),now())");self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=999 WHERE id=1001');r=self.report('custom_items',{'item_id':'1001'})['data'][0]['current_master_costs'];self.assertEqual(D(r['base_of']),20);self.assertEqual(D(r['fabric_rate']),50);self.assertEqual(r['basis'],'current_masters_not_accepted_historical_cost')
 def test_size_totals_discrepancy_visible(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=9 WHERE item_id=1002');r=self.report('rmp_items',{'item_id':'1002'})['data'][0];self.assertTrue(r['quantity_needs_reconciliation']);self.assertEqual(r['quantity'],10);self.assertEqual(r['size_quantity'],9)
 def test_feedback_from_customer_is_projected(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_ratings(rating,from_role,to_role,from_id,to_id,rating_on_type,rating_on_id,positive_comments,created_at,updated_at) VALUES(4,'Customer','SalesCoordinator',103,101,'Order',1002,'Thank you','2026-10-26','2026-10-26')");self.assertEqual(self.report('rmp_items',{'item_id':'1002'})['data'][0]['feedback']['positive_comments'],'Thank you');self.assertEqual(self.metrics()['feedback']['count'],1)
 def test_deleted_orders_excluded(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET is_deleted=true WHERE id=1002');self.assertEqual(self.report('rmp_items',{'item_id':'1002'})['data'],[])
 def test_page_limit_bounded(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.report(limit=101)

 def test_negative_tax_component_not_hidden_by_other_tax(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET cgst_amount=-1,sgst_amount=10 WHERE id=1002');r=self.report('rmp_items',{'item_id':'1002'})['data'][0];self.assertIsNone(r['tax']);self.assertIsNone(r['gross']);self.assertTrue(self.report('brands')['data'][0]['needs_reconciliation'])
 def test_invalid_quantity_nulls_fill_rates(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET total_quantity=-1 WHERE id=1002');r=self.report('brands')['data'][0];self.assertIsNone(r['fill_rate']);self.assertIsNone(r['customer_fill_rate']);self.assertIsNone(r['quantity'])
 def test_created_at_fallback_when_source_date_missing(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET created_on=NULL,created_at='2026-10-26' WHERE id=1002");self.assertEqual(len(self.report('rmp_items',{'item_id':'1002'})['data']),1)
 def test_previous_comparisons_persist_across_customer_pages(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-20' WHERE id IN(1001,2001)");p=self.report(limit=1);q=self.report(cursor=p['next_cursor'],limit=1);self.assertEqual(D(p['data'][0]['previous_subtotal']),1000);self.assertEqual(D(q['data'][0]['previous_subtotal']),1000)

 def test_all_nonfinite_numeric_values_are_rejected_by_projection(self):
  for value in ['NaN','Infinity','-Infinity']:
   with self.subTest(value=value):
    self.raw('UPDATE sa_snapshot_20261019.sa_items SET total_amount=%s::numeric WHERE id=1002',(value,));self.assertIsNone(self.report('rmp_items',{'item_id':'1002'})['data'][0]['subtotal']);self.assertTrue(self.report('brands')['data'][0]['needs_reconciliation'])

 def test_report_labels_resolve_the_correct_group_kind(self):
  self.assertEqual(self.report('brands')['data'][0]['name'],'Brand A');self.assertEqual(self.report('classes')['data'][0]['name'],'Classic A');self.assertEqual(self.report('coordinators')['data'][0]['name'],'Persona 201');self.assertEqual(self.report('customers')['data'][0]['name'],'Persona 203')
