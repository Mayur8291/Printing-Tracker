"""Local immutable ownership, retry and exact cleanup tests for catalogue terms."""
import copy
import hashlib
import io
import json
import unittest
import uuid
from unittest.mock import patch
from psycopg.types.json import Jsonb

import test_hosted_business_journeys as business
import document_output_recovery as outputs
import web_catalogue_terms_recovery as terms
import test_business_harness as base
from test_catalogue_terms_rehearsal import rpc


class CatalogueTermsRecovery(unittest.TestCase):
    setUpClass=classmethod(base.BusinessHarness.setUpClass.__func__)
    setUp=base.BusinessHarness.setUp;tearDown=base.BusinessHarness.tearDown;prepared=base.BusinessHarness.prepared
    def service(self):
        self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
    def compose(self,request=True,register=True,finalize=True):
        state=self.prepared();terms.plan(self.c,state)
        actor=next(a for a in state['identity']['actors'] if a['role']==3);session=uuid.uuid4()
        self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,actor['auth_id']))
        claims={'role':'sa_app','sub':actor['auth_id'],'session_id':str(session)}
        def as_actor():
            self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps(claims),));self.c.execute('SET LOCAL ROLE sa_app')
        entries=[]
        def key(index):
            label='web.role3.'+str(index);value=uuid.uuid5(uuid.UUID(state['run_id']),label)
            entries.append({'kind':'command','value':{'label':label,'key':str(value)}});return value
        file=state['web_catalogue_terms']['file'];as_actor()
        upload=rpc(self.c,'account_document_attachment_reserve',(Jsonb({k:file[k] for k in ('filename','bytes','content_type')}),key(0)))
        self.service();rpc(self.c,'account_upload_verified',(uuid.UUID(upload['upload_id']),file['sha256'],file['bytes'],file['content_type']))
        as_actor();ref=rpc(self.c,'v1_document_attachment_attach',(uuid.UUID(upload['upload_id']),key(1))) if finalize else None
        if request:
            assert finalize
            doc=rpc(self.c,'v1_document_request',('catalogue',Jsonb({'selection':{'class_ids':[state['fixture']['commercialExtras']['rmpClassId']]},'terms_reference':{k:ref[k] for k in ('resource','record_id','field')},'delivery':'download'}),key(2)))
            state['web_catalogue_terms']['document_id']=doc['id']
            entries.append({'kind':'entity','value':{'kind':'document','id':doc['id']}})
        self.c.execute('RESET ROLE')
        if register:
            with patch.object(business,'journal',return_value=entries):outputs.register(self.c,state)
        return state,entries
    def render(self,state):
        doc=state['document_outputs']['documents'][0];self.service()
        job=rpc(self.c,'squad_document_rehearsal_claim',(uuid.UUID(doc['job_id']),))['jobs'][0]
        result=rpc(self.c,'squad_document_prepare',(uuid.UUID(job['id']),uuid.UUID(job['lease_token'])))
        self.assertEqual(result['phase'],'single');self.assertEqual(len(result['snapshot']['rows']),1)
        rpc(self.c,'squad_document_finish',(uuid.UUID(job['id']),uuid.UUID(job['lease_token']),Jsonb({'code':'READY','bytes':1000,'sha256':'b'*64,'pages':2})))
        self.c.execute('RESET ROLE')
    def clean(self,state,entries):
        with patch.object(business,'journal',return_value=entries):
            if state.get('document_outputs'):
                outputs.quiesce(self.c,state);state['document_outputs']['storage_deleted']=True
            state['web_catalogue_terms']['storage_deleted']=True
            return business.cleanup(self.c,state,entries,document_cleanup=outputs.cleanup_callback,media_cleanup=terms.cleanup_database)
    def test_rendered_catalogue_terms_cleanup_retains_audit_upload_and_worker_receipts(self):
        state,entries=self.compose();self.render(state)
        with patch.object(business,'journal',return_value=entries):outputs.validate(self.c,state)
        result=self.clean(state,entries)
        self.assertEqual(result['removed_processed_documents'],1)
        self.assertEqual(result['media']['owned_terms_uploads'],1)
        self.assertTrue(result['audit_and_commands_retained'])
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.media_uploads WHERE actor_id=%s',(state['web_catalogue_terms']['actor_id'],)).fetchone()[0],1)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.document_rehearsal_receipts WHERE document_id=%s',(state['web_catalogue_terms']['document_id'],)).fetchone()[0],1)
    def test_finalized_upload_before_request_is_recoverable(self):
        state,entries=self.compose(request=False,register=False)
        self.assertEqual(self.clean(state,entries)['media']['owned_terms_uploads'],1)
    def test_queued_request_before_registration_is_recoverable(self):
        state,entries=self.compose(register=False)
        result=self.clean(state,entries);self.assertEqual(result['removed_processed_documents'],0);self.assertEqual(result['removed_queued_documents'],1)
    def test_changed_attachment_is_refused(self):
        state,entries=self.compose();self.render(state)
        owned,_=terms.bindings(self.c,state,entries)
        self.c.execute("UPDATE sa_domain.document_attachments SET expires_at=expires_at+interval '1 second' WHERE id=%s",(owned['attachment']['id'],))
        with self.assertRaisesRegex(AssertionError,'outside worker receipt'):terms.bindings(self.c,state,entries)
        # Rollback-only test ends here; no restoration or deletion is attempted.
    def test_foreign_reference_prevents_any_storage_request(self):
        state,entries=self.compose();file=state['web_catalogue_terms']['file']
        self.c.execute("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('users',999,'profile_image','','squad:'||%s,'ready',%s)",(file['sha256'],file['sha256']))
        with patch.object(terms.urllib.request,'urlopen',side_effect=AssertionError('No network permitted')):
            with self.assertRaisesRegex(AssertionError,'Unowned terms reference'):terms.cleanup_storage(self.c,state,entries,'synthetic',lambda _:None,business.identities.URL)
    def test_forged_document_checkpoint_does_not_bind(self):
        state,entries=self.compose();state['web_catalogue_terms']['document_id']=str(uuid.uuid4())
        with patch.object(business,'journal',return_value=entries):
            with self.assertRaisesRegex(AssertionError,'checkpoint differs'):outputs.bindings(self.c,state)
    def test_foreign_edit_before_request_is_not_treated_as_own_finalize(self):
        state,entries=self.compose(request=False,register=False)
        with self.c.transaction():
            self.c.execute("UPDATE sa_domain.document_attachments SET expires_at=expires_at+interval '1 second' WHERE actor_id=%s",(state['web_catalogue_terms']['actor_id'],))
        with self.assertRaisesRegex(AssertionError,'outside owned commands'):terms.bindings(self.c,state,entries)
    def test_extra_same_target_pointer_is_rejected_before_storage(self):
        state,entries=self.compose(request=False,register=False);owned,_=terms.bindings(self.c,state,entries)
        self.c.execute("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('document_attachments',%s,'terms','foreign','squad:'||%s,'ready',%s)",(owned['attachment']['id'],owned['file']['sha256'],owned['file']['sha256']))
        with self.assertRaisesRegex(AssertionError,'Unowned terms reference'):terms.bindings(self.c,state,entries)
    def test_unfinished_upload_waits_existing_signed_grant_grace(self):
        state,entries=self.compose(request=False,register=False,finalize=False)
        self.c.execute("UPDATE sa_domain.media_uploads SET expires_at=now()-interval '61 seconds' WHERE actor_id=%s",(state['web_catalogue_terms']['actor_id'],))
        with self.assertRaisesRegex(AssertionError,'expiry plus2h10m'):terms.bindings(self.c,state,entries)
        self.c.execute("UPDATE sa_domain.media_uploads SET expires_at=now()-interval '131 minutes' WHERE actor_id=%s",(state['web_catalogue_terms']['actor_id'],))
        self.assertEqual(self.clean(state,entries)['media']['owned_terms_uploads'],1)
    def test_fractional_timestamp_precision_uses_database_grace_clock(self):
        state,entries=self.compose(request=False,register=False,finalize=False)
        for fraction in ['0.1','0.12345']:
            self.c.execute("UPDATE sa_domain.media_uploads SET expires_at=date_trunc('second',clock_timestamp())-interval '131 minutes'+%s::interval WHERE actor_id=%s",(fraction+' seconds',state['web_catalogue_terms']['actor_id']))
            owned,docs=terms.bindings(self.c,state,entries)
            self.assertIsNotNone(owned);self.assertEqual(docs,[])
        self.c.execute("UPDATE sa_domain.media_uploads SET expires_at=date_trunc('second',clock_timestamp())-interval '129 minutes'+interval '0.1 seconds' WHERE actor_id=%s",(state['web_catalogue_terms']['actor_id'],))
        with self.assertRaisesRegex(AssertionError,'expiry plus2h10m'):terms.bindings(self.c,state,entries)
    def test_storage_response_loss_recovers_only_saved_exact_objects(self):
        state,entries=self.compose(request=False,register=False);owned,_=terms.bindings(self.c,state,entries)
        for bucket,name in [('squad-uploads','pending/'+owned['upload']['id']),('canto-media',owned['file']['canonical'])]:
            self.c.execute('INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,%s,%s)',(uuid.uuid4(),bucket,name))
        data=terms.content(state['run_id']);calls=[];lost=[True]
        class Response(io.BytesIO):status=200
        def request(req,timeout):
            if req.get_method()=='GET':return Response(data)
            bucket=req.full_url.rsplit('/',1)[-1];paths=json.loads(req.data)['prefixes'];calls.append((bucket,paths))
            self.assertEqual(len(paths),1)
            self.c.execute('DELETE FROM storage.objects WHERE bucket_id=%s AND name=ANY(%s)',(bucket,paths))
            if lost[0]:lost[0]=False;raise OSError('Injected delete response loss')
            return Response(b'[]')
        with patch.object(terms.urllib.request,'urlopen',side_effect=request):
            with self.assertRaisesRegex(OSError,'response loss'):terms.cleanup_storage(self.c,state,entries,'synthetic',lambda _:None,business.identities.URL)
            self.assertFalse(state['web_catalogue_terms']['storage_deleted'])
            self.assertEqual(len(state['web_catalogue_terms']['storage_receipts']),2)
            terms.cleanup_storage(self.c,state,entries,'synthetic',lambda _:None,business.identities.URL)
        self.assertEqual({b for b,_ in calls},{'squad-uploads','canto-media'})
        self.assertTrue(state['web_catalogue_terms']['storage_deleted'])
        self.assertEqual(self.clean(state,entries)['media']['owned_terms_uploads'],1)
    def test_storage_replacement_after_receipt_is_never_deleted(self):
        state,entries=self.compose(request=False,register=False);owned,_=terms.bindings(self.c,state,entries)
        self.c.execute("INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,'canto-media',%s)",(uuid.uuid4(),owned['file']['canonical']))
        obj=terms.storage_rows(self.c,owned)[0]
        state['web_catalogue_terms']['storage_receipts']=[{'object':obj,'bytes':owned['file']['bytes'],'sha256':owned['file']['sha256']}]
        self.c.execute("UPDATE storage.objects SET id=%s WHERE bucket_id='canto-media' AND name=%s",(uuid.uuid4(),owned['file']['canonical']))
        with patch.object(terms.urllib.request,'urlopen',side_effect=AssertionError('No network')):
            with self.assertRaisesRegex(AssertionError,'Storage changed'):terms.cleanup_storage(self.c,state,entries,'synthetic',lambda _:None,business.identities.URL)


if __name__=='__main__':unittest.main(verbosity=2)
