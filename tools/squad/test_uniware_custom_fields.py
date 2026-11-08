"""Actual placement/amendment evidence for legacy Uniware metadata parity."""
import decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_warehouse_amendments as amendments
from test_pricing import rmp

class UniwareCustomFields(unittest.TestCase):
 @classmethod
 def setUpClass(cls):amendments.WarehouseAmendments.setUpClass()
 def setUp(self):self.f=amendments.WarehouseAmendments();self.f.setUp();self.f.use_uniware()
 def tearDown(self):self.f.tearDown()
 def place(self,comments=('First print','Second print'),due='2026-11-30T20:00:00Z'):
  f=self.f;f.actor(103);q=rpc(f.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(2) for _ in comments]}),));details={'due_at':due,'line_settings':{str(i+1):{'comment':v} for i,v in enumerate(comments)}}
  result=rpc(f.c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb(details),uuid.uuid4()));f.oid=int(result['orders'][0]['id']);j=f.claim()[0];return j,f.prepare(j),q
 def fields(self,p):return {x['name']:x['value'] for x in p['payload']['saleOrder']['customFieldValues']}
 def test_initial_fields_match_legacy_customer_local_date_and_ordered_comments(self):
  f=self.f;j,p,q=self.place();fields=self.fields(p);expected=f.raw("SELECT coalesce(nullif(btrim(customer_company_name),''),name) FROM sa_snapshot_20261019.sa_users WHERE id=103")[0][0]
  self.assertEqual(fields,{'Customer_Details':expected,'PICKUPDATE':'01/12/26','Comment':'First print, Second print'});lines=p['payload']['saleOrder']['saleOrderItems'];self.assertEqual([x['customFieldValues'][0]['value'] for x in lines],[' : First print']*2+[' : Second print']*2);self.assertEqual(sum(decimal.Decimal(str(x['sellingPrice'])) for x in lines),decimal.Decimal(q['total']))
 def test_blank_comments_are_omitted_from_aggregate_and_empty_per_piece(self):
  _,p,_=self.place(('',' \t\n',' preserved '));self.assertEqual(self.fields(p)['Comment'],' preserved ');self.assertEqual([x['customFieldValues'][0]['value'] for x in p['payload']['saleOrder']['saleOrderItems']],['']*4+[' :  preserved ']*2)
 def test_retry_uses_frozen_metadata_despite_current_source_changes(self):
  f=self.f;j,p,_=self.place();f.raw("UPDATE sa_snapshot_20261019.sa_items SET comment='Changed later' WHERE order_id=%s",(f.oid,));f.raw("UPDATE sa_snapshot_20261019.sa_orders SET due_on='2027-01-01' WHERE id=%s",(f.oid,));self.assertEqual(f.prepare(j)['payload'],p['payload'])
 def test_amendment_replacement_uses_new_accepted_comment_and_due_date(self):
  f=self.f;j,p,_=self.place(('Old comments',));self.assertEqual(f.finish(j,f.ack(p,'CREATED'))['state'],'done');version=f.version();q=rpc(f.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(6)]}),));result=rpc(f.c,'v1_order_edit',(f.oid,uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-02T20:00:00Z','line_settings':{'1':{'comment':'Replacement notes'}}}),'Requested replacement',version,uuid.uuid4()));f.rid=uuid.UUID(result['request_id']);j=f.claim()[0];p=f.prepare(j);obs=f.observed(p);obs['proof']['items']=obs['proof']['items'][:2];self.assertEqual(f.finish(j,obs)['state'],'pending');j=f.claim()[0];p=f.prepare(j);self.assertEqual(f.finish(j,f.cancel_ack(p))['state'],'pending');j=f.claim()[0];p=f.prepare(j);self.assertEqual(self.fields(p)['Comment'],'Replacement notes');self.assertEqual(self.fields(p)['PICKUPDATE'],'03/12/26');self.assertTrue(all(x['customFieldValues'][0]['value']==' : Replacement notes' for x in p['payload']['saleOrder']['saleOrderItems']));self.assertEqual(f.finish(j,f.ack(p,'CREATED'))['state'],'done');self.assertEqual(f.raw('SELECT comment FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(f.oid,)),[('Replacement notes',)])
 def test_piece_comments_keep_unicode_and_legacy_350_character_limit(self):
  _,p,_=self.place(('é'*400,));self.assertEqual(p['payload']['saleOrder']['saleOrderItems'][0]['customFieldValues'][0]['value'],' : '+'é'*347);self.assertEqual(self.fields(p)['Comment'],'é'*400)
 def test_pickup_date_does_not_depend_on_worker_session_timezone(self):
  self.f.raw("SET LOCAL timezone='America/Los_Angeles'");_,p,_=self.place();self.assertEqual(self.fields(p)['PICKUPDATE'],'01/12/26')
 def test_dashboard_payload_has_no_uniware_custom_fields(self):
  f=self.f;f.provider='dashboard';f.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='true' WHERE key='use_dashboard'");f.raw("UPDATE sa_domain.warehouse_config SET provider='dashboard'");_,p,_=self.place();self.assertNotIn('customFieldValues',p['payload']);self.assertNotIn('saleOrder',p['payload'])
 def test_maximum_accepted_line_comments_keep_full_order_aggregate(self):
  _,p,_=self.place(tuple('x'*4000 for _ in range(50)));comment=self.fields(p)['Comment'];self.assertEqual(comment,', '.join(['x'*4000]*50));self.assertEqual(len(comment),200098);self.assertEqual(len(p['payload']['saleOrder']['saleOrderItems']),100)
 def test_private_helpers_cannot_be_called_by_browser_or_service(self):
  f=self.f
  for role in ['sa_app','service_role']:
   f.actor(103,role)
   for query in ["SELECT sa_domain.uniware_piece_comment('x')","SELECT sa_domain.uniware_custom_fields('x',now(),'[]')"]:
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
     with f.c.transaction():f.c.execute(query)

if __name__=='__main__':unittest.main(verbosity=2)
