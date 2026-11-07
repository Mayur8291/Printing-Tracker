import json,unittest
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc

class ScopedReads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_orders(c)
    def setUp(self):self.c=connect();self.c.execute('BEGIN')
    def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
    def test_people_scope_before_page(self):
        session(self.c,101)
        p=rpc(self.c,'v1_people_list',(None,'',None,1))
        self.assertEqual(p['data'][0]['id'],'110')
        p2=rpc(self.c,'v1_people_list',(None,'',p['next_cursor'],1))
        self.assertEqual(p2['data'][0]['id'],'103')
        p3=rpc(self.c,'v1_people_list',(None,'',p2['next_cursor'],1))
        self.assertEqual(p3['data'][0]['id'],'101');self.assertIsNone(p3['next_cursor'])
    def test_cross_scope_person_is_unavailable(self):
        session(self.c,101)
        with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_person_get',(203,))
    def test_customer_cannot_browse_directory(self):
        session(self.c,103)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_people_list')
    def test_factory_directory_and_pii_projection(self):
        session(self.c,108);data=rpc(self.c,'v1_people_list')['data']
        self.assertEqual({int(x['id']) for x in data},{104,105,106,107,108,109})
        self.assertNotIn('email',next(x for x in data if x['id']=='104'))
    def test_cursor_cannot_cross_actor(self):
        session(self.c,101);p=rpc(self.c,'v1_people_list',(None,'',None,1));self.c.execute('RESET ROLE');session(self.c,201)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_people_list',(None,'',p['next_cursor'],1))
    def test_cursor_cannot_change_filter(self):
        session(self.c,100);p=rpc(self.c,'v1_people_list',(None,'',None,1))
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_people_list',(3,'',p['next_cursor'],1))
    def test_bounded_pages(self):
        session(self.c,100)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_orders_list',(Jsonb({}),None,101))
    def test_all_order_persona_scopes(self):
        expected={100:set(range(1001,1007))|set(range(2001,2007)),101:set(range(1001,1007)),
          102:{1001,1003,1005,1006,2001,2003,2005,2006},103:set(range(1001,1007)),104:set(range(1001,1007)),
          107:set(range(1001,1007)),108:set(range(1001,1007)),109:set(range(1001,1007)),110:{1004},111:set(range(1001,1007))}
        for actor,ids in expected.items():
            session(self.c,actor)
            data=rpc(self.c,'v1_orders_list')['data'];self.assertEqual({int(o['id']) for o in data},ids,actor)
            self.c.execute('RESET ROLE')
    def test_orders_and_dashboard_share_scope_and_status(self):
        session(self.c,103)
        for state,expected in [('pending',4),('completed',1),('cancelled',1)]:
            filters=Jsonb({'state':state})
            self.assertEqual(len(rpc(self.c,'v1_orders_list',(filters,))['data']),expected)
            self.assertEqual(rpc(self.c,'v1_dashboard',(filters,))['orders'],expected)
    def test_customer_order_fields_redacted(self):
        session(self.c,103);order=rpc(self.c,'v1_order_get',(1001,))
        self.assertIn('total_amount',order);self.assertNotIn('factory_manager_id',order)
        item=order['items']['data'][0];self.assertNotIn('worker_unit_cost',item);self.assertEqual(item['quantities'][0]['quantity'],10)
        self.assertTrue(order['created_at'].endswith('Z'))
    def test_production_order_fields_redacted(self):
        session(self.c,102);order=rpc(self.c,'v1_order_get',(1001,))
        self.assertNotIn('total_amount',order);self.assertEqual(order['items']['data'][0]['worker_unit_cost'],'40')
    def test_foreign_order_detail_denied(self):
        session(self.c,103)
        with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_get',(2001,))
    def test_unknown_order_filters_rejected(self):
        session(self.c,103)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_orders_list',(Jsonb({'actor_id':100}),))
    def test_null_order_filter_rejected(self):
        session(self.c,103)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_orders_list',(Jsonb({'state':None}),))
    def test_customer_name_search_does_not_broaden_scope(self):
        session(self.c,103)
        self.assertEqual(len(rpc(self.c,'v1_orders_list',(Jsonb({'search':'Persona 103'}),))['data']),6)
        self.assertEqual(rpc(self.c,'v1_orders_list',(Jsonb({'search':'Persona 203'}),))['data'],[])
    def test_detail_items_are_paged(self):
        self.c.execute("INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,created_at,updated_at) VALUES(3000,1001,now(),now())")
        session(self.c,103)
        result=rpc(self.c,'v1_order_get',(1001,None,1))
        self.assertEqual(len(result['items']['data']),1);self.assertEqual(result['items']['data'][0]['id'],'3000')
        more=rpc(self.c,'v1_order_get',(1001,result['items']['next_cursor'],1))
        self.assertEqual(more['items']['data'][0]['id'],'1001');self.assertIsNone(more['items']['next_cursor'])
    def test_order_query_is_inlined(self):
        session(self.c,103);self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_executor')
        plan=self.c.execute("EXPLAIN(FORMAT JSON) SELECT id FROM sa_domain.filtered_orders('{}') WHERE id<1006 ORDER BY id DESC LIMIT 2").fetchone()[0]
        self.assertNotIn('filtered_orders',json.dumps(plan))

if __name__=='__main__':unittest.main(verbosity=2)
