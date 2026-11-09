"""Local rollback-only exact catalogue/attachment capability boundaries."""
import json
import unittest
import uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,uid
from test_catalogue import seed_catalogue

def rpc(c,name,args):
    assert name.replace('_','').isalnum()
    return c.execute(psycopg.sql.SQL('SELECT canto_api.{}({})').format(psycopg.sql.Identifier(name),psycopg.sql.SQL(',').join(psycopg.sql.Placeholder() for _ in args)),args).fetchone()[0]


class CatalogueTermsRehearsal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_catalogue(c)

    def setUp(self):
        self.c=connect();self.c.execute('BEGIN')
        self.c.execute('UPDATE sa_sync.environment_state SET cutover=false')
        self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=clock_timestamp()+interval '20 minutes'",([uid(103),uid(203)],))
        self.c.execute('INSERT INTO sa_snapshot_20261019.sa_rmp_category_brands(rmp_category_id,rmp_brand_id,created_at,updated_at) VALUES(1,1,now(),now()),(1,2,now(),now())')
        self.actor()

    def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
    def actor(self,id=103):self.c.execute('RESET ROLE');session(self.c,id)
    def admin(self):self.c.execute('RESET ROLE')
    def service(self):
        self.admin();self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
    def terms(self):
        self.actor()
        upload=rpc(self.c,'account_document_attachment_reserve',(Jsonb({'filename':'terms.txt','bytes':30,'content_type':'text/plain'}),uuid.uuid4()))
        self.service();rpc(self.c,'account_upload_verified',(uuid.UUID(upload['upload_id']),'a'*64,30,'text/plain'))
        self.actor();ref=rpc(self.c,'v1_document_attachment_attach',(uuid.UUID(upload['upload_id']),uuid.uuid4()))
        return {k:ref[k] for k in ('resource','record_id','field')}
    def request(self,ref=None,selection=None):
        ref=ref or self.terms();self.actor()
        document=rpc(self.c,'v1_document_request',('catalogue',Jsonb({'selection':selection or {'class_ids':['1']},'terms_reference':ref,'delivery':'download'}),uuid.uuid4()))
        self.admin();doc=self.c.execute('SELECT to_jsonb(d) FROM sa_domain.documents d WHERE id=%s',(document['id'],)).fetchone()[0]
        return doc,ref
    def register(self,doc):
        self.admin();self.c.execute("INSERT INTO sa_domain.document_rehearsals(job_id,document_id,actor_id,generation,expires_at) VALUES(%s,%s,%s,%s,clock_timestamp()+interval '10 minutes')",(doc['job_id'],doc['id'],doc['actor_id'],doc['generation']))
    def claim(self,doc):
        self.service();return rpc(self.c,'squad_document_rehearsal_claim',(uuid.UUID(doc['job_id']),))['jobs'][0]
    def prepare(self,job):
        self.service();return rpc(self.c,'squad_document_prepare',(uuid.UUID(job['id']),uuid.UUID(job['lease_token'])))

    def test_single_catalogue_capture_tracks_terms_claim_and_finish(self):
        doc,ref=self.request();self.register(doc)
        before=self.c.execute('SELECT attachment_id,attachment_xmin,attachment_row_sha256 FROM sa_domain.document_rehearsal_receipts WHERE job_id=%s',(doc['job_id'],)).fetchone()
        self.assertEqual(before[0],int(ref['record_id']));self.assertEqual(len(before[2]),64)
        job=self.claim(doc);prepared=self.prepare(job)
        self.assertEqual(prepared['state'],'prepared');self.assertEqual(prepared['phase'],'single')
        self.assertEqual(len(prepared['snapshot']['rows']),1)
        self.assertEqual(prepared['snapshot']['terms_attachment']['path'],'sha256/aa/'+'a'*64)
        self.admin();proof=self.c.execute("SELECT a.claimed_at IS NOT NULL,p.attachment_xmin=a.xmin::text,p.attachment_row_sha256=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') FROM sa_domain.document_rehearsal_receipts p JOIN sa_domain.document_attachments a ON a.id=p.attachment_id WHERE p.job_id=%s",(doc['job_id'],)).fetchone()
        self.assertEqual(proof,(True,True,True))
        self.service();result=rpc(self.c,'squad_document_finish',(uuid.UUID(job['id']),uuid.UUID(job['lease_token']),Jsonb({'code':'READY','bytes':1000,'sha256':'b'*64,'pages':2})))
        self.assertEqual(result['state'],'done')
        self.actor();self.assertEqual(rpc(self.c,'v1_document_get',(doc['id'],))['state'],'ready')

    def test_unregistered_catalogue_cannot_be_claimed(self):
        doc,_=self.request()
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.claim(doc)

    def test_foreign_actor_attachment_denies_registration(self):
        doc,ref=self.request();self.c.execute('UPDATE sa_domain.document_attachments SET actor_id=%s WHERE id=%s',(uid(203),int(ref['record_id'])))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.register(doc)

    def test_changed_generation_denies_claim(self):
        doc,_=self.request();self.register(doc);self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1')
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.claim(doc)

    def test_attachment_claim_race_denies_claim(self):
        doc,ref=self.request();self.register(doc)
        self.c.execute('UPDATE sa_domain.document_attachments SET claimed_at=now() WHERE id=%s',(int(ref['record_id']),))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.claim(doc)

    def test_attachment_hash_change_denies_claim(self):
        doc,ref=self.request();self.register(doc)
        self.c.execute("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,30,'text/plain')",('c'*64,'sha256/cc/'+'c'*64))
        self.c.execute('UPDATE sa_domain.document_attachments SET sha256=%s WHERE id=%s',('c'*64,int(ref['record_id'])))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.claim(doc)

    def test_request_swap_denies_claim(self):
        doc,_=self.request();self.register(doc)
        self.c.execute("UPDATE sa_domain.documents SET request=jsonb_set(request,'{selection,class_ids}', '[\"2\"]') WHERE id=%s",(doc['id'],))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.claim(doc)

    def test_extra_document_reference_denies_claim(self):
        doc,ref=self.request();self.register(doc)
        self.c.execute("INSERT INTO sa_domain.documents(actor_id,legacy_user_id,role_id,generation,kind,request,delivery_state) VALUES(%s,203,3,%s,'catalogue',%s,'not_requested')",(uid(203),doc['generation'],Jsonb({'terms_reference':ref,'delivery':'download'})))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.claim(doc)

    def test_foreign_edit_after_prepare_denies_finish(self):
        doc,ref=self.request();self.register(doc);job=self.claim(doc);self.prepare(job)
        self.admin();self.c.execute("UPDATE sa_domain.document_attachments SET expires_at=expires_at+interval '1 second' WHERE id=%s",(int(ref['record_id']),));self.service()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'squad_document_finish',(uuid.UUID(job['id']),uuid.UUID(job['lease_token']),Jsonb({'code':'READY','bytes':1000,'sha256':'b'*64,'pages':2})))

    def test_multiple_classes_are_not_a_rehearsal_scope(self):
        doc,_=self.request(selection={'class_ids':['1','2']})
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.register(doc)

    def test_worker_reads_only_active_exact_attachment_and_clients_have_no_grants(self):
        doc,ref=self.request();self.register(doc);other=self.terms();self.admin()
        self.c.execute('SET LOCAL ROLE sa_worker');rows=self.c.execute('SELECT id FROM sa_domain.document_attachments').fetchall()
        self.assertEqual(rows,[(int(ref['record_id']),)])
        self.admin();self.c.execute('DELETE FROM sa_domain.document_rehearsals WHERE job_id=%s',(doc['job_id'],))
        self.c.execute('SET LOCAL ROLE sa_worker');self.assertEqual(self.c.execute('SELECT id FROM sa_domain.document_attachments').fetchall(),[])
        self.admin()
        for role in ['anon','authenticated','sa_app','service_role']:
            self.assertFalse(self.c.execute("SELECT has_table_privilege(%s,'sa_domain.document_rehearsals','INSERT')",(role,)).fetchone()[0])
            self.assertFalse(self.c.execute("SELECT has_function_privilege(%s,'sa_domain.document_rehearsal_scope(uuid)','EXECUTE')",(role,)).fetchone()[0])


if __name__=='__main__':unittest.main(verbosity=2)
