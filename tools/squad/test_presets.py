from sqlstate_assertions import assert_app_conflict
import concurrent.futures,copy,threading,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue,FEATURES
from test_pricing import CONFIG
class Presets(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');session(self.c,103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def create(self,key=None,config=None):return rpc(self.c,'v1_product_configure',(Jsonb(config or CONFIG),'My shirt','Reference comment',key or uuid.uuid4()))
 def color(self,key=None):return rpc(self.c,'v1_color_save',('fabric',1,'My purple','#aa00bb',key or uuid.uuid4()))
 def test_create_and_owned_canonical_reuse(self):
  p=self.create();same=self.create();self.assertEqual(p['id'],same['id']);self.assertFalse(p['reused']);self.assertTrue(same['reused']);self.assertEqual(p['version'],same['version'])
 def test_exact_command_retry(self):
  key=uuid.uuid4();p=self.create(key);self.assertEqual(p,self.create(key))
 def test_retry_key_different_configuration_denied(self):
  key=uuid.uuid4();self.create(key);config=copy.deepcopy(CONFIG);config['category_id']='2'
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.create(key,config)
 def test_existing_legacy_preset_reused_without_cache(self):
  p=self.create();self.c.execute('RESET ROLE');self.c.execute('DELETE FROM sa_domain.preset_index');session(self.c,103)
  self.assertEqual(p['id'],self.create()['id'])
 def test_distinct_users_do_not_share_private_presets(self):
  p=self.create();self.actor(203);other=self.create();self.assertNotEqual(p['id'],other['id'])
  self.assertEqual([x['id'] for x in rpc(self.c,'v1_presets_list')['data']],[other['id']])
 def test_detail_preserves_canonical_join_ids(self):
  p=self.create();r=rpc(self.c,'v1_presets_list',(Jsonb({'id':p['id']}),))['data'][0]
  self.assertEqual(r['configuration']['fabric_color_id'],'1');self.assertEqual(r['configuration']['parts'][0]['color_id'],'1')
  self.assertIn('color_link_id',r['configuration']['parts'][0]);self.assertEqual(r['style_number'],'CP-'+p['id'].zfill(4))
 def test_customers_cannot_rename_even_own_preset(self):
  p=self.create()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_preset_rename',(int(p['id']),'Rename',p['version'],uuid.uuid4()))
 def test_sc_rename_and_stale_conflict(self):
  self.actor(101);p=self.create();r=rpc(self.c,'v1_preset_rename',(int(p['id']),'Rename',p['version'],uuid.uuid4()));self.assertNotEqual(r['version'],p['version'])
  with assert_app_conflict(self):rpc(self.c,'v1_preset_rename',(int(p['id']),'Again',p['version'],uuid.uuid4()))
 def test_other_coordinator_cannot_rename(self):
  self.actor(201);p=self.create();self.actor(101)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_preset_rename',(int(p['id']),'Rename',p['version'],uuid.uuid4()))
 def test_order_customer_can_read_historical_preset(self):
  self.actor(101);p=self.create();self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_items SET product_id=%s WHERE id=1001',(int(p['id']),));session(self.c,103)
  self.assertEqual(rpc(self.c,'v1_presets_list',(Jsonb({'id':p['id']}),))['data'][0]['id'],p['id'])
  self.actor(203);self.assertEqual(rpc(self.c,'v1_presets_list',(Jsonb({'id':p['id']}),))['data'],[])
 def test_worker_feature_on_and_off(self):
  self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET features=%s WHERE id=112',(Jsonb(FEATURES),));session(self.c,112)
  self.assertTrue(self.create()['id']);self.c.execute('RESET ROLE');self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET features='[]' WHERE id=112");session(self.c,112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_presets_list')
 def test_configure_mirror_fenced(self):
  self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');session(self.c,103)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.create()
 def test_color_create_reuse_and_retry(self):
  key=uuid.uuid4();p=self.color(key);self.assertEqual(p,self.color(key));self.assertEqual(p['id'],self.color()['id']);self.assertEqual(p['hex'],'#AA00BB')
 def test_color_private_to_owner(self):
  p=self.color();self.actor(203);ids=[x['id'] for x in rpc(self.c,'v1_configurator_options',(1,'fabric_colors',1))['data']];self.assertNotIn(p['id'],ids)
 def test_color_target_requires_active_compatible_type(self):
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_color_save',('addon',2,'No color','#FFFFFF',uuid.uuid4()))
 def test_color_not_arbitrary_css(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_color_save',('fabric',1,'Bad','url(https://example.invalid)',uuid.uuid4()))
 def test_preview_asset_scoped_to_base_and_selected_layer(self):
  self.c.execute('RESET ROLE')
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_asset_infos(id,asset,\"dX\",\"dY\",created_at,updated_at) VALUES(9001,'base.svg',10,20,now(),now()),(9002,'addon.svg',30,40,now(),now())")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_base_products SET asset_info_id=9001 WHERE id=1')
  self.c.execute('INSERT INTO sa_snapshot_20261019.sa_base_product_asset_infos(base_product_id,part_id,add_on_id,asset_info_id,created_at,updated_at) VALUES(1,1,1,9002,now(),now())')
  session(self.c,103)
  base=rpc(self.c,'v1_configurator_options',(1,'assets'))['data'];self.assertEqual([x['id'] for x in base],['9001']);self.assertEqual(base[0]['asset']['status'],'pending')
  layer=rpc(self.c,'v1_configurator_options',(1,'assets',1,1))['data'];self.assertEqual([x['id'] for x in layer],['9002']);self.assertEqual(float(layer[0]['offset_x']),30)
  self.assertEqual(rpc(self.c,'v1_configurator_options',(1,'assets',2,1))['data'],[])

class ConcurrentPresets(unittest.TestCase):
 def test_same_configuration_different_commands_creates_one_product(self):
  barrier=threading.Barrier(2);keys=[uuid.uuid4(),uuid.uuid4()]
  with connect() as c:
   seed_catalogue(c);original=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  def create(key):
   with connect() as c,c.transaction():
    session(c,103);barrier.wait(timeout=3);return rpc(c,'v1_product_configure',(Jsonb(CONFIG),'Concurrent','Test',key))
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(create,keys))
   self.assertEqual(len({x['id'] for x in results}),1);self.assertEqual(sum(x['reused'] for x in results),1)
  finally:
   with connect() as c,c.transaction():
    ids=[r[0] for r in c.execute('SELECT entity_id FROM sa_domain.audit WHERE command_key=ANY(%s)',(keys,))]
    c.execute('DELETE FROM sa_snapshot_20261019.sa_product_part_add_ons WHERE product_part_id IN(SELECT id FROM sa_snapshot_20261019.sa_product_parts WHERE product_id=ANY(%s))',(ids,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_product_parts WHERE product_id=ANY(%s)',(ids,));c.execute('DELETE FROM sa_domain.preset_index WHERE product_id=ANY(%s)',(ids,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_products WHERE id=ANY(%s)',(ids,));c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='product' AND entity_id=ANY(%s)",(ids,))
    for table in ['outbox','audit']:c.execute(f'DELETE FROM sa_domain.{table} WHERE command_key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,));c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
    c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',original)
if __name__=='__main__':unittest.main(verbosity=2)
