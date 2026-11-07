"""Order acceptance invariants: scoped designs, financial totals and atomic retries."""
import concurrent.futures,copy,decimal,threading,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_pricing import CONFIG,custom,rmp
D=decimal.Decimal
SPEC={'type':'print','side':'front','width':'2','height':'3','unit':'inch'}

class Orders(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100")
  self.n=103;session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;session(self.c,self.n);return rows
 def preset(self,config=None):return rpc(self.c,'v1_product_configure',(Jsonb(config or CONFIG),'Acceptance test','',uuid.uuid4()))
 def quote(self,lines=None):return rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':lines or [rmp()]}),))
 def place(self,q,details=None,key=None):
  d={'due_at':'2026-12-01T12:30:00+05:30'};d.update(details or {})
  return rpc(self.c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb(d),key or uuid.uuid4()))
 def design(self,ready=False):
  d=rpc(self.c,'v1_branding_save',(None,None,Jsonb(SPEC),None,uuid.uuid4()))
  if ready:
   self.raw("UPDATE sa_snapshot_20261019.sa_brandings SET image='design.png' WHERE id=%s",(int(d['id']),))
   self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status,sha256) VALUES('brandings',%s,'image','design.png','ready',%s)",(int(d['id']),'a'*64))
  return dict(SPEC,design_id=d['id'],design_version=d['version'])
 def split_setup(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id,created_at,updated_at) VALUES(103,210,now(),now())')
  self.raw('INSERT INTO sa_snapshot_20261019.sa_assigned_brands(user_id,authorized_brand_id,created_at,updated_at) VALUES(210,2,now(),now())')
  return [rmp(),{'kind':'rmp','skus':[{'sku_id':'2','quantity':7}]}]
 def test_rmp_submission_returns_all_items_and_exact_totals(self):
  q=self.quote();r=self.place(q);self.assertEqual(len(r['orders']),1);self.assertEqual(D(r['total_amount']),D(q['total']))
  o=r['orders'][0];self.assertEqual(o['integration_status'],'queued');self.assertEqual(len(o['items']),1)
  self.assertEqual(rpc(self.c,'v1_order_get',(int(o['id']),))['id'],o['id'])
  row=self.raw('SELECT customer_sc_id,customer_dealer_id,created_by_id,payment_status,due_on FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(int(o['id']),))[0]
  self.assertEqual(row[:4],(101,110,103,1));self.assertEqual(row[4].hour,7)
 def test_custom_requires_exact_visible_preset(self):
  p=self.preset();q=self.quote([custom()]);r=self.place(q,{'line_settings':{'1':{'product_id':p['id']}}})
  item=int(r['orders'][0]['items'][0]['item_id']);self.assertEqual(self.raw('SELECT product_id FROM sa_snapshot_20261019.sa_items WHERE id=%s',(item,))[0][0],int(p['id']))
  criteria=self.raw('SELECT c.name FROM sa_snapshot_20261019.sa_item_criteria i JOIN sa_snapshot_20261019.sa_criteria c ON c.id=i.criteria_id WHERE i.item_id=%s ORDER BY c.name',(item,))
  self.assertEqual(criteria,[('Fabric',),('Trims',)])
 def test_roundtrip_canonical_configuration_is_accepted(self):
  p=self.preset();canonical=rpc(self.c,'v1_presets_list',(Jsonb({'id':p['id']}),))['data'][0]['configuration'];q=self.quote([custom(config=canonical)])
  self.assertTrue(self.place(q,{'line_settings':{'1':{'product_id':p['id']}}})['orders'])
 def test_wrong_preset_rejected(self):
  config=copy.deepcopy(CONFIG);config['category_id']='2';p=self.preset(config);q=self.quote([custom()])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(q,{'line_settings':{'1':{'product_id':p['id']}}})
 def test_other_customer_preset_rejected(self):
  self.actor(203);p=self.preset();self.actor(103);q=self.quote([custom()])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(q,{'line_settings':{'1':{'product_id':p['id']}}})
 def test_same_key_returns_original_orders_once(self):
  q=self.quote();key=uuid.uuid4();r=self.place(q,key=key);self.assertEqual(r,self.place(q,key=key))
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(key,))[0][0],1)
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox WHERE command_key=%s',(key,))[0][0],1)
 def test_accepted_quote_cannot_create_again_with_new_key(self):
  q=self.quote();self.place(q)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.place(q)
 def test_different_payload_same_key_rejected(self):
  q=self.quote();key=uuid.uuid4();self.place(q,key=key)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(q,{'comment':'Changed'},key)
 def test_expired_quote_rejected(self):
  q=self.quote();self.raw("UPDATE sa_domain.quotes SET expires_at=now()-interval '1 second'")
  with self.assertRaises(psycopg.errors.SerializationFailure):self.place(q)
 def test_changed_price_rejected(self):
  q=self.quote();self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET price=81 WHERE id=2')
  with self.assertRaises(psycopg.errors.SerializationFailure):self.place(q)
 def test_changed_address_rejected(self):
  q=self.quote();self.raw("UPDATE sa_snapshot_20261019.sa_addresses SET state='Maharashtra' WHERE id=100")
  with self.assertRaises(psycopg.errors.SerializationFailure):self.place(q)
 def test_other_actor_quote_is_invisible(self):
  q=self.quote();self.actor(101)
  with self.assertRaises(psycopg.errors.NoDataFound):self.place(q)
 def test_production_roles_cannot_place(self):
  q=self.quote();self.actor(102)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.place(q)
 def test_mirror_fence(self):
  q=self.quote();self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.place(q)
 def test_split_brands_returns_both_and_reconciles_money(self):
  self.actor(101);q=self.quote(self.split_setup());r=self.place(q,{'payment':{'status':'partial','paid_amount':'13.37'}})
  self.assertEqual(len(r['orders']),2);self.assertEqual(sum(D(o['total_amount']) for o in r['orders']),D(q['total']));self.assertEqual(sum(D(o['paid_amount']) for o in r['orders']),D('13.37'))
  self.assertEqual({x[0] for x in self.raw('SELECT customer_dealer_id FROM sa_snapshot_20261019.sa_orders WHERE id=ANY(%s)',([int(o['id']) for o in r['orders']],))},{110,210})
 def test_split_branding_included_in_totals_and_copied(self):
  lines=self.split_setup();design=self.design(True)
  for line in lines:line['brandings']=[design]
  q=self.quote(lines);r=self.place(q);self.assertEqual(sum(D(x['total_amount']) for x in r['orders']),D(q['total']))
  ids=[int(o['items'][0]['item_id']) for o in r['orders']]
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_brandings WHERE item_id=ANY(%s)',(ids,))[0][0],2)
  self.assertEqual(self.raw("SELECT count(*) FROM sa_media.references r JOIN sa_snapshot_20261019.sa_brandings b ON r.resource='brandings' AND r.record_id=b.id WHERE b.item_id=ANY(%s) AND r.sha256=%s",(ids,'a'*64))[0][0],2)
 def test_missing_brand_dealer_rolls_back_all(self):
  q=self.quote([rmp(),{'kind':'rmp','skus':[{'sku_id':'2','quantity':7}]}])
  before=self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_orders')[0][0]
  with self.c.transaction():
   try:self.place(q)
   except psycopg.errors.InvalidParameterValue:raise psycopg.Rollback()
   else:self.fail('Missing dealer accepted')
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_orders')[0][0],before)
 def test_mixed_order_does_not_split(self):
  lines=self.split_setup();p=self.preset();lines.append(custom());q=self.quote(lines)
  r=self.place(q,{'line_settings':{'3':{'product_id':p['id']}}});self.assertEqual(len(r['orders']),1);self.assertEqual(len(r['orders'][0]['items']),3)
 def test_customer_cannot_mark_payment(self):
  q=self.quote()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.place(q,{'payment':{'status':'paid'}})
 def test_partial_cannot_equal_total(self):
  self.actor(101);q=self.quote()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(q,{'payment':{'status':'partial','paid_amount':q['total']}})
 def test_override_survives_acceptance(self):
  self.actor(101);q=self.quote();q=rpc(self.c,'v1_quote_override',(uuid.UUID(q['quote_id']),1,D('42.37'),'Commercial approval',q['version'],uuid.uuid4()))
  r=self.place(q,{'payment':{'status':'paid'}});self.assertEqual(D(r['paid_amount']),D(q['total']));self.assertEqual(D(r['total_amount']),D(q['total']))
 def test_rmp_size_maps_by_name_not_numeric_id(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_sizes SET name='Different size' WHERE id=1")
  self.raw("SELECT setval('sa_snapshot_20261019.sa_sizes_id_seq',100)")
  q=self.quote();r=self.place(q);item=int(r['orders'][0]['items'][0]['item_id'])
  size=self.raw('SELECT s.id,s.name FROM sa_snapshot_20261019.sa_quantities q JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE q.item_id=%s',(item,))[0]
  self.assertNotEqual(size[0],1);self.assertEqual(size[1],'M')
 def test_sample_keeps_bulk_plan_and_sample_quantity(self):
  p=self.preset();line=custom(10);line['sample']={'size_id':'1','quantity':1};q=self.quote([line])
  r=self.place(q,{'line_settings':{'1':{'product_id':p['id']}}});item=int(r['orders'][0]['items'][0]['item_id'])
  self.assertEqual(self.raw('SELECT quantity FROM sa_snapshot_20261019.sa_quantities WHERE item_id=%s',(item,)),[(1,)])
  self.assertEqual(self.raw('SELECT quantity FROM sa_snapshot_20261019.sa_extra_quantities WHERE item_id=%s',(item,)),[(10,)])
 def test_missing_art_file_denies_order(self):
  line=rmp();line['brandings']=[self.design()];q=self.quote([line])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(q)
 def test_no_design_id_preview_is_allowed_but_order_is_not(self):
  line=rmp();line['brandings']=[SPEC];q=self.quote([line])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(q)
 def test_foreign_design_cannot_be_quoted(self):
  self.actor(203);d=self.design(True);self.actor(103);line=rmp();line['brandings']=[d]
  with self.assertRaises(psycopg.errors.NoDataFound):self.quote([line])
 def test_changed_design_version_rejected(self):
  d=self.design(True);line=rmp();line['brandings']=[d];q=self.quote([line]);spec=dict(SPEC,comment='Changed')
  rpc(self.c,'v1_branding_save',(int(d['design_id']),None,Jsonb(spec),d['design_version'],uuid.uuid4()))
  with self.assertRaises(psycopg.errors.SerializationFailure):self.place(q)
 def test_arbitrary_source_url_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_branding_save',(None,None,Jsonb(dict(SPEC,image='https://outside.invalid/file')),None,uuid.uuid4()))
 def test_unzoned_due_date_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(self.quote(),{'due_at':'2026-12-01T12:30:00'})
 def test_unknown_line_setting_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.place(self.quote(),{'line_settings':{'2':{}}})
 def test_dealer_routes_own_linked_customer_to_self(self):
  self.actor(110);q=self.quote();r=self.place(q)
  self.assertEqual(self.raw('SELECT customer_dealer_id FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(int(r['orders'][0]['id']),)),[(110,)])
 def test_direct_customer_has_no_dealer(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103');r=self.place(self.quote())
  self.assertEqual(self.raw('SELECT customer_dealer_id FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(int(r['orders'][0]['id']),)),[(None,)])
 def test_apportionment_never_loses_cents_or_overpays_child(self):
  for amounts in [('0.01','0.01','0.01'),('12.33','0.01','99.99'),('0.00','0.01')]:
   total=sum(map(D,amounts));groups=[{'total':n} for n in amounts]
   for paid in [D('0'),D('.01'),total]:
    result=self.raw('SELECT sa_domain.allocate_order_payment(%s,%s,%s)',(Jsonb(groups),paid,total))[0][0]
    self.assertEqual(sum(D(x['paid_amount']) for x in result),paid)
    self.assertTrue(all(0<=D(x['paid_amount'])<=D(x['total']) for x in result))

class ConcurrentOrders(unittest.TestCase):
 def test_one_quote_can_be_accepted_by_only_one_command(self):
  barrier=threading.Barrier(2);keys=[uuid.uuid4(),uuid.uuid4()];q=None
  with connect() as c:
   seed_catalogue(c);original=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
   with c.transaction():
    c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100")
    session(c,103);q=rpc(c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp()]}),))
  def place(key):
   try:
    with connect() as c,c.transaction():
     session(c,103);barrier.wait(timeout=3)
     return rpc(c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-01T00:00:00Z'}),key))
   except psycopg.errors.SerializationFailure:return 'conflict'
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(place,keys))
   self.assertEqual(results.count('conflict'),1);self.assertEqual(sum(len(r['orders']) for r in results if isinstance(r,dict)),1)
  finally:
   with connect() as c,c.transaction():
    ids=[r[0] for r in c.execute('SELECT order_id FROM sa_domain.order_receipts WHERE quote_id=%s',(uuid.UUID(q['quote_id']),))]
    c.execute('DELETE FROM sa_snapshot_20261019.sa_quantities WHERE item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=ANY(%s))',(ids,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_items WHERE order_id=ANY(%s)',(ids,))
    c.execute('DELETE FROM sa_domain.order_receipts WHERE order_id=ANY(%s)',(ids,));c.execute('DELETE FROM sa_snapshot_20261019.sa_orders WHERE id=ANY(%s)',(ids,))
    c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='order' AND entity_id=ANY(%s)",(ids,))
    c.execute('DELETE FROM sa_domain.quotes WHERE id=%s',(uuid.UUID(q['quote_id']),))
    for table in ['outbox','audit']:c.execute(f'DELETE FROM sa_domain.{table} WHERE command_key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,));c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
    c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',original)

if __name__=='__main__':unittest.main(verbosity=2)
