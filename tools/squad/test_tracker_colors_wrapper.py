"""Local lifecycle boundaries only: no credentials, hosted access or provider."""
import json,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch,Mock
import test_web_tracker_colors_hosted as wrapper

class ColorsWrapper(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.run_id=str(uuid.uuid4());self.state={'run_id':self.run_id,'crons':[]}
  self.checkpoint=self.root/'tracker-colors-checkpoint.json';self.checkpoint.write_text('{}')
 def test_cleanup_receipt_is_durable_before_checkpoint_removed(self):
  proof={'source_content_restored':True}
  with patch.object(wrapper,'PRIVATE',self.root),patch.object(wrapper,'CHECKPOINT',self.checkpoint),patch.object(wrapper,'read_journal',return_value=[]),patch.object(wrapper.fixture,'cleanup',return_value=proof),patch.object(wrapper.fixture.business,'set_crons') as restore,patch.object(wrapper.fixture.business,'cron_state',return_value=[]):
   result=wrapper.cleanup(Mock(),self.state)
  self.assertFalse(self.checkpoint.exists());self.assertTrue(result['acceptance_not_inferred']);self.assertEqual(json.loads((self.root/('tracker-colors-'+self.run_id)/'cleanup-receipt.json').read_text())['cleanup'],proof);restore.assert_called_once()
 def test_refused_cleanup_keeps_checkpoint_and_does_not_restore_schedules(self):
  with patch.object(wrapper,'CHECKPOINT',self.checkpoint),patch.object(wrapper,'read_journal',return_value=[]),patch.object(wrapper.fixture,'cleanup',side_effect=AssertionError('source differs')),patch.object(wrapper.fixture.business,'set_crons') as restore:
   with self.assertRaisesRegex(AssertionError,'source differs'):wrapper.cleanup(Mock(),self.state)
  self.assertTrue(self.checkpoint.exists());restore.assert_not_called()
 def test_failed_receipt_write_keeps_checkpoint_for_idempotent_recovery(self):
  with patch.object(wrapper,'CHECKPOINT',self.checkpoint),patch.object(wrapper,'read_journal',return_value=[]),patch.object(wrapper.fixture,'cleanup',return_value={}),patch.object(wrapper.fixture.business,'set_crons'),patch.object(wrapper.fixture.business,'cron_state',return_value=[]),patch.object(wrapper,'durable',side_effect=OSError('fsync failure')):
   with self.assertRaises(OSError):wrapper.cleanup(Mock(),self.state)
  self.assertTrue(self.checkpoint.exists())
 def test_another_fixture_prevents_lifecycle(self):
  (self.root/'business-checkpoint.json').write_text('{}')
  with patch.object(wrapper,'PRIVATE',self.root),self.assertRaisesRegex(AssertionError,'Another owned fixture'):wrapper.ensure_idle()
 def test_bad_clean_build_never_connects_or_creates_auth(self):
  self.checkpoint.unlink()
  with patch.object(wrapper,'PRIVATE',self.root),patch.object(wrapper,'CHECKPOINT',self.checkpoint),patch.object(wrapper,'frozen_build',side_effect=AssertionError('wrong build')),patch.object(wrapper,'connect') as connect,patch.object(wrapper,'request') as request:
   with self.assertRaisesRegex(AssertionError,'wrong build'):wrapper.run(execute=True)
  connect.assert_not_called();request.assert_not_called()
 def test_current_frozen_manifest_keeps_exact_asset_and_startup_guards(self):
  manifest=json.loads(wrapper.BUILD.read_text())
  self.assertIn(manifest['status'],('built_startup_verified','incremental_built_startup_verified'))
  expected={'base':wrapper.BASE.rstrip('/'),'entry_path':manifest['entry_path'],'entry_sha256':manifest['entry_sha256']}
  with patch.object(wrapper,'frontend_preflight',return_value=expected),patch.object(wrapper,'startup_preflight') as startup:
   self.assertEqual(wrapper.frozen_build(),expected)
  startup.assert_called_once_with(wrapper.BASE)
  with patch.object(wrapper,'frontend_preflight',return_value={**expected,'entry_sha256':'0'*64}),patch.object(wrapper,'startup_preflight') as startup:
   with self.assertRaisesRegex(AssertionError,'Served build differs'):wrapper.frozen_build()
  startup.assert_not_called()
 def test_unknown_build_status_rejected_before_frontend_or_credentials(self):
  manifest=json.loads(wrapper.BUILD.read_text());manifest['status']='incremental_unverified'
  path=self.root/'build.json';path.write_text(json.dumps(manifest))
  with patch.object(wrapper,'BUILD',path),patch.object(wrapper,'frontend_preflight') as frontend,patch.object(wrapper,'startup_preflight') as startup:
   with self.assertRaises(AssertionError):wrapper.frozen_build()
  frontend.assert_not_called();startup.assert_not_called()
 def test_unknown_browser_shutdown_retains_identity_checkpoint(self):
  state={'browser_shutdown_unconfirmed':True}
  self.checkpoint.write_text(json.dumps(state));fake=Mock();fake.execute.return_value.fetchone.return_value=(True,)
  with patch.object(wrapper,'PRIVATE',self.root),patch.object(wrapper,'CHECKPOINT',self.checkpoint),patch.object(wrapper,'connect') as connect,patch.object(wrapper.fixture,'validate',return_value=state),patch.object(wrapper,'cleanup') as cleanup:
   connect.return_value.__enter__.return_value=fake
   with self.assertRaisesRegex(AssertionError,'Verify browser shutdown'):wrapper.run(recover=True)
  cleanup.assert_not_called();self.assertTrue(self.checkpoint.exists())
if __name__=='__main__':unittest.main(verbosity=2)
