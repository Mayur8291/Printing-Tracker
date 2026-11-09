"""Additive display labels remain behind existing relationship/stock authorization."""
import unittest
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session, rpc
from local_db import connect
from test_catalogue import seed_catalogue


class CommerceDisplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as connection: seed_catalogue(connection)

    def setUp(self):
        self.c=connect();self.c.execute('BEGIN')
        self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET phone='1234567890' WHERE id=101")
        self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET phone='9876543210' WHERE id=110")
        self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110 WHERE id=1001')
        self.c.execute("UPDATE sa_snapshot_20261019.sa_sizes SET name='Canonical stock size' WHERE id=1")
        self.c.execute("UPDATE sa_snapshot_20261019.sa_rmp_sizes SET name='Different RMP namespace' WHERE id=1")
        self.c.execute('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(110,1001,1001,1,0,10,1,1,1,now(),now())')
        session(self.c,103)

    def tearDown(self): self.c.execute('ROLLBACK');self.c.close()
    def person(self,id=103): return rpc(self.c,'v1_person_get',(id,))
    def stock(self): return rpc(self.c,'v1_dealer_stock',(110,103,Jsonb({'rmp_class_id':'1'}),None,30))
    def actor(self,id): self.c.execute('RESET ROLE');session(self.c,id)

    def test_own_relationship_names_and_assigned_coordinator_only(self):
        person=self.person()
        self.assertEqual([r['id'] for r in person['linked_dealers']], ['110'])
        self.assertTrue(person['linked_dealers'][0]['name'])
        self.assertEqual(set(person['linked_dealers'][0]), {'id','name','phone'})
        self.assertEqual(person['linked_dealers'][0]['phone'],'9876543210')
        self.assertEqual(person['coordinator_contact']['id'],'101')
        self.assertEqual(person['coordinator_contact']['phone'],'1234567890')

    def test_foreign_customer_cannot_get_contact_or_stock_labels(self):
        self.actor(203)
        with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.person(103)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.stock()

    def test_stock_uses_canonical_size_namespace_and_no_physical_totals(self):
        stock=self.stock()['data'][0]
        self.assertEqual(stock['size_name'],'Canonical stock size')
        self.assertTrue(stock['product_name']);self.assertTrue(stock['brand_name'])
        for field in ('received','consumed','receipt_count'):self.assertNotIn(field,stock)

    def test_removed_link_removes_label_and_stock_authority(self):
        self.c.execute('RESET ROLE');self.c.execute('DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=103');session(self.c,103)
        self.assertEqual(self.person()['linked_dealers'],[])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.stock()

    def test_disabled_contacts_not_exposed(self):
        self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id IN(101,110)');session(self.c,103)
        person=self.person();self.assertEqual(person['linked_dealers'],[]);self.assertIsNone(person['coordinator_contact'])

    def test_sales_coordinator_scope_preserved(self):
        self.actor(101);self.assertEqual(self.person()['coordinator_contact']['id'],'101');self.assertEqual(self.stock()['data'][0]['size_name'],'Canonical stock size')
        self.actor(201)
        with self.assertRaises(psycopg.errors.NoDataFound):self.person(103)


if __name__=='__main__':unittest.main(verbosity=2)
