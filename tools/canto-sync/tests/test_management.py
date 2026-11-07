import http.client,io,json,sys,unittest,urllib.error
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import management
class ManagementRetryTests(unittest.TestCase):
 def test_reads_retry_transient_gateway_errors(self):
  for path,body in [('/config/database/pooler',None),('/database/query/read-only',{'query':'SELECT 1'}),('/cli/login-role',{'read_only':True})]:
   with self.subTest(path=path),mock.patch.object(management,'token',return_value='test'),mock.patch.object(management.time,'sleep'),mock.patch.object(management.urllib.request,'urlopen',side_effect=[urllib.error.HTTPError('https://example.test',502,'Bad Gateway',{},None),io.BytesIO(b'{"ok":true}')]) as request:
    self.assertEqual(management.api('staging',path,body),{'ok':True});self.assertEqual(request.call_count,2)
 def test_mutating_sql_is_not_replayed(self):
  with mock.patch.object(management,'token',return_value='test'),mock.patch.object(management.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('https://example.test',502,'Bad Gateway',{},None)) as request:
   with self.assertRaises(urllib.error.HTTPError):management.api('staging','/database/query',{'query':'INSERT INTO example VALUES(1)'})
   self.assertEqual(request.call_count,1)
 def test_auth_errors_are_not_retried(self):
  with mock.patch.object(management,'token',return_value='test'),mock.patch.object(management.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('https://example.test',401,'Unauthorized',{},None)) as request:
   with self.assertRaises(urllib.error.HTTPError):management.api('staging','/config/database/pooler')
   self.assertEqual(request.call_count,1)
 def test_incomplete_read_retries_only_safe_operations(self):
  with mock.patch.object(management,'token',return_value='test'),mock.patch.object(management.time,'sleep'),mock.patch.object(management.urllib.request,'urlopen',side_effect=[http.client.IncompleteRead(b'',3),io.BytesIO(b'[]')]) as request:
   self.assertEqual(management.api('staging','/api-keys'),[]);self.assertEqual(request.call_count,2)
if __name__=='__main__':unittest.main()
