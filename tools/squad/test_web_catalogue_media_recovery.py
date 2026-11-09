"""Isolated SQL lifecycle + refusal tests; no hosted accounts or Storage calls."""
import copy,json,unittest,uuid
from unittest.mock import Mock,patch
from urllib.parse import urlparse
from psycopg.types.json import Jsonb
import test_business_harness as base
import test_hosted_business_journeys as business
import web_catalogue_media_recovery as media

class CatalogueMediaRecovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):base.BusinessHarness.setUpClass()
    def setUp(self):
        self.f=base.BusinessHarness();self.f.setUp();self.c=self.f.c
    def tearDown(self):self.f.tearDown()
    def fixture(self,opaque=False,attach=True,detach=True):
        c=self.c;state=business.plan(c);state['created_at']=c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat()
        media.plan(c,state,business.PRIVATE,opaque);credentials=business.prepare(c,state)
        actor=next(a for a in credentials if a['role']==3);sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']))
        claims=json.dumps({'role':'sa_app','sub':actor['auth_id'],'session_id':str(sid)});entries=[]
        def auth():
            c.execute('RESET ROLE');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(claims,));c.execute('SET LOCAL ROLE sa_app')
        def key(label):
            value=uuid.uuid5(uuid.UUID(state['run_id']),label);entries.append({'kind':'command','value':{'key':str(value),'label':label}});return value
        auth();product=c.execute('SELECT canto_api.v1_product_configure(%s,%s,%s,%s)',(Jsonb(state['fixture']['customConfig']),state['label']+' media preset','',key('web.media.product'))).fetchone()[0]
        targets=[{'resource':'products','record_id':product['id'],'field':'images'}]
        if opaque:
            design=c.execute('SELECT canto_api.v1_branding_save(NULL,NULL,%s,NULL,%s)',(Jsonb({'type':'print','side':'front','width':'3','height':'2','unit':'inch','comment':state['label']}),key('web.media.design'))).fetchone()[0]
            targets.append({'resource':'brandings','record_id':design['id'],'field':'attachment'})
        for index,item in enumerate(state['web_catalogue_media']['files']):
            target=targets[index];version=c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([target]),)).fetchone()[0]['references'][0]['version']
            upload=c.execute('SELECT canto_api.account_upload_reserve(%s,%s,%s,%s)',(Jsonb(target),Jsonb({'filename':item['filename'],'bytes':str(item['bytes']),'content_type':item['content_type']}),version,key(f'web.media.reserve{index}'))).fetchone()[0]
            if not attach:break
            c.execute('RESET ROLE');c.execute('SET LOCAL ROLE service_role');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
            c.execute('SELECT canto_api.account_upload_verified(%s,%s,%s,%s)',(upload['upload_id'],item['sha256'],item['bytes'],item['content_type']));auth()
            result=c.execute('SELECT canto_api.v1_media_attach(%s,%s,%s)',(upload['upload_id'],version,key(f'web.media.attach{index}'))).fetchone()[0]
            concrete={k:result[k] for k in ('resource','record_id','field')}
            if index==0:
                for j in range(2):
                    c.execute('SELECT canto_api.v1_product_image_comment(%s,%s,%s,%s)',(result['record_id'],f'{state["label"]} note{j}',result['entity_version'],key(f'web.media.note{j}'))).fetchone()
                    result['entity_version']=c.execute('SELECT canto_api.v1_product_images(%s,NULL,12)',(product['id'],)).fetchone()[0]['version']
            if detach:
                fresh=c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([concrete]),)).fetchone()[0]['references'][0]['version']
                c.execute('SELECT canto_api.v1_media_detach(%s,%s,%s,%s)',(Jsonb(concrete),fresh,'Owned catalogue media acceptance complete',key(f'web.media.detach{index}')))
        c.execute('RESET ROLE');return state,entries

    def test_png_and_opaque_actual_sql_lifecycle_cleanup_preserves_history(self):
        state,entries=self.fixture(opaque=True);owned,roots,refs=media.bindings(self.c,state,entries)
        self.assertEqual(len(owned),2);self.assertEqual(set(roots),{'product','branding'});self.assertEqual(len(refs),2)
        state['web_catalogue_media']['storage_deleted']=True # No Storage HTTP objects exist in this isolated test.
        before=self.c.execute('SELECT count(*) FROM sa_domain.audit').fetchone()[0]
        receipt=business.cleanup(self.c,state,journal_entries=entries,media_cleanup=media.cleanup_database)
        self.assertTrue(receipt['source_content_restored']);self.assertTrue(receipt['media']['existing_media_preserved'])
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.audit').fetchone()[0],before+1)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.media_history WHERE actor_id=%s',(state['web_catalogue_media']['actor_id'],)).fetchone()[0],4)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.media_uploads WHERE actor_id=%s',(state['web_catalogue_media']['actor_id'],)).fetchone()[0],2)
    def test_product_only_cleanup(self):
        state,entries=self.fixture();media.bindings(self.c,state,entries);state['web_catalogue_media']['storage_deleted']=True
        result=business.cleanup(self.c,state,journal_entries=entries,media_cleanup=media.cleanup_database);self.assertTrue(result['source_content_restored'])
    def test_manifest_redirection_bytes_type_and_configuration_rejected(self):
        state,entries=self.fixture()
        for field,value in [('path','/tmp/foreign'),('sha256','a'*64),('bytes',9),('content_type','application/pdf'),('filename','foreign.png')]:
            changed=copy.deepcopy(state);changed['web_catalogue_media']['files'][0][field]=value
            with self.subTest(field=field),self.assertRaises(AssertionError):media.validate(changed)
        changed=copy.deepcopy(state);changed['web_catalogue_media']['configuration']['base_product_id']='1'
        with self.assertRaises(AssertionError):media.validate(changed)
    def test_missing_journal_and_duplicate_root_refused(self):
        state,entries=self.fixture()
        with self.assertRaisesRegex(AssertionError,'Unjournaled'):media.bindings(self.c,state,[])
    def test_foreign_reference_refused(self):
        state,entries=self.fixture();digest=state['web_catalogue_media']['files'][0]['sha256']
        self.c.execute("INSERT INTO sa_media.references(resource,record_id,field,sha256,status) VALUES('users',999,'profile_image',%s,'ready')",(digest,))
        with self.assertRaisesRegex(AssertionError,'Foreign media'):media.bindings(self.c,state,entries)
    def test_foreign_source_marker_without_reference_refused(self):
        state,entries=self.fixture();digest=state['web_catalogue_media']['files'][0]['sha256']
        self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET profile_image=%s WHERE id=%s',('squad:'+digest,state['base']+1))
        with self.assertRaisesRegex(AssertionError,'Foreign source'):media.bindings(self.c,state,entries)
    def test_admin_override_refused(self):
        state,entries=self.fixture();digest=state['web_catalogue_media']['files'][0]['sha256']
        self.c.execute("INSERT INTO sa_admin.media VALUES('base_products',999,'image',%s)",('squad:'+digest,))
        with self.assertRaisesRegex(AssertionError,'admin override'):media.bindings(self.c,state,entries)
    def test_changed_metadata_refused(self):
        state,entries=self.fixture();self.c.execute('UPDATE sa_media.objects SET bytes=bytes+1 WHERE sha256=%s',(state['web_catalogue_media']['files'][0]['sha256'],))
        with self.assertRaisesRegex(AssertionError,'metadata'):media.bindings(self.c,state,entries)
    def test_incomplete_verification_keeps_checkpoint(self):
        state,entries=self.fixture(attach=False)
        with self.assertRaisesRegex(AssertionError,'safe expiry'):media.bindings(self.c,state,entries)
    def test_wrong_root_actor_and_reused_result_refused(self):
        state,entries=self.fixture();created=media.roots(self.c,state,entries)[0]
        self.c.execute('UPDATE sa_snapshot_20261019.sa_products SET created_by_id=%s WHERE id=%s',(state['base']+1,created['product']))
        with self.assertRaisesRegex(AssertionError,'Product scope'):media.bindings(self.c,state,entries)
    def test_branding_link_refused(self):
        state,entries=self.fixture(opaque=True);created=media.roots(self.c,state,entries)[0]
        self.c.execute('UPDATE sa_snapshot_20261019.sa_brandings SET product_id=%s WHERE id=%s',(created['product'],created['branding']))
        with self.assertRaisesRegex(AssertionError,'Branding linked'):media.bindings(self.c,state,entries)
    def test_wrong_concrete_image_parent_refused(self):
        state,entries=self.fixture();_,roots,concrete=media.bindings(self.c,state,entries);target=next(iter(concrete))
        # Removing the parent edge is sufficient to prove the adapter does not trust a client image ID.
        other=self.c.execute("INSERT INTO sa_snapshot_20261019.sa_products SELECT (jsonb_populate_record(NULL::sa_snapshot_20261019.sa_products,to_jsonb(p)||jsonb_build_object('id',nextval('sa_snapshot_20261019.sa_products_id_seq')))).* FROM sa_snapshot_20261019.sa_products p WHERE id=%s RETURNING id",(roots['product'],)).fetchone()[0]
        self.c.execute('UPDATE sa_snapshot_20261019.sa_product_images SET product_id=%s WHERE id=%s',(other,target[1]))
        with self.assertRaisesRegex(AssertionError,'Concrete image'):media.bindings(self.c,state,entries)
    def test_storage_not_removed_blocks_database_deletion(self):
        state,entries=self.fixture()
        with self.assertRaisesRegex(AssertionError,'Storage must'):media.cleanup_database(self.c,state,entries)
    def test_wrong_generation_never_calls_storage(self):
        state,entries=self.fixture();self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1')
        with patch('web_catalogue_media_recovery.urllib.request.urlopen') as http:
            with self.assertRaises(AssertionError):media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
            http.assert_not_called()

    def test_preexisting_id_and_foreign_row_transaction_refused(self):
        state,entries=self.fixture();created=media.roots(self.c,state,entries)[0]
        altered=copy.deepcopy(state);altered['source_before']['sa_products']['max_id']=created['product']
        with self.assertRaises(AssertionError):media.bindings(self.c,altered,entries)
        with self.c.transaction():self.c.execute('UPDATE sa_snapshot_20261019.sa_products SET name=name WHERE id=%s',(created['product'],))
        with self.assertRaisesRegex(AssertionError,'independently modified'):media.bindings(self.c,state,entries)
    def test_changed_upload_filename_or_type_refused(self):
        state,entries=self.fixture();self.c.execute("UPDATE sa_domain.media_uploads SET filename='foreign.png' WHERE actor_id=%s",(state['web_catalogue_media']['actor_id'],))
        with self.assertRaisesRegex(AssertionError,'filename'):media.bindings(self.c,state,entries)
    def test_changed_attach_result_refused(self):
        state,entries=self.fixture();self.c.execute("UPDATE sa_domain.media_uploads SET result=result||'{\"record_id\":\"999\"}'::jsonb WHERE actor_id=%s",(state['web_catalogue_media']['actor_id'],))
        with self.assertRaisesRegex(AssertionError,'audit/receipt'):media.bindings(self.c,state,entries)
    def storage_fixture(self,state,entries):
        objects={}
        for upload,item in media.bindings(self.c,state,entries)[0]:
            for bucket,name in [('squad-uploads','pending/'+upload['id']),('canto-media',item['canonical'])]:
                self.c.execute('INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,%s,%s)',(uuid.uuid4(),bucket,name))
                objects[(bucket,name)]=media.bytes_for(state['run_id'],item['kind'])
        return objects
    def http(self,objects,deleted,fail_once=None,corrupt=False):
        class Response:
            status=200
            def __init__(self,data=b''):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return self.data[:limit]
        def send(request,timeout):
            pathname=urlparse(request.full_url).path
            if request.get_method()=='DELETE':
                bucket=pathname.split('/')[-1]
                if fail_once and bucket==fail_once[0]:fail_once[0]=None;raise RuntimeError('Interrupted Storage deletion')
                names=json.loads(request.data)['prefixes']
                for name in names:
                    assert (bucket,name) in objects
                    deleted.append((bucket,name));objects.pop((bucket,name))
                    self.c.execute('DELETE FROM storage.objects WHERE bucket_id=%s AND name=%s',(bucket,name))
                return Response()
            key=tuple(pathname.split('/authenticated/',1)[1].split('/',1));return Response(b'changed' if corrupt else objects[key])
        return send
    def test_exact_storage_bytes_cleanup_and_database_baseline(self):
        state,entries=self.fixture(opaque=True);objects=self.storage_fixture(state,entries);deleted=[]
        with patch('web_catalogue_media_recovery.urllib.request.urlopen',side_effect=self.http(objects,deleted)):
            media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.assertEqual(len(deleted),4);self.assertTrue(state['web_catalogue_media']['storage_deleted']);self.assertEqual(len(state['web_catalogue_media']['storage_receipts']),4)
        result=business.cleanup(self.c,state,journal_entries=entries,media_cleanup=media.cleanup_database);self.assertTrue(result['source_content_restored'])
    def test_wrong_storage_bytes_never_delete(self):
        state,entries=self.fixture();objects=self.storage_fixture(state,entries);deleted=[]
        with patch('web_catalogue_media_recovery.urllib.request.urlopen',side_effect=self.http(objects,deleted,corrupt=True)):
            with self.assertRaisesRegex(AssertionError,'Storage bytes'):media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.assertEqual(deleted,[]);self.assertFalse(state['web_catalogue_media']['storage_deleted'])
    def test_interrupted_storage_cleanup_resumes_exact_receipts(self):
        state,entries=self.fixture();objects=self.storage_fixture(state,entries);deleted=[];fail=['canto-media']
        with patch('web_catalogue_media_recovery.urllib.request.urlopen',side_effect=self.http(objects,deleted,fail)):
            with self.assertRaisesRegex(RuntimeError,'Interrupted'):media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
            self.assertEqual(len(deleted),1);self.assertEqual(len(state['web_catalogue_media']['storage_receipts']),2)
            media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.assertEqual(len(deleted),2);self.assertTrue(state['web_catalogue_media']['storage_deleted'])
    def test_retained_storage_receipt_metadata_change_refused(self):
        state,entries=self.fixture();objects=self.storage_fixture(state,entries);deleted=[];fail=['squad-uploads']
        with patch('web_catalogue_media_recovery.urllib.request.urlopen',side_effect=self.http(objects,deleted,fail)):
            with self.assertRaises(RuntimeError):media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.c.execute("UPDATE storage.objects SET id=%s WHERE bucket_id='canto-media'",(uuid.uuid4(),))
        with patch('web_catalogue_media_recovery.urllib.request.urlopen',side_effect=self.http(objects,deleted)) as http:
            with self.assertRaisesRegex(AssertionError,'Storage changed'):media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.assertEqual(deleted,[])

if __name__=='__main__':unittest.main()
