"""Actual plan_fixture/SQL receipts for dedicated browser orchestration, local only."""
import copy,json,unittest,contextlib,io,tempfile,subprocess
from pathlib import Path
from unittest.mock import patch,Mock
import test_web_catalogue_media_recovery as base
import test_web_catalogue_media_hosted as runner
import test_hosted_business_journeys as business
import web_catalogue_media_recovery as media

class CatalogueMediaHarness(base.CatalogueMediaRecovery):
    # Keep this runner suite focused instead of inheriting all recovery cases.
    def report(self,state,entries):
        owned,roots,_=media.bindings(self.c,state,entries);p=state['web_catalogue_media']
        return {'environment':'staging','run_id':state['run_id'],'browser_errors':0,'network_violations':0,'journeys':{'catalogue-media':{
            'uploadIds':[u['id'] for u,_ in owned],
            'cleanupProof':{'passed':True,'observations_only':True,'product_id':str(roots['product']),'branding_id':str(roots['branding']) if p['opaque'] else None,'independent_server_cleanup_required':True},
            'downloads':[{'downloaded':True,'bytes':f['bytes'],'sha256':f['sha256']} for f in p['files']],
            'checks':['actual_ui_owned_design_png_append_preview_exact_download_guidelines_create_edit_and_detach']+(['actual_ui_owned_unlinked_branding_opaque_upload_download_only_exact_bytes_and_detach'] if p['opaque'] else [])}}}
    def test_real_plan_preflight_and_payload_shape(self):
        state=business.plan(self.c)
        # The isolated database intentionally carries no Storage service buckets.
        self.c.execute("INSERT INTO storage.buckets(id,name,public) VALUES('squad-uploads','squad-uploads',false),('canto-media','canto-media',false) ON CONFLICT(id) DO UPDATE SET public=false")
        summary=runner.preflight(self.c,state,True);self.assertEqual(summary['mode'],'read-only preflight')
        self.assertNotIn('rmpClassId',state['fixture']['ids']);self.assertIn('rmpClassId',state['fixture']['commercialExtras'])
        credentials=business.prepare(self.c,state);payload=runner.payload_for(state,credentials,'local-only')
        self.assertEqual(payload['fixture']['customConfig'],payload['web_catalogue_media']['configuration'])
        self.assertEqual(payload['web_catalogue_media']['legacy_id'],state['fixture']['actors']['3']);self.assertEqual(len(payload['web_catalogue_media']['files']),2)
        self.assertNotIn('before',payload['web_catalogue_media'])
        checked=subprocess.run(['node','tools/squad/web-catalogue-media-capability-check.mjs'],cwd=business.ROOT,input=json.dumps(payload),text=True,capture_output=True,check=True)
        self.assertTrue(json.loads(checked.stdout)['passed'])
    def test_default_run_is_readonly_and_does_not_fetch_service_credentials(self):
        self.c.execute("INSERT INTO storage.buckets(id,name,public) VALUES('squad-uploads','squad-uploads',false),('canto-media','canto-media',false) ON CONFLICT(id) DO UPDATE SET public=false")
        before=business.source_state(self.c)
        with tempfile.TemporaryDirectory() as folder,patch.object(business,'CHECKPOINT',Path(folder)/'checkpoint.json'),patch.object(business.identities,'connect',return_value=contextlib.nullcontext(self.c)),patch.object(runner,'api') as api,patch.object(runner,'child') as child,patch.object(business,'save') as save,contextlib.redirect_stdout(io.StringIO()) as output:
            runner.run(opaque=True)
            self.assertEqual(json.loads(output.getvalue())['mode'],'read-only preflight');api.assert_not_called();child.assert_not_called();save.assert_not_called()
        self.assertEqual(business.source_state(self.c),before)
    def test_child_failure_restores_real_fixture_and_removes_only_own_checkpoint(self):
        self.c.execute("INSERT INTO storage.buckets(id,name,public) VALUES('squad-uploads','squad-uploads',false),('canto-media','canto-media',false) ON CONFLICT(id) DO UPDATE SET public=false")
        before=business.source_state(self.c)
        with tempfile.TemporaryDirectory() as folder,patch.object(business,'PRIVATE',Path(folder)),patch.object(business,'CHECKPOINT',Path(folder)/'business-checkpoint.json'),patch.object(business.identities,'connect',return_value=contextlib.nullcontext(self.c)),patch.object(business.identities,'keys',return_value='local-anon'),patch.object(runner,'api',return_value=[{'name':'service_role','api_key':'local-service'}]),patch.object(runner,'child',side_effect=RuntimeError('Injected browser failure')) as child:
            with self.assertRaisesRegex(RuntimeError,'Injected browser failure'):runner.run(execute=True,opaque=True)
            args,kwargs=child.call_args
            self.assertEqual(kwargs['env']['SQUAD_WEB_JOURNEYS'],'catalogue-media')
            self.assertFalse(business.CHECKPOINT.exists())
        self.assertEqual(business.source_state(self.c),before)
        self.assertEqual(self.c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone(),(False,[],None))
    def test_checkpoint_is_retained_when_cleanup_refuses(self):
        self.c.execute("INSERT INTO storage.buckets(id,name,public) VALUES('squad-uploads','squad-uploads',false),('canto-media','canto-media',false) ON CONFLICT(id) DO UPDATE SET public=false")
        with tempfile.TemporaryDirectory() as folder,patch.object(business,'PRIVATE',Path(folder)),patch.object(business,'CHECKPOINT',Path(folder)/'business-checkpoint.json'),patch.object(business.identities,'connect',return_value=contextlib.nullcontext(self.c)),patch.object(business.identities,'keys',return_value='local-anon'),patch.object(runner,'api',return_value=[{'name':'service_role','api_key':'local-service'}]),patch.object(runner,'child',side_effect=RuntimeError('Injected browser failure')),patch.object(runner,'cleanup',side_effect=AssertionError('Unsettled exact upload')):
            with self.assertRaisesRegex(AssertionError,'Unsettled exact upload'):runner.run(execute=True)
            self.assertTrue(business.CHECKPOINT.exists());saved=json.loads(business.CHECKPOINT.read_text());self.assertEqual(saved['web_catalogue_media']['format'],media.FORMAT)
    def test_actual_server_receipts_bind_report_before_acceptance(self):
        state,entries=self.fixture(opaque=True);report=self.report(state,entries)
        with patch.object(business,'journal',return_value=entries):
            result=runner.bind_report(self.c,state,report)
        self.assertEqual(result,{'server_bound_roots':2,'exact_uploads':2,'exact_downloads':2,'retained_audit_proof':True})
    def test_forged_report_ids_and_downloads_refused(self):
        state,entries=self.fixture(opaque=True);report=self.report(state,entries)
        for path,value in [('uploadIds',['00000000-0000-4000-8000-000000000001']),('downloads',[]),('checks',[])]:
            changed=copy.deepcopy(report);changed['journeys']['catalogue-media'][path]=value
            with self.subTest(path=path),patch.object(business,'journal',return_value=entries),self.assertRaises(AssertionError):runner.bind_report(self.c,state,changed)
        changed=copy.deepcopy(report);changed['journeys']['catalogue-media']['cleanupProof']['product_id']='1'
        with patch.object(business,'journal',return_value=entries),self.assertRaises(AssertionError):runner.bind_report(self.c,state,changed)
    def test_missing_server_journal_cannot_use_browser_root_as_proof(self):
        state,entries=self.fixture();report=self.report(state,entries)
        with patch.object(business,'journal',return_value=[]),self.assertRaisesRegex(AssertionError,'Unjournaled'):runner.bind_report(self.c,state,report)
    def test_attached_media_cannot_be_reported_as_detached(self):
        state,entries=self.fixture(detach=False);report=self.report(state,entries)
        with patch.object(business,'journal',return_value=entries),self.assertRaisesRegex(AssertionError,'remains active'):runner.bind_report(self.c,state,report)
    def test_wrong_harness_marker_refused_before_cleanup(self):
        state,entries=self.fixture();state['web_media']={'not':'this rehearsal'}
        with patch.object(media,'cleanup_storage') as storage,self.assertRaisesRegex(AssertionError,'Wrong rehearsal'):runner.cleanup(self.c,state,'unused')
        storage.assert_not_called()
    def test_storage_failure_stops_source_cleanup(self):
        state,entries=self.fixture()
        with patch.object(business,'journal',return_value=entries),patch.object(media,'cleanup_storage',side_effect=AssertionError('changed bytes')),patch.object(business,'cleanup') as clean:
            with self.assertRaisesRegex(AssertionError,'changed bytes'):runner.cleanup(self.c,state,'unused')
        clean.assert_not_called()
    def test_actual_cleanup_and_recovery_preserve_history(self):
        state,entries=self.fixture(opaque=True);objects=self.storage_fixture(state,entries);deleted=[]
        with patch.object(business,'journal',return_value=entries),patch.object(business,'save'),patch('web_catalogue_media_recovery.urllib.request.urlopen',side_effect=self.http(objects,deleted)):
            first=runner.cleanup(self.c,state,'unused');second=runner.cleanup(self.c,state,'unused')
        self.assertEqual(first,second);self.assertTrue(first['source_content_restored']);self.assertTrue(first['media']['upload_history_and_audits_retained']);self.assertEqual(len(deleted),4)

# Only use the inherited SQL setup/helpers, not duplicate its 21 test methods.
for name in dir(base.CatalogueMediaRecovery):
    if name.startswith('test_') and name not in CatalogueMediaHarness.__dict__:setattr(CatalogueMediaHarness,name,None)
if __name__=='__main__':unittest.main()
