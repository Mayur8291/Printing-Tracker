import copy,hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import deployed_frontend_manifest as manifest
import browser_entry_manifest as entry

BASE='https://scottdashboard.vercel.app'
BODY=b'export const productionMode=true;'
RELEASE={'format':manifest.FORMAT,'base':BASE,'entry_path':'/assets/index-release.js','entry_sha256':hashlib.sha256(BODY).hexdigest(),'git_commit':'a'*40,'deployment_id':'dpl_Reviewed123456'}
class Response:
 def __init__(self,url,body):self.url=url;self.body=body;self.status=200
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def geturl(self):return self.url
 def read(self,n):return self.body[:n]
class DeployedManifest(unittest.TestCase):
 def test_exact_receipt_and_allowed_origins(self):
  self.assertEqual(manifest.validate_release(RELEASE),RELEASE)
  self.assertEqual(manifest.deployed_base('https://scottdashboard-abc123-mayur8291s-projects.vercel.app/'),'https://scottdashboard-abc123-mayur8291s-projects.vercel.app')
  for url in ['https://outside.vercel.app','https://scottdashboard.vercel.app.evil.test','http://scottdashboard.vercel.app','https://u:p@scottdashboard.vercel.app','https://scottdashboard.vercel.app:443','https://scottdashboard.vercel.app/a','https://scottdashboard.vercel.app?x=1']:
   with self.subTest(url=url),self.assertRaises(AssertionError):manifest.deployed_base(url)
 def test_receipt_requires_exact_build_and_provenance_fields(self):
  for key,value in [('git_commit','short'),('deployment_id','unknown'),('entry_sha256','bad'),('entry_path','/src/main.jsx'),('base','https://outside.invalid')]:
   with self.subTest(key=key),self.assertRaises(AssertionError):manifest.validate_release({**RELEASE,key:value})
  with self.assertRaises(AssertionError):manifest.validate_release({**RELEASE,'token':'never accepted'})
 def fetch(self,body=BODY,html=None):
  reads=[]
  def open_(url,timeout):
   reads.append(url);return Response(url,(html or b'<script type="module" src="/assets/index-release.js"></script>') if url==BASE+'/' else body)
  with patch('browser_entry_manifest.urllib.request.build_opener') as build:
   build.return_value.open.side_effect=open_;result=entry.frontend_preflight(BASE,RELEASE)
  return result,reads
 def test_cloud_checks_reviewed_bytes_not_local_staging_bundle(self):
  result,reads=self.fetch();self.assertEqual(result,manifest.release_frontend(RELEASE));self.assertEqual(reads,[BASE+'/',BASE+RELEASE['entry_path']])
 def test_changed_bytes_and_entry_fail_closed(self):
  with self.assertRaisesRegex(AssertionError,'bytes differ'):self.fetch(b'changed deployment')
  with self.assertRaisesRegex(AssertionError,'entry differs'):self.fetch(html=b'<script type="module" src="https://outside.invalid/payload.js"></script>')
 def test_cloud_without_receipt_still_rejected(self):
  with self.assertRaisesRegex(AssertionError,'loopback'):entry.frontend_preflight(BASE)
 def test_manifest_origin_mismatch_before_any_fixture(self):
  import test_web_cross_browser_hosted as cross
  import test_web_tracker_read_hosted as tracker
  with tempfile.TemporaryDirectory() as folder:
   file=Path(folder)/'release.json';file.write_text(json.dumps(RELEASE))
   for harness,check in [(cross,'business.identities.connect'),(tracker,'connect')]:
    with patch.object(harness,'CHECKPOINT',Path(folder)/'absent',create=True),patch('test_web_cross_browser_hosted.business.CHECKPOINT',Path(folder)/'absent'),patch('test_web_cross_browser_hosted.check_engine',return_value={}),patch(harness.__name__+'.'+check) as connect:
     with self.assertRaisesRegex(AssertionError,'another origin'):harness.run(base='https://scottdashboard-other-mayur8291s-projects.vercel.app',release_manifest=str(file))
     connect.assert_not_called()
 def test_tracker_explicit_receipt_does_not_read_local_dist(self):
  import test_web_tracker_read_hosted as tracker
  with patch.object(tracker,'reviewed_frontend_preflight',return_value=manifest.release_frontend(RELEASE)) as check,patch.object(tracker,'startup_preflight',return_value={'ready':True}):
   result=tracker.frontend_preflight(BASE,RELEASE);check.assert_called_once_with(BASE,RELEASE);self.assertTrue(result['matches_reviewed_release']);self.assertNotIn('matches_admin_dist',result)
if __name__=='__main__':unittest.main()
