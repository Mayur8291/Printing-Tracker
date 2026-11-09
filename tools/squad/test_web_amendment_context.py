"""Lossless amendment size context and existing design ownership remain scoped."""
import unittest
import psycopg
from fixtures import rpc
from test_pricing import custom
import test_order_amendments as source

class AmendmentContext(unittest.TestCase):
 setUpClass=classmethod(source.Amendments.setUpClass.__func__)
 setUp=source.Amendments.setUp;tearDown=source.Amendments.tearDown;actor=source.Amendments.actor;raw=source.Amendments.raw
 preset=source.Amendments.preset;quote=source.Amendments.quote;place=source.Amendments.place;design=source.Amendments.design
 branded_order=source.Amendments.branded_order;edit=source.Amendments.edit
 def test_original_size_type_label_in_list_and_detail(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET size_type='Legacy tailored fit' WHERE id=%s",(self.item,))
  self.assertEqual(rpc(self.c,'v1_order_get',(self.id,))['items']['data'][0]['size_type'],'Legacy tailored fit')
  self.assertEqual(rpc(self.c,'v1_order_item_get',(self.item,))['size_type'],'Legacy tailored fit')
 def test_null_original_size_type_is_explicit_not_defaulted(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET size_type=NULL WHERE id=%s',(self.item,))
  self.assertIsNone(rpc(self.c,'v1_order_item_get',(self.item,))['size_type'])
 def test_foreign_customer_cannot_obtain_context(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_item_get',(self.item,))
 def test_projection_is_not_public_rpc(self):
  self.assertFalse(self.raw("SELECT has_function_privilege('authenticated','sa_domain.item_projection(jsonb,sa_domain.actor,text)','execute')")[0][0])
 def test_authorized_existing_design_preserves_media_chain(self):
  design=self.branded_order();line=custom(10);line['brandings']=[design];result=self.edit(self.quote([line]));new_item=int(result['items'][0]['item_id'])
  self.assertEqual(self.raw('SELECT parent_id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s',(new_item,)),[(int(design['design_id']),)])
  self.assertEqual(self.raw("SELECT count(*) FROM sa_media.references WHERE resource='brandings' AND status='ready' AND record_id IN(SELECT id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s)",(new_item,)),[(1,)])
 def test_foreign_existing_design_rejected_for_amendment_quote(self):
  self.actor(203);design=self.design(True);self.actor(101);line=custom(10);line['brandings']=[design]
  with self.assertRaises(psycopg.errors.NoDataFound):self.quote([line])

if __name__=='__main__':unittest.main(verbosity=2)
