"""Ephemeral, loopback-only Customer credential handoff; never stores secrets.

This is a human-operated acceptance aid, not a browser automation or pass oracle.
An unacknowledged handoff must retain the parent fixture for explicit recovery.
"""
import datetime
import json
import secrets
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class ShutdownUnconfirmed(RuntimeError):
    def __init__(self):
        super().__init__('Native Safari shutdown is unconfirmed; retain the fixture checkpoint')


def lease_seconds(expires_at, now=None):
    now=now or datetime.datetime.now(datetime.timezone.utc)
    assert isinstance(expires_at,datetime.datetime) and expires_at.tzinfo is not None,'Missing actual fixture lease'
    seconds=min(300,int((expires_at-now).total_seconds())-60)
    assert seconds>=30,'Insufficient fixture lease for native Safari; no credentials exposed'
    return seconds


def customer_credentials(state,credentials):
    expected=[a for a in state['identity']['actors'] if a['role']==3]
    actual=[a for a in credentials if a['role']==3]
    assert len(expected)==len(actual)==1,'Exactly one fixture Customer is required'
    assert all(actual[0][key]==expected[0][key] for key in ('id','auth_id','email')),'Customer identity mismatch'
    assert isinstance(actual[0].get('password'),str) and actual[0]['password'],'Customer credential unavailable'
    return {'email':actual[0]['email'],'password':actual[0]['password']}


def page_html(credential,nonce):
    # HTML script closing sequences cannot be introduced by credential strings.
    encoded=json.dumps(credential).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    return ('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Native Safari test handoff</title><style nonce="NONCE">
body{font:17px system-ui;max-width:580px;margin:40px auto;padding:24px;color:#17202a;background:#fff}button{font:inherit;padding:12px 18px;margin:8px 8px 8px 0}label{display:block;margin:20px 0}input{margin-right:10px}#status{min-height:2em}small{display:block;line-height:1.6}
</style><h1>Native Safari test handoff</h1>
<p>Use the disposable staging Customer in the application test tab. These credentials remain in memory only.</p>
<p><strong>Read-only test:</strong> after signing in, only navigate, read, test keyboard/date filters, and download the preselected authorized file. Do not save or submit business forms, upload files, place orders, or change data. Native Safari has no request-blocking interceptor.</p>
<button id="email">Copy test email</button><button id="password">Copy test password</button>
<p id="status" role="status" aria-live="polite"></p>
<small>Keep this tab open. Finish before the parent deadline. Do not save credentials in Safari. When finished, sign out in the application, close that application tab, and confirm both below. Closing this page alone does not permit fixture cleanup.</small>
<label><input type="checkbox" id="out">I signed out of the application.</label>
<label><input type="checkbox" id="closed">I closed the application test tab.</label>
<button id="finish" disabled>Finished — clear clipboard and release fixture</button>
<script nonce="NONCE">
let credential=CREDENTIAL;const status=document.querySelector('#status');const finish=document.querySelector('#finish');
for(const key of ['email','password'])document.getElementById(key).onclick=async()=>{try{await navigator.clipboard.writeText(credential[key]);status.textContent='Copied. Paste into the application test tab.';}catch{status.textContent='Clipboard access failed. No credential was displayed. Retry with a direct click.';}};
for(const key of ['out','closed'])document.getElementById(key).onchange=()=>{finish.disabled=!(document.getElementById('out').checked&&document.getElementById('closed').checked);};
finish.onclick=async()=>{finish.disabled=true;try{await navigator.clipboard.writeText('');credential=null;document.getElementById('email').disabled=true;document.getElementById('password').disabled=true;
const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signed_out:true,application_tab_closed:true,clipboard_cleared:true})});if(!response.ok)throw Error();status.textContent='Shutdown acknowledged. Close this handoff tab. The parent will verify and clean up the fixture.';}
catch{status.textContent='Acknowledgement failed. Keep the fixture checkpoint; notify the test owner.';}};
addEventListener('pagehide',()=>{credential=null;});
</script></html>'''.replace('NONCE',nonce).replace('CREDENTIAL',encoded)).encode()


def make_server(credential,seconds):
    """Expose no endpoints beyond one unguessable path; callers own server close."""
    nonce=secrets.token_urlsafe(32)
    html=page_html(credential,nonce)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def log_error(self,*args):pass
        def allowed(self):
            return (self.path=='/'+nonce and self.headers.get('Host')==self.server.authority
                    and self.headers.get('Sec-Fetch-Site','none') in ('none','same-origin')
                    and time.monotonic()<self.server.deadline)
        def respond(self,status,body=b''):
            self.send_response(status);self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store, max-age=0')
            self.send_header('Pragma','no-cache');self.send_header('Referrer-Policy','no-referrer')
            self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cross-Origin-Resource-Policy','same-origin')
            self.send_header('Content-Security-Policy',f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'")
            self.end_headers();self.wfile.write(body)
        def do_GET(self):self.respond(200,html) if self.allowed() else self.respond(404)
        def do_POST(self):
            if not self.allowed() or self.headers.get('Origin')!=self.server.origin:return self.respond(403)
            if self.headers.get('Content-Type')!='application/json' or self.headers.get('Transfer-Encoding'):return self.respond(400)
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=256:return self.respond(400)
                body=json.loads(self.rfile.read(length))
                if (not isinstance(body,dict) or set(body)!={'signed_out','application_tab_closed','clipboard_cleared'}
                        or any(value is not True for value in body.values())):return self.respond(400)
            except (ValueError,UnicodeError):return self.respond(400)
            self.respond(200,b'Finished');self.server.confirmed=True
        def setup(self):
            super().setup();self.connection.settimeout(1)
    server=HTTPServer(('127.0.0.1',0),Handler)
    server.authority=f'127.0.0.1:{server.server_port}';server.origin='http://'+server.authority
    server.url=server.origin+'/'+nonce;server.confirmed=False;server.deadline=time.monotonic()+seconds
    server.timeout=.25
    return server


def handoff(credential,seconds,announce=None):
    assert 0<seconds<=300
    server=make_server(credential,seconds)
    try:
        message={'native_safari_handoff_url':server.url,'maximum_seconds':seconds,
                 'instructions':'Open in native Safari. Read-only checks after sign-in: no business-form saves/submits, uploads, orders or data changes. Copy Customer credentials with buttons. Sign out and close the application tab, then acknowledge Finished here. No acknowledgement retains the checkpoint.'}
        (announce or (lambda value:print(json.dumps(value),flush=True)))(message)
        while time.monotonic()<server.deadline and not server.confirmed:server.handle_request()
        if not server.confirmed:raise ShutdownUnconfirmed()
        return {'shutdown_confirmed':True,'manual_acceptance_not_inferred':True}
    finally:server.server_close()
