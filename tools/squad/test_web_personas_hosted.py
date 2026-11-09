"""Exact-owned real Auth browser fixtures, with the existing reviewed recovery path."""
import datetime,json,subprocess,secrets,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from psycopg.types.json import Jsonb
from test_hosted_personas import connect,plan,create,cleanup,save_checkpoint,CHECKPOINT,ROOT,URL,keys,public_structure,staff_auth

def run():
 assert not CHECKPOINT.exists(),'Recover the existing persona checkpoint before testing'
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0], 'Refresh/release active'
  try:
   state=plan(c);structure=public_structure(c);staff=staff_auth(c);save_checkpoint(state)
   credentials=None
   try:
    credentials=create(c,state);state['stage']='created';save_checkpoint(state)
    control_token=secrets.token_urlsafe(32);owned={str(a['id']):a for a in state['actors']};original={}
    class Control(BaseHTTPRequestHandler):
     def log_message(self,*args):pass
     def do_POST(self):
      try:
       assert self.headers.get('Authorization')=='Bearer '+control_token
       assert self.path=='/fixture-control'
       size=int(self.headers.get('Content-Length','0'));assert 0<size<1024
       body=json.loads(self.rfile.read(size));actor=owned.get(str(body.get('id')));assert actor
       assert body['action'] in ['disable','restore','remove_features']
       with connect('staging') as control:
        row=control.execute('SELECT email,disabled,features FROM sa_snapshot_20261019.sa_users WHERE id=%s',(actor['id'],)).fetchone()
        assert row and row[0]==actor['email']
        if actor['id'] not in original:original[actor['id']]=row[1:]
        if body['action']=='disable':
         assert actor['role']==3
         control.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=%s AND email=%s',(actor['id'],actor['email']))
        elif body['action']=='remove_features':
         assert actor['role']==12
         control.execute("UPDATE sa_snapshot_20261019.sa_users SET features='[]'::jsonb WHERE id=%s AND email=%s",(actor['id'],actor['email']))
        else:
         disabled,features=original[actor['id']]
         control.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=%s,features=%s WHERE id=%s AND email=%s',(disabled,Jsonb(features),actor['id'],actor['email']))
       self.send_response(200);self.end_headers();self.wfile.write(b'{}')
      except Exception:
       self.send_response(400);self.end_headers();self.wfile.write(b'{"error":"fixture_control_rejected"}')
    server=ThreadingHTTPServer(('127.0.0.1',0),Control);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    payload={'url':URL,'anon':keys('staging'),'actors':credentials,'control_url':'http://127.0.0.1:'+str(server.server_port)+'/fixture-control','control_token':control_token}
    try:
     result=subprocess.run(['node','tools/squad/web-persona-browser.mjs'],input=json.dumps(payload),capture_output=True,text=True,cwd=ROOT,timeout=900)
    finally:server.shutdown();server.server_close()
    if result.returncode:raise RuntimeError('Browser acceptance failed: '+result.stderr[-2200:])
    report=json.loads(result.stdout);assert len(report['actors'])==11
   finally:
    if credentials:
     for actor in credentials:actor['password']=''
    cleanup(c,state);assert public_structure(c)==structure and staff_auth(c)==staff;CHECKPOINT.unlink()
   report.update(cleanup='Exact-owned fixtures removed; immutable blocked reservations retained',cutover_unchanged=True,public_structure_unchanged=True,staff_auth_unchanged=True,fixture_run_id=state['run_id'])
   (ROOT/'docs/squad-one-web/evidence/persona-entry-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
   print(json.dumps({'actors_passed':len(report['actors']),'cleanup':'complete','scope':report['scope']}))
  finally:c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':run()
