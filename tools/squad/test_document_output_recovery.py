"""Local rollback-only rehearsal output provenance and cleanup regressions."""
import json
import copy
import hashlib
import io
import urllib.error
import unittest
import uuid
from unittest.mock import patch

from psycopg.types.json import Jsonb
import test_business_harness as base_harness
from test_business_journey_composition import run_sdk
import test_hosted_business_journeys as business
import document_output_recovery as outputs


class DocumentOutputRecovery(unittest.TestCase):
    setUpClass=classmethod(lambda cls: base_harness.BusinessHarness.setUpClass())
    setUp=base_harness.BusinessHarness.setUp
    tearDown=base_harness.BusinessHarness.tearDown
    prepared=base_harness.BusinessHarness.prepared

    def composed(self,register_outputs=True):
        state=self.prepared();actors={}
        for actor in state['identity']['actors']:
            actor=dict(actor,session_id=str(uuid.uuid4()))
            self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(actor['session_id'],actor['auth_id']))
            actors[actor['role']]=actor
        result=run_sdk(self.c,state['fixture'],actors,state['run_id'])
        self.c.execute('RESET ROLE')
        docs=outputs.register(self.c,state) if register_outputs else outputs.bindings(self.c,state)
        return state,result,docs

    def service(self):
        self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
        self.c.execute('SET LOCAL ROLE service_role')

    def render_sql(self,docs,body=None):
        snapshots={}
        for doc in docs:
            self.service();job=self.c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)',(doc['job_id'],)).fetchone()[0]['jobs'][0]
            ready=self.c.execute('SELECT canto_api.squad_document_prepare(%s,%s)',(job['id'],job['lease_token'])).fetchone()[0]
            self.assertEqual(ready['state'],'prepared');self.assertEqual(ready['phase'],'single')
            snapshots[doc['kind']]=ready['snapshot']
            result=self.c.execute('SELECT canto_api.squad_document_finish(%s,%s,%s)',(job['id'],job['lease_token'],Jsonb({'code':'READY','bytes':len(body) if body else 1200,'sha256':hashlib.sha256(body).hexdigest() if body else 'a'*64,'pages':1}))).fetchone()[0]
            self.assertEqual(result['state'],'done');self.c.execute('RESET ROLE')
        return snapshots

    def clean(self,state,result):
        outputs.quiesce(self.c,state)
        state['document_outputs']['storage_deleted']=True
        return business.cleanup(self.c,state,result['journal'],document_cleanup=outputs.cleanup_callback)

    def test_two_exact_source_valid_documents_and_immutable_cleanup(self):
        state,result,docs=self.composed();snapshots=self.render_sql(docs)
        challan=snapshots['delivery_challan'];weekly=snapshots['tailor_weekly']
        self.assertEqual((challan['quantity'],challan['order_quantity'],challan['destination']['mode']),(1,4,'customer'))
        self.assertEqual(float(challan['total']),525)
        self.assertEqual((weekly['summary']['completed'],weekly['summary']['pending']),(3,0));self.assertEqual(float(weekly['summary']['amount']),105)
        cleaned=self.clean(state,result)
        self.assertTrue(cleaned['audit_and_commands_retained'])
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.job_attempts WHERE job_id=ANY(%s::uuid[])',([d['job_id'] for d in docs],)).fetchone()[0],2)
        self.assertEqual(business.cleanup(self.c,state,result['journal'],document_cleanup=outputs.cleanup_callback),cleaned)
        self.assertFalse(self.c.execute('SELECT cutover FROM sa_sync.environment_state').fetchone()[0])

    def test_registration_checkpoint_survives_rolled_back_registration(self):
        state,result,docs=self.composed(register_outputs=False)
        class Interrupted(Exception):pass
        with self.assertRaises(Interrupted):
            with self.c.transaction():
                outputs.register(self.c,state)
                durable=copy.deepcopy(state)  # Simulate checkpoint fsync before commit.
                raise Interrupted()
        self.assertFalse(self.c.execute('SELECT 1 FROM sa_domain.document_rehearsals WHERE job_id=ANY(%s::uuid[])',([d['job_id'] for d in docs],)).fetchone())
        self.assertFalse(self.c.execute('SELECT 1 FROM sa_domain.document_rehearsal_receipts WHERE job_id=ANY(%s::uuid[])',([d['job_id'] for d in docs],)).fetchone())
        cleaned=self.clean(durable,result)
        self.assertEqual(cleaned['removed_processed_documents'],0)
        self.assertGreaterEqual(cleaned['removed_queued_documents'],2)

    def test_response_loss_before_worker_is_recoverable(self):
        state,result,docs=self.composed()
        cleaned=self.clean(state,result)
        self.assertGreaterEqual(cleaned['removed_queued_documents'],2)

    def test_foreign_job_execution_is_never_excused(self):
        state,result,docs=self.composed();self.render_sql(docs)
        job=self.c.execute("SELECT id FROM sa_domain.outbox WHERE actor_id=ANY(%s::uuid[]) AND event_type<>'document.requested' LIMIT 1",([a['auth_id'] for a in state['identity']['actors']],)).fetchone()[0]
        self.c.execute("UPDATE sa_domain.outbox SET attempts=1,status='done' WHERE id=%s",(job,))
        with self.assertRaisesRegex(AssertionError,'unexpectedly executed'):self.clean(state,result)

    def test_tampered_checkpoint_cannot_select_a_different_document(self):
        state,result,docs=self.composed()
        state['document_outputs']['documents'][0]['document_id']=str(uuid.uuid4())
        with self.assertRaisesRegex(AssertionError,'checkpoint differs'):outputs.validate(self.c,state)

    def test_live_lease_prevents_storage_cleanup(self):
        state,result,docs=self.composed();self.service()
        self.c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)',(docs[0]['job_id'],)).fetchone()[0];self.c.execute('RESET ROLE')
        with self.assertRaisesRegex(AssertionError,'may still be running'):outputs.quiesce(self.c,state)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.document_rehearsals').fetchone()[0],0)
        self.assertEqual(self.c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone(),(False,[],None))

    def test_expired_uncertain_upload_is_settled_only_after_grace(self):
        state,result,docs=self.composed();self.service()
        job=self.c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)',(docs[0]['job_id'],)).fetchone()[0]['jobs'][0]
        self.c.execute('SELECT canto_api.squad_document_prepare(%s,%s)',(job['id'],job['lease_token']))
        self.c.execute('RESET ROLE')
        self.c.execute("UPDATE sa_domain.outbox SET lease_until=clock_timestamp()-interval '61 seconds' WHERE id=%s",(job['id'],))
        outputs.quiesce(self.c,state)
        self.assertEqual(self.c.execute('SELECT status,last_error_code,lease_until FROM sa_domain.outbox WHERE id=%s',(job['id'],)).fetchone(),('dead','REHEARSAL_OUTPUT_ABORT',None))
        self.assertEqual(self.c.execute('SELECT state,error_code FROM sa_domain.job_attempts WHERE lease_token=%s',(job['lease_token'],)).fetchone(),('failed','REHEARSAL_OUTPUT_ABORT'))
        self.clean(state,result)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.document_rehearsal_receipts WHERE job_id=%s',(job['id'],)).fetchone())

    def test_replaced_storage_object_is_not_deleted(self):
        state,result,docs=self.composed()
        self.c.execute("INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,'squad-documents',%s)",(uuid.uuid4(),docs[0]['prefix']+'document.pdf'))
        old=outputs.object_rows(self.c,docs)[0]
        state['document_outputs']['storage_receipts']=[{'object':old,'bytes':100,'sha256':'a'*64}]
        self.c.execute("UPDATE storage.objects SET id=%s WHERE bucket_id='squad-documents' AND name=%s",(uuid.uuid4(),old['name']))
        with patch('document_output_recovery.urllib.request.urlopen',side_effect=AssertionError('No network allowed')):
            with self.assertRaisesRegex(AssertionError,'changed since cleanup checkpoint'):outputs.cleanup_storage(self.c,state,'unit-test-secret',lambda value:None,business.identities.URL)

    def test_foreign_document_edit_after_worker_receipt_is_rejected(self):
        state,result,docs=self.composed();self.render_sql(docs)
        self.c.execute("UPDATE sa_domain.documents SET bytes=bytes+1 WHERE id=%s",(docs[0]['document_id'],))
        with self.assertRaisesRegex(AssertionError,'outside recorded worker'):outputs.quiesce(self.c,state)

    def test_unexpected_storage_object_cannot_be_deleted(self):
        state,result,docs=self.composed()
        self.c.execute("INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,'squad-documents',%s)",(uuid.uuid4(),docs[0]['prefix']+'foreign.pdf'))
        with self.assertRaisesRegex(AssertionError,'Unexpected output'):outputs.object_rows(self.c,docs)

    def test_storage_delete_response_loss_recovers_exact_receipts(self):
        state,result,docs=self.composed();body=b'%PDF-1.7 synthetic unit-test bytes'
        self.render_sql(docs,body)
        for doc in docs:self.c.execute("INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,'squad-documents',%s)",(uuid.uuid4(),doc['prefix']+'document.pdf'))
        class Response(io.BytesIO):status=200
        saved=[]
        def request(req,timeout):
            if req.get_method()=='GET':return Response(body)
            self.assertEqual(req.get_method(),'DELETE')
            names=json.loads(req.data)['prefixes'];self.assertEqual(set(names),{d['prefix']+'document.pdf' for d in docs})
            self.c.execute("DELETE FROM storage.objects WHERE bucket_id='squad-documents' AND name=ANY(%s)",(names,))
            raise urllib.error.URLError('Simulated lost delete response')
        with patch('document_output_recovery.urllib.request.urlopen',request):
            with self.assertRaises(urllib.error.URLError):outputs.cleanup_storage(self.c,state,'unit-test-secret',lambda value:saved.append(copy.deepcopy(value)),business.identities.URL)
        self.assertEqual(len(saved[-1]['document_outputs']['storage_receipts']),2)
        self.assertFalse(state['document_outputs']['storage_deleted'])
        with patch('document_output_recovery.urllib.request.urlopen',side_effect=AssertionError('No network required after confirmed removal')):
            outputs.cleanup_storage(self.c,state,'unit-test-secret',lambda value:None,business.identities.URL)
        self.assertTrue(state['document_outputs']['storage_deleted'])
        cleaned=business.cleanup(self.c,state,result['journal'],document_cleanup=outputs.cleanup_callback)
        self.assertEqual(cleaned['removed_processed_documents'],2)

    def test_unconfirmed_storage_is_never_deleted_as_database_only_cleanup(self):
        state,result,docs=self.composed();self.render_sql(docs);outputs.quiesce(self.c,state)
        with self.assertRaisesRegex(AssertionError,'Storage cleanup has not'):business.cleanup(self.c,state,result['journal'],document_cleanup=outputs.cleanup_callback)


if __name__=='__main__':unittest.main(verbosity=2)
