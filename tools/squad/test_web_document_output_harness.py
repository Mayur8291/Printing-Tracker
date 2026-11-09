"""Local-only harness boundary tests; no hosted connection or credentials."""
import json
import os
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch

import test_web_document_outputs_hosted as harness


class WebOutputHarness(unittest.TestCase):
    def test_report_selects_only_two_jobs_and_always_binds_server_audit(self):
        ids=[str(uuid.uuid4()) for _ in range(3)]
        state={'run_id':str(uuid.uuid4())}
        report={'environment':'staging','run_id':state['run_id'],'journeys':{'commerce':{},'operations':{},'feedback':{},'reporting':{'entities':{'documentIds':ids}}}}
        c=Mock();c.execute.return_value.fetchall.return_value=list(zip(ids,['tailor_weekly','delivery_challan','catalogue'],[4,7,3]))
        with patch.object(harness.recovery,'bindings',return_value=['bound']) as binding:
            self.assertEqual(harness.select_requests(c,state,report),['bound'])
            binding.assert_called_once_with(c,state)
        self.assertEqual(state['web_document_output_requests'],[{'document_id':ids[1],'kind':'delivery_challan','role':7},{'document_id':ids[0],'kind':'tailor_weekly','role':4}])
        c.execute.return_value.fetchall.return_value=list(zip(ids,['tailor_weekly','delivery_challan','catalogue'],[3,7,3]))
        with self.assertRaises(AssertionError):harness.select_requests(c,state,report)
        report['journeys']['account']={}
        with self.assertRaises(AssertionError):harness.select_requests(c,state,report)

    def test_child_retains_success_report_before_cleanup_without_credentials(self):
        payload={'actors':[{'password':'synthetic-password'}],'worker_secret':'synthetic-worker-secret','anon':'synthetic-anon'}
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            with patch.object(harness.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"passed":true}',stderr='')):
                self.assertEqual(harness.child(['node','adapter'],payload,folder,'browser',1),{'passed':True})
            report=folder/'browser-report.json'
            self.assertEqual(json.loads(report.read_text()),{'passed':True})
            self.assertEqual(os.stat(report).st_mode&0o777,0o600)

    def test_failure_and_timeout_diagnostics_redact_secrets(self):
        payload={'actors':[{'password':'synthetic-password'}],'worker_secret':'synthetic-worker-secret','anon':'synthetic-anon'}
        diagnostic='synthetic-password synthetic-worker-secret synthetic-anon'
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            with patch.object(harness.subprocess,'run',return_value=SimpleNamespace(returncode=1,stderr=diagnostic)):
                with self.assertRaises(RuntimeError):harness.child(['node','adapter'],payload,folder,'browser',1)
            text=(folder/'browser-failure.json').read_text()
            self.assertNotIn('synthetic-',text);self.assertIn('[redacted]',text)
            with patch.object(harness.subprocess,'run',side_effect=subprocess.TimeoutExpired(['node'],1,stderr=diagnostic.encode())):
                with self.assertRaises(RuntimeError):harness.child(['node','adapter'],payload,folder,'timeout',1)
            self.assertNotIn('synthetic-',(folder/'timeout-failure.json').read_text())

    def test_echoed_credentials_are_not_persisted(self):
        payload={'actors':[{'password':'synthetic-password'}]}
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            with patch.object(harness.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"leak":"synthetic-password"}',stderr='')):
                with self.assertRaises(AssertionError):harness.child(['node','adapter'],payload,folder,'browser',1)
            self.assertEqual(list(folder.iterdir()),[])


if __name__=='__main__':unittest.main(verbosity=2)
