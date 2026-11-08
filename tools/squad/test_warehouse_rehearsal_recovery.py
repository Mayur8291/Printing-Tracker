import hashlib,json,tempfile,unittest,urllib.error,uuid
from pathlib import Path
from unittest.mock import Mock,patch
import test_hosted_warehouse_rehearsal as harness

def states(**changes):
 result={step:{'attempted':False,'completed':False,'state':'ready','error_code':None} for step in (*harness.STEPS,'cleanup_initial','cleanup_replacement')}
 for key,value in changes.items():result[key].update(value)
 return result

class WarehouseRehearsalRecovery(unittest.TestCase):
 def test_lost_http_reply_persists_checkpoint_without_credentials_or_provider_replay(self):
  c=Mock();c.execute.return_value.fetchone.return_value=('private-worker-secret-test',)
  state={'run_id':str(uuid.uuid4()),'events':[]}
  with tempfile.TemporaryDirectory() as folder,patch.object(harness,'PRIVATE',Path(folder)),patch.object(harness,'CHECKPOINT',Path(folder)/'state.json'),patch('urllib.request.urlopen',side_effect=urllib.error.URLError('private-worker-secret-test')) as request:
   with self.assertRaisesRegex(RuntimeError,'response unconfirmed') as error:harness.call(c,state,'customer')
   saved=(Path(folder)/'state.json').read_text();self.assertNotIn('private-worker-secret-test',saved+str(error.exception));self.assertEqual(request.call_count,1)
   self.assertEqual(json.loads(saved)['events'][0]['result'],'HTTP_UNCONFIRMED')
 def test_unknown_order_cleanup_never_disables_customer_or_sends_new_order(self):
  rows=states(customer={'attempted':True,'completed':True},submit={'attempted':True,'state':'blocked'})
  with patch.object(harness,'status',return_value=rows),patch.object(harness,'advance',side_effect=RuntimeError('uncertain cleanup')) as advance:
   with self.assertRaisesRegex(RuntimeError,'uncertain cleanup'):harness.recover(Mock(),{})
   self.assertEqual([x.args[2] for x in advance.call_args_list],['cleanup_initial'])
 def test_unknown_customer_create_is_not_replayed_or_called_clean(self):
  with patch.object(harness,'status',return_value=states(customer={'attempted':True,'state':'blocked'})),patch.object(harness,'advance') as advance:
   with self.assertRaisesRegex(RuntimeError,'Customer creation remains unconfirmed'):harness.recover(Mock(),{})
   advance.assert_not_called()
 def test_completed_cancellations_recover_only_customer_disable(self):
  before=states(customer={'attempted':True,'completed':True},submit={'attempted':True},cancel_initial={'completed':True},replace={'attempted':True},cleanup_replacement={'completed':True})
  after=states(**before);after['customer_disable'].update(attempted=True,completed=True,state='done')
  with patch.object(harness,'status',side_effect=[before,before,after]),patch.object(harness,'advance') as advance:
   self.assertTrue(harness.recover(Mock(),{})['customer_disable']['completed']);self.assertEqual([x.args[2] for x in advance.call_args_list],['customer_disable'])
 def test_absent_registration_with_an_http_attempt_cannot_be_abandoned(self):
  with self.assertRaises(AssertionError):harness.abandon_unregistered(Mock(),{'registered':False,'events':[{'step':'customer'}]})
 def test_replaced_checkpoint_run_cannot_target_another_manifest(self):
  state={'run_id':str(uuid.uuid4()),'customer_id':1950000000,'order_id':1960000000,'email':'squad-test@mailinator.com','capture':{'source':'one'}}
  c=Mock();c.execute.return_value.fetchone.return_value=(harness.TENANT,1950000001,1960000000,state['email'],state['capture'],'{}','abc')
  with self.assertRaisesRegex(AssertionError,'identity differs'):harness.bind_manifest(c,state)
 def test_lost_registration_receipt_rebinds_only_exact_source_capture(self):
  state={'run_id':str(uuid.uuid4()),'customer_id':1950000000,'order_id':1960000000,'email':'squad-test@mailinator.com','capture':{'source':'one'},'sku':'test-sku'}
  order={'saleOrder':{'saleOrderItems':[{'itemSku':'test-sku'}]}}
  manifest=json.dumps({'run_id':state['run_id'],'project_ref':'scvojtvgnkmbupvyslmb','initial':order,'replacement':order});sha=hashlib.sha256(manifest.encode()).hexdigest()
  c=Mock();c.execute.return_value.fetchone.return_value=(harness.TENANT,state['customer_id'],state['order_id'],state['email'],state['capture'],manifest,sha)
  with patch.object(harness,'save'):harness.bind_manifest(c,state)
  self.assertEqual(state['verified_manifest_sha256'],sha)
  state['sku']='another-sku'
  with self.assertRaisesRegex(AssertionError,'Inventory proof SKU differs'):harness.bind_manifest(c,state)
  state['sku']='test-sku'
  state['capture']={'source':'different'}
  with self.assertRaisesRegex(AssertionError,'source capture differs'):harness.bind_manifest(c,state)
 def test_unknown_exact_sku_cannot_pass_inventory_acceptance(self):
  c=Mock();c.execute.return_value.fetchone.return_value=('private-worker-secret-test',)
  response=Mock(status=200);response.read.return_value=json.dumps({'state':'verified','environment':'staging','provider':'unicommerce','writes':0,'facilities':[{'facility':'WH1','code':'CONFIRMED','requested_skus':1,'known_skus':0}]}).encode()
  context=Mock();context.__enter__=Mock(return_value=response);context.__exit__=Mock(return_value=False)
  with patch('urllib.request.urlopen',return_value=context),patch.object(harness,'save') as save:
   with self.assertRaisesRegex(AssertionError,'not confirmed'):harness.inventory_check(c,{'sku':'controlled-sku'})
   save.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
