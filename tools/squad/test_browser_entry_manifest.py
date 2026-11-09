import hashlib
import threading
import unittest
from http.server import BaseHTTPRequestHandler,HTTPServer
from browser_entry_manifest import frontend_preflight,loopback_base

class EntryManifest(unittest.TestCase):
    def setUp(self):
        self.routes={'/':(200,b'<script type="module" src="/assets/index-fixture.js"></script>'),'/assets/index-fixture.js':(200,b'export const fixture=true;')};self.requests=[]
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                owner.requests.append(self.path);status,body=owner.routes.get(self.path,(404,b''));self.send_response(status)
                if status==302:self.send_header('Location','http://outside.invalid/entry.js')
                self.end_headers();self.wfile.write(body)
        self.server=HTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def test_static_entry_uses_exact_same_origin_bytes(self):
        result=frontend_preflight(self.base);self.assertEqual(result,{'base':self.base,'entry_path':'/assets/index-fixture.js','entry_sha256':hashlib.sha256(self.routes['/assets/index-fixture.js'][1]).hexdigest()});self.assertEqual(self.requests,['/','/assets/index-fixture.js'])
    def test_default_vite_development_entry_remains_supported(self):
        self.routes['/']=(200,b'<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.jsx?t=1794195594068"></script>');self.routes['/src/main.jsx?t=1794195594068']=(200,b'transformed-dev-entry');self.assertEqual(frontend_preflight(self.base)['entry_path'],'/src/main.jsx?t=1794195594068');self.assertNotIn('/@vite/client',self.requests)
    def test_external_entry_rejected_before_followup_request(self):
        self.routes['/']=(200,b'<script type="module" src="https://outside.invalid/entry.js"></script>')
        with self.assertRaisesRegex(AssertionError,'Unsupported application entry'):frontend_preflight(self.base)
        self.assertEqual(self.requests,['/'])
    def test_redirect_is_not_followed(self):
        self.routes['/']=(302,b'')
        with self.assertRaisesRegex(AssertionError,'redirects'):frontend_preflight(self.base)
        self.assertEqual(self.requests,['/'])
    def test_multiple_entry_modules_are_rejected(self):
        self.routes['/']=(200,b'<script type="module" src="/assets/index-a.js"></script><script type="module" src="/assets/index-b.js"></script>')
        with self.assertRaisesRegex(AssertionError,'Exactly one'):frontend_preflight(self.base)
    def test_nonloopback_and_ambiguous_origins_rejected(self):
        for value in ['https://localhost:5186','http://outside.invalid:5186','http://user:pass@localhost:5186','http://localhost:5186/a','http://localhost:5186?x=1','http://localhost:5186#x','http://localhost:0','http://localhost']:
            with self.subTest(value=value),self.assertRaises(AssertionError):loopback_base(value)
        self.assertEqual(loopback_base('http://localhost:5183/'),'http://localhost:5183')

if __name__=='__main__':unittest.main()
