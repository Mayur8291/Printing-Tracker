"""Actual Dealer-owned pure RMP/mixed branches used by the browser adapter."""
import unittest,uuid
from decimal import Decimal
import psycopg
from psycopg.types.json import Jsonb
import test_persona_finance_parity as finance
from fixtures import rpc
from test_pricing import CONFIG,custom,rmp

class DealerCommercialScope(unittest.TestCase):
 setUpClass=classmethod(finance.PersonaFinance.setUpClass.__func__)
 setUp=finance.PersonaFinance.setUp
 tearDown=finance.PersonaFinance.tearDown
 actor=finance.PersonaFinance.actor
 def test_pc_denied_pure_rmp_but_mixed_selling_visible_payment_private(self):
  self.c.execute('RESET ROLE');self.c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,address,state,city,created_at,updated_at) VALUES(1100,110,'Owned Dealer test','Karnataka','Fixture',now(),now())")
  for mixed in [False,True]:
   self.actor(110);lines=[custom(2),rmp(3)] if mixed else [rmp(3)]
   quote=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'110','address_id':'1100','lines':lines}),))
   details={'due_at':'2026-12-10T07:00:00Z'}
   if mixed:
    preset=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Dealer mixed test','',uuid.uuid4()));details['line_settings']={'1':{'product_id':preset['id']}}
   placed=rpc(self.c,'v1_order_place',(uuid.UUID(quote['quote_id']),quote['version'],Jsonb(details),uuid.uuid4()))['orders']
   self.assertEqual(len(placed),1);oid=int(placed[0]['id']);own=rpc(self.c,'v1_order_get',(oid,));self.assertEqual(own['customer_id'],'110');self.assertEqual(Decimal(own['total_amount']),Decimal(quote['total']))
   self.actor(102)
   if mixed:
    visible=rpc(self.c,'v1_order_get',(oid,));self.assertEqual(Decimal(visible['total_amount']),Decimal(quote['total']));self.assertNotIn('paid_amount',visible);self.assertNotIn('payment_status',visible)
   else:
    with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():rpc(self.c,'v1_order_get',(oid,))
   self.actor(103)
   with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():rpc(self.c,'v1_order_get',(oid,))

if __name__=='__main__':unittest.main(verbosity=2)
