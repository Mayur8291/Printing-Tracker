"""Local loopback/lease tests only; no application or hosted fixture traffic."""
import contextlib
import datetime
import http.client
import io
import json
import threading
import unittest

import native_safari_handoff as native


class NativeSafariHandoff(unittest.TestCase):
    def setUp(self):
        self.credential={'email':'fixture@example.invalid','password':'private-test-password</script>'}
    def request(self,server,method='GET',path=None,body=None,headers=None):
        thread=threading.Thread(target=server.handle_request);thread.start()
        try:
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            connection.request(method,path or '/'+server.url.rsplit('/',1)[1],body,headers or {})
            response=connection.getresponse();result=(response.status,dict(response.getheaders()),response.read())
            connection.close();return result
        finally:thread.join(2);self.assertFalse(thread.is_alive())
    def test_lease_uses_actual_expiry_and_reserves_a_minute(self):
        now=datetime.datetime.now(datetime.timezone.utc)
        self.assertEqual(native.lease_seconds(now+datetime.timedelta(minutes=10),now),300)
        self.assertEqual(native.lease_seconds(now+datetime.timedelta(seconds=110),now),50)
        with self.assertRaisesRegex(AssertionError,'Insufficient'):native.lease_seconds(now+datetime.timedelta(seconds=89),now)
        with self.assertRaisesRegex(AssertionError,'Missing'):native.lease_seconds(None,now)
    def test_only_exact_customer_identity_can_be_copied(self):
        actors=[dict(role=3,id='5',auth_id='uuid3',email='customer@example.invalid'),dict(role=0,id='1',auth_id='uuid0',email='admin@example.invalid')]
        state={'identity':{'actors':actors}};credentials=[dict(a,password='secret') for a in actors]
        self.assertEqual(native.customer_credentials(state,credentials),{'email':'customer@example.invalid','password':'secret'})
        credentials[0]['auth_id']='foreign'
        with self.assertRaisesRegex(AssertionError,'mismatch'):native.customer_credentials(state,credentials)
    def test_nonce_no_store_csp_and_no_request_logs(self):
        server=native.make_server(self.credential,30);self.addCleanup(server.server_close)
        output=io.StringIO()
        with contextlib.redirect_stderr(output):status,headers,body=self.request(server)
        self.assertEqual(status,200);self.assertIn('no-store',headers['Cache-Control'])
        self.assertIn("default-src 'none'",headers['Content-Security-Policy']);self.assertIn("connect-src 'self'",headers['Content-Security-Policy'])
        self.assertNotIn('unsafe-inline',headers['Content-Security-Policy']);self.assertEqual(headers['Referrer-Policy'],'no-referrer')
        self.assertEqual(output.getvalue(),'');self.assertNotIn(self.credential['password'],server.url)
        self.assertNotIn(b'password</script>',body);self.assertIn(b'\\u003c/script\\u003e',body)
        self.assertIn(b'clipboard.writeText',body);self.assertNotIn(b'clipboard.read',body)
        self.assertEqual(self.request(server,path='/')[0],404)
        self.assertEqual(self.request(server,headers={'Host':'foreign.invalid'})[0],404)
        self.assertEqual(self.request(server,headers={'Sec-Fetch-Site':'cross-site'})[0],404)
    def test_post_requires_same_origin_and_all_exact_confirmations(self):
        server=native.make_server(self.credential,30);self.addCleanup(server.server_close)
        body=json.dumps({'signed_out':True,'application_tab_closed':True,'clipboard_cleared':True})
        self.assertEqual(self.request(server,'POST',body=body,headers={'Content-Type':'application/json'})[0],403)
        headers={'Content-Type':'application/json','Origin':server.origin}
        self.assertEqual(self.request(server,'POST',body='{}',headers=headers)[0],400);self.assertFalse(server.confirmed)
        self.assertEqual(self.request(server,'POST',body=body.replace('true','1'),headers=headers)[0],400)
        self.assertEqual(self.request(server,'POST',body=body,headers=headers)[0],200);self.assertTrue(server.confirmed)
    def test_expired_server_does_not_serve_credentials(self):
        server=native.make_server(self.credential,-1);self.addCleanup(server.server_close)
        self.assertEqual(self.request(server)[0],404)
    def test_timeout_never_infers_shutdown_or_prints_credentials(self):
        announcements=[]
        with self.assertRaises(native.ShutdownUnconfirmed):native.handoff(self.credential,.01,announcements.append)
        self.assertEqual(len(announcements),1)
        for secret in self.credential.values():self.assertNotIn(secret,json.dumps(announcements))
    def test_success_requires_real_explicit_http_acknowledgement(self):
        workers=[]
        def announce(message):
            from urllib.parse import urlparse
            url=urlparse(message['native_safari_handoff_url'])
            def confirm():
                connection=http.client.HTTPConnection(url.hostname,url.port,timeout=2)
                connection.request('POST',url.path,json.dumps({'signed_out':True,'application_tab_closed':True,'clipboard_cleared':True}),{'Origin':f'http://{url.netloc}','Content-Type':'application/json'})
                self.assertEqual(connection.getresponse().status,200);connection.close()
            thread=threading.Thread(target=confirm);thread.start();workers.append(thread)
        result=native.handoff(self.credential,2,announce)
        for worker in workers:worker.join(2)
        self.assertEqual(result,{'shutdown_confirmed':True,'manual_acceptance_not_inferred':True})


if __name__=='__main__':unittest.main()
