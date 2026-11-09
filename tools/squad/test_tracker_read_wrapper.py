"""No network: subprocess privacy, frontend target and completion contract."""
import hashlib,io,json,subprocess,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import test_web_tracker_read_hosted as wrapper
class TrackerReadWrapper(unittest.TestCase):
 def payload(self):return {'anon':'secret-anon','actors':[{'id':'private-uuid','email':'private-email@example.invalid','session':{'access_token':'secret-access','refresh_token':'secret-refresh'}}]}
 def test_failed_child_redacts_all_session_and_identity_fields(self):
  payload=self.payload();secrets=['secret-anon','private-uuid','private-email@example.invalid','secret-access','secret-refresh']
  with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'',' '.join(secrets))):
   with self.assertRaises(RuntimeError):wrapper.child(['node'],payload,Path(tmp),'browser',1)
   saved=(Path(tmp)/'browser-failure.json').read_text();self.assertFalse(any(secret in saved for secret in secrets));self.assertIn('[redacted]',saved)
 def test_timeout_stderr_redacts_session(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper.subprocess,'run',side_effect=subprocess.TimeoutExpired([],1,stderr=b'secret-refresh')):
   with self.assertRaises(RuntimeError):wrapper.child(['node'],self.payload(),Path(tmp),'browser',1)
   self.assertNotIn('secret-refresh',(Path(tmp)/'browser-failure.json').read_text())
 def test_external_signal_requires_shutdown_review(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],-9,'','secret-access')):
   with self.assertRaises(wrapper.BrowserShutdownUnconfirmed):wrapper.child(['node'],self.payload(),Path(tmp),'browser',1)
   report=json.loads((Path(tmp)/'browser-failure.json').read_text());self.assertEqual(report['signal'],9);self.assertNotIn('secret-access',str(report))
 def test_child_explicit_unconfirmed_close_requires_shutdown_review(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],2,'','secret-refresh')):
   with self.assertRaises(wrapper.BrowserShutdownUnconfirmed):wrapper.child(['node'],self.payload(),Path(tmp),'browser',1)
   report=json.loads((Path(tmp)/'browser-failure.json').read_text());self.assertEqual(report['failure'],'browser_shutdown_unconfirmed');self.assertNotIn('secret-refresh',str(report))
 def test_success_refuses_session_echo_before_artifact(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps({'complete':True,'environment':'staging','leak':'secret-access'}),'')):
   with self.assertRaisesRegex(AssertionError,'private identity'):wrapper.child(['node'],self.payload(),Path(tmp),'browser',1)
   self.assertEqual(list(Path(tmp).iterdir()),[])
 def test_only_completed_staging_result_accepted(self):
  for report in [{'complete':False,'environment':'staging'},{'complete':True,'environment':'production'}]:
   with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(report),'')):
    with self.assertRaises(AssertionError):wrapper.child(['node'],self.payload(),Path(tmp),'browser',1)
 def test_frontend_exact_allowlist(self):
  self.assertEqual(wrapper.base_url('http://localhost:5184'),'http://localhost:5184/')
  self.assertEqual(wrapper.base_url('https://scottdashboard-ab123-mayur8291s-projects.vercel.app'),'https://scottdashboard-ab123-mayur8291s-projects.vercel.app/')
  for url in ['https://foreign.example','https://scottdashboard.vercel.app.evil.test','https://user:pass@scottdashboard.vercel.app','https://scottdashboard.vercel.app/?token=value','https://scottdashboard-evil!-mayur8291s-projects.vercel.app','https:///']:
   with self.assertRaises(AssertionError):wrapper.base_url(url)
 def test_preflight_matches_local_entry_name_and_exact_bytes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);dist=root/'apps/admin/dist';(dist/'assets').mkdir(parents=True)
   html='<script src="/assets/index-test.js" type="module"></script>';code=b'const frozen=true;'
   (dist/'index.html').write_text(html);(dist/'assets/index-test.js').write_bytes(code)
   class Response(io.BytesIO):
    status=200
    def geturl(self):return self.url
   def response(request,timeout):
    self.assertEqual(timeout,15);r=Response(html.encode() if request.full_url.endswith('/') else code);r.url=request.full_url;return r
   with patch.object(wrapper,'ROOT',root),patch.object(wrapper.urllib.request,'build_opener') as opener,patch.object(wrapper,'startup_preflight',return_value={'ready':True}) as startup:
    opener.return_value.open.side_effect=response
    self.assertEqual(wrapper.frontend_preflight('http://localhost:5185'),{'path':'/assets/index-test.js','sha256':hashlib.sha256(code).hexdigest(),'matches_admin_dist':True,'startup':{'ready':True}});startup.assert_called_once()
    def wrong_name(request,timeout):
     r=Response(html.replace('index-test','index-stale').encode());r.url=request.full_url;return r
    opener.return_value.open.side_effect=wrong_name
    with self.assertRaisesRegex(AssertionError,'entry differs'):wrapper.frontend_preflight('http://localhost:5185')
    def wrong_bytes(request,timeout):
     r=response(request,timeout)
     if not request.full_url.endswith('/'):r=Response(b'wrong build');r.url=request.full_url
     return r
    opener.return_value.open.side_effect=wrong_bytes
    with self.assertRaisesRegex(AssertionError,'bytes differ'):wrapper.frontend_preflight('http://localhost:5185')
 def test_failed_build_preflight_precedes_database_keys_and_accounts(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(wrapper,'CHECKPOINT',Path(tmp)/'absent'),patch.object(wrapper,'frontend_preflight',side_effect=AssertionError('Wrong frontend')),patch.object(wrapper,'connect') as connect,patch.object(wrapper,'api') as api,patch.object(wrapper,'request') as request:
   with self.assertRaisesRegex(AssertionError,'Wrong frontend'):wrapper.run(execute=True,base='http://localhost:5185')
   connect.assert_not_called();api.assert_not_called();request.assert_not_called()
 def test_entry_parser_rejects_dev_or_external_modules(self):
  for html in ['<script type="module" src="/src/main.jsx"></script>','<script type="module" src="https://foreign.test/assets/index-test.js"></script>','<script type="module" src="/assets/index-one.js"></script><script type="module" src="/assets/index-two.js"></script>']:
   with self.assertRaisesRegex(AssertionError,'one built'):wrapper.built_entry(html)
 def test_anonymous_startup_error_fails_and_clean_result_passes(self):
  with patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],1,json.dumps({'ready':False,'errors':[{'name':'Error','message':'Missing Supabase env vars'}]}),'')):
   with self.assertRaisesRegex(AssertionError,'Missing Supabase env'):wrapper.startup_preflight('http://localhost:5185')
  with patch.object(wrapper.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps({'ready':True,'errors':[]}),'')):
   self.assertTrue(wrapper.startup_preflight('http://localhost:5185')['ready'])
 def test_cleanup_receipt_is_durable_before_checkpoint_removal(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);checkpoint=root/'checkpoint.json';checkpoint.write_text('{}');state={'run_id':str(uuid.uuid4()),'public_structure':{'same':True}};proof={'owned_profiles_removed':2}
   with patch.object(wrapper,'ROOT',root),patch.object(wrapper,'CHECKPOINT',checkpoint),patch.object(wrapper.fixture,'cleanup',return_value=proof),patch.object(wrapper,'public_structure',return_value=state['public_structure']):
    self.assertEqual(wrapper.cleanup_with_receipt(None,state),proof)
    receipt=root/'tools/squad/private'/('tracker-read-'+state['run_id'])/'cleanup-receipt.json'
    self.assertEqual(json.loads(receipt.read_text())['cleanup'],proof);self.assertEqual(receipt.stat().st_mode&0o777,0o600);self.assertFalse(checkpoint.exists())
 def test_cleanup_receipt_failure_keeps_checkpoint(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);checkpoint=root/'checkpoint.json';checkpoint.write_text('{}');state={'run_id':str(uuid.uuid4()),'public_structure':{}}
   with patch.object(wrapper,'ROOT',root),patch.object(wrapper,'CHECKPOINT',checkpoint),patch.object(wrapper.fixture,'cleanup',return_value={}),patch.object(wrapper,'public_structure',return_value={}),patch.object(wrapper.os,'fsync',side_effect=OSError('disk error')):
    with self.assertRaisesRegex(OSError,'disk error'):wrapper.cleanup_with_receipt(None,state)
    self.assertTrue(checkpoint.exists())
 def test_cleanup_receipt_directory_fsync_failure_keeps_checkpoint(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);checkpoint=root/'checkpoint.json';checkpoint.write_text('{}');state={'run_id':str(uuid.uuid4()),'public_structure':{}}
   with patch.object(wrapper,'ROOT',root),patch.object(wrapper,'CHECKPOINT',checkpoint),patch.object(wrapper.fixture,'cleanup',return_value={}),patch.object(wrapper,'public_structure',return_value={}),patch.object(wrapper.os,'fsync',side_effect=[None,OSError('directory not durable')]) as fsync:
    with self.assertRaisesRegex(OSError,'directory not durable'):wrapper.cleanup_with_receipt(None,state)
    self.assertEqual(fsync.call_count,2);self.assertTrue(checkpoint.exists())
    self.assertTrue((root/'tools/squad/private'/('tracker-read-'+state['run_id'])/'cleanup-receipt.json').is_file())
if __name__=='__main__':unittest.main(verbosity=2)
