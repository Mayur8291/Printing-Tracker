"""Local orchestration boundaries. All database and HTTP calls are mocked."""
import copy,unittest
from unittest.mock import Mock,patch
import test_web_catalogue_terms_hosted as h

class CatalogueHarness(unittest.TestCase):
 def values(self):
  state={'fixture':{'commercialExtras':{'rmpClassId':'77'}},'web_catalogue_terms':{}}
  owned={'upload':{'id':'upload'},'attachment':{'id':8},'file':{'sha256':'a'*64,'bytes':50}}
  docs=[{'id':'doc','job_id':'job','request':{'selection':{'class_ids':['77']}}}]
  report={'phase':'request','real_browser_upload':True,'document_id':'doc','job_id':'job','upload_id':'upload','attachment_reference':{'resource':'document_attachments','record_id':'8','field':'terms'},'terms_sha256':'a'*64,'terms_bytes':50}
  return state,owned,docs,report
 def test_report_is_candidate_only_server_proof_required(self):
  state,owned,docs,report=self.values()
  with patch.object(h.business,'journal',return_value=[]),patch.object(h.terms,'bindings',return_value=(owned,docs)) as proof,patch.object(h.outputs,'bindings',return_value=['bound']) as output:
   self.assertEqual(h.bind_request(Mock(),state,report),['bound']);proof.assert_called_once();output.assert_called_once();self.assertEqual(state['web_catalogue_terms']['document_id'],'doc')
 def test_swapped_report_or_class_or_file_denied(self):
  for field in ['document_id','job_id','upload_id','terms_sha256','terms_bytes','attachment_reference']:
   state,owned,docs,report=self.values();report[field]='swapped'
   with patch.object(h.business,'journal',return_value=[]),patch.object(h.terms,'bindings',return_value=(owned,docs)),self.assertRaises(AssertionError):h.bind_request(Mock(),state,report)
  state,owned,docs,report=self.values();docs[0]['request']['selection']['class_ids']=['78']
  with patch.object(h.business,'journal',return_value=[]),patch.object(h.terms,'bindings',return_value=(owned,docs)),self.assertRaises(AssertionError):h.bind_request(Mock(),state,report)
 def test_worker_quiescence_precedes_input_deletion(self):
  events=[];state={'run_id':'run','document_outputs':{}};state['document_outputs']={'present':True};c=Mock();c.execute.return_value.fetchone.return_value=None
  with patch.object(h.terms,'validate'),patch.object(h.business,'journal',return_value=[]),patch.object(h.outputs,'cleanup_storage',side_effect=lambda *a:events.append('outputs')),patch.object(h.terms,'cleanup_storage',side_effect=lambda *a:events.append('terms')),patch.object(h.business,'cleanup',side_effect=lambda *a,**kw:events.append('database')):
   h.cleanup(c,state,'never-real');self.assertEqual(events,['outputs','terms','database'])
 def test_failed_worker_quiescence_preserves_terms(self):
  state={'run_id':'run','document_outputs':{'present':True}};c=Mock();c.execute.return_value.fetchone.return_value=None
  with patch.object(h.terms,'validate'),patch.object(h.outputs,'cleanup_storage',side_effect=AssertionError('active lease')),patch.object(h.terms,'cleanup_storage') as remove,patch.object(h.business,'cleanup') as cleanup,self.assertRaises(AssertionError):
   h.cleanup(c,state,'never-real')
  remove.assert_not_called();cleanup.assert_not_called()
if __name__=='__main__':unittest.main(verbosity=2)
