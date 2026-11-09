"""Real bounded seek pages, nulls and equal timestamps across persona scopes."""
import unittest,base64,json
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc
class OrderDueSort(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET due_on=CASE id WHEN 1001 THEN '2027-01-03'::timestamp WHEN 1002 THEN '2027-01-01'::timestamp WHEN 1003 THEN '2027-01-01'::timestamp ELSE NULL END,created_at=CASE id WHEN 1001 THEN '2026-12-01'::timestamp WHEN 1002 THEN '2026-12-03'::timestamp WHEN 1003 THEN '2026-12-03'::timestamp ELSE '2026-12-02'::timestamp END WHERE id BETWEEN 1001 AND 1006")
  session(self.c,103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def page(self,sort='due_asc',cursor=None,limit=2,extra=None):return rpc(self.c,'v1_orders_list',(Jsonb({**(extra or {}),**({'sort':sort} if sort else {})}),cursor,limit))
 def all(self,sort,extra=None):
  result=[];cursor=None
  for _ in range(5):
   p=self.page(sort,cursor,extra=extra);self.assertLessEqual(len(p['data']),2);result.extend(int(x['id']) for x in p['data']);cursor=p['next_cursor']
   if cursor is None:return result
  self.fail('Cursor did not terminate')
 def test_due_order_equal_dates_and_nulls_seek_without_duplicates(self):self.assertEqual(self.all('due_asc'),[1002,1003,1001,1004,1005,1006])
 def test_created_order_uses_timestamp_and_id_desc_tiebreak(self):self.assertEqual(self.all('created_desc'),[1003,1002,1006,1005,1004,1001])
 def test_null_due_bucket_and_real_infinity_are_distinct(self):
  self.c.execute('RESET ROLE');self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET due_on='infinity' WHERE id=1003");session(self.c,103)
  self.assertEqual(self.all('created_desc'),[1003,1002,1006,1005,1004,1001])
  self.assertEqual(self.all('due_asc'),[1002,1001,1003,1004,1005,1006])
 def test_null_bucket_cursor_requires_explicit_boolean(self):
  cursor=self.page()['next_cursor'];decoded=json.loads(base64.b64decode(cursor))
  for value in [None,'false',{},4]:
   bad=base64.b64encode(json.dumps({**decoded,'after_null':value}).encode()).decode()
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(cursor=bad)
 def test_omitted_sort_preserves_default_id_desc(self):self.assertEqual(self.all(None),[1006,1005,1004,1003,1002,1001])
 def test_filter_combination_keeps_source_scope(self):
  self.assertEqual(self.all('due_asc',{'state':'pending'}),[1002,1003,1001,1004]);self.assertEqual(self.all('due_asc',{'customer_id':'203'}),[])
 def test_cursor_rejects_sort_actor_filter_and_generation_changes(self):
  cursor=self.page()['next_cursor']
  for sort,extra in [('created_desc',None),('due_asc',{'state':'pending'})]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(sort,cursor,extra=extra)
  self.c.execute('RESET ROLE');session(self.c,203)
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(cursor=cursor)
  self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1');session(self.c,103)
  with self.assertRaises(psycopg.Error):self.page(cursor=cursor)
 def test_invalid_sort_missing_and_malformed_time_cursor(self):
  for sort in ['invalid','due_on desc;select1',None,4]:
   if sort is None:continue
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(sort)
  cursor=self.page()['next_cursor'];decoded=json.loads(base64.b64decode(cursor))
  for value in [None,{},'nonsense']:
   bad=base64.b64encode(json.dumps({**decoded,'after_time':value}).encode()).decode()
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(cursor=bad)
 def test_dealer_order_scope_is_preserved_with_sort(self):
  self.c.execute('RESET ROLE');session(self.c,110);self.assertEqual(self.all('due_asc'),[1004])
 def test_bounded_limit_and_no_extra_projection(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(limit=101)
  r=self.page()['data'][0];self.assertNotIn('factory_manager_id',r);self.assertNotIn('encrypted_password',r)
 def test_due_seek_query_is_inlined_and_index_available(self):
  self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_executor');self.c.execute('SET LOCAL enable_seqscan=off')
  plan=self.c.execute("EXPLAIN(FORMAT JSON) SELECT id FROM sa_domain.filtered_orders('{}') o WHERE(due_on,id)>('2027-01-01'::timestamp,1002) ORDER BY due_on,id LIMIT 2").fetchone()[0]
  text=json.dumps(plan);self.assertNotIn('Function Scan',text);self.assertIn('squad_orders_due_seek',text)
if __name__=='__main__':unittest.main(verbosity=2)
