"""Prepared guest UI/SMTP acceptance. Default is read-only; integrator review required.

--execute asks for actual Mailinator proof from the observed inbox. It never
queries or decrypts database codes. Run in a PTY so proof input stays masked.
"""
import argparse,datetime,getpass,json,secrets,signal,subprocess,sys,uuid
from pathlib import Path
from urllib.request import Request,ProxyHandler,build_opener
import guest_account_fixture as guest
from guest_failure_diagnostics import validate_diagnostic
from guest_flow_selection import requested_flows,checkpoint_selection,completed_selection
from test_hosted_business_journeys import cron_state,set_crons
ROOT=Path(__file__).resolve().parents[2]
PRIVATE=ROOT/'tools/squad/private';CHECKPOINT=PRIVATE/'web-guest-checkpoint.json'
EVIDENCE=ROOT/'docs/squad-one-audit/implementation-evidence/staging-web-guests.json'

def save(state):
 PRIVATE.mkdir(exist_ok=True,mode=0o700);temporary=CHECKPOINT.with_suffix('.tmp')
 temporary.write_text(json.dumps(state,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(CHECKPOINT)

def evidence_write(state,evidence,public=False):
 path=EVIDENCE if public else PRIVATE/('guest-result-'+state['run_id']+'.json')
 if public and checkpoint_selection(state)!=guest.KINDS:path=path.with_name(path.stem+'-'+'-'.join(checkpoint_selection(state))+path.suffix)
 path.parent.mkdir(parents=True,exist_ok=True)
 temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(evidence,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(path)

def send_job(c,state,kind):
 f=state['flows'][kind]
 row=c.execute("SELECT j.id,f.mail_state,j.attempts,j.status FROM sa_domain.account_flows f JOIN sa_domain.outbox j ON j.command_key=f.id AND j.event_type='account.challenge_mail' WHERE f.id=%s AND f.email=%s",(f['id'],f['email'])).fetchone()
 assert row and row[1:]==('queued',0,'pending'),'Exact untouched challenge required'
 secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
 request=Request(guest.identities.URL+'/functions/v1/squad-jobs/account-rehearsal',method='POST',data=json.dumps({'job_id':str(row[0])}).encode(),headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'})
 try:
  with build_opener(ProxyHandler({})).open(request,timeout=50) as response:result=json.load(response)
 finally:secret=None
 assert result=={'results':[{'id':str(row[0]),'state':'done'}]},'Exact challenge delivery is unconfirmed; do not retry automatically'
 assert c.execute('SELECT mail_state FROM sa_domain.account_flows WHERE id=%s',(f['id'],)).fetchone()[0]=='sent'
 return str(row[0])

def verify_receipt(c,state,kind,receipt):
 f=state['flows'][kind]
 row=c.execute('SELECT result,state,legacy_user_id,auth_user_id FROM sa_domain.account_flows WHERE id=%s AND email=%s',(f['id'],f['email'])).fetchone()
 assert row and row[0]==receipt and row[1]=='done'
 assert receipt['completed'] is True and receipt['email_confirmed'] is True
 if kind=='register':
  assert receipt['next']=='await_approval' and receipt['login_allowed'] is False
  source=c.execute('SELECT role,customer_registered_by,approved,onboarded FROM sa_snapshot_20261019.sa_users WHERE id=%s',(row[2],)).fetchone()
  assert source==(3,0,False,False),'Registration unexpectedly gained business authority'
 else:assert str(row[3])==state['actors'][kind]['auth_id'] and row[2]==state['actors'][kind]['id'] and receipt['next']=='sign_in'
 return True

def deadline(_signal,_frame):raise TimeoutError('Guest acceptance exceeded its bounded capability window')

def run(execute=False,recover=False,flows=None):
 assert not(execute and recover)
 assert not(recover and flows is not None),'Recovery must retain the checkpoint flow selection'
 selected=requested_flows(flows)
 if not recover:assert not CHECKPOINT.exists(),'Recover existing guest checkpoint first'
 for name in ['business-checkpoint.json','personas-checkpoint.json','document-outputs-checkpoint.json']:
  assert not (PRIVATE/name).exists(),'Another owned fixture must finish first'
 with guest.identities.connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release active'
  shared=False;process=None;state=None;credentials=None;evidence=None;result=None
  try:
   if recover:
    state=guest.validate(json.loads(CHECKPOINT.read_text()));checkpoint_selection(state)
    with c.transaction():guest.revoke(c,state)
    result=guest.cleanup(c,state);set_crons(c,state,False);CHECKPOINT.unlink();print(json.dumps(result));return
   state=guest.plan(c);state['requested_flows']=selected;checkpoint_selection(state);state['crons']=cron_state(c)
   assert c.execute("SELECT to_regprocedure('canto_api.squad_account_rehearsal_claim(uuid)')").fetchone()[0],'Reviewed guest migration is not deployed'
   if not execute:
    print(json.dumps({'mode':'read-only preflight','environment':'staging','flows':selected,'planned_mail_messages':len(selected),'maximum_synthetic_accounts':5,'cutover':False,'cleanup':'all allocated fixture accounts, including unselected flows; immutable receipts and audit retained; revisions never rewound','manual_proof':'real Mailinator inbox required; never database code extraction'}));return
   assert sys.stdin.isatty(),'Run reviewed guest acceptance in a PTY for masked real-inbox code input'
   save(state);evidence={'format':'squad-web-guest-evidence/v1','run_id':state['run_id'],'environment':'staging','requested_flows':selected.copy(),'untested_flows':[k for k in guest.KINDS if k not in selected],'all_flows_passed':False,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'flows':{},'mail':{},'status':'in_progress'};evidence_write(state,evidence);set_crons(c,state,True)
   with c.transaction():credentials=guest.prepare(c,state);save(state)
   c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
   payload={'format':'squad-guest-browser/v1','url':guest.identities.URL,'anon':guest.identities.keys('staging'),'actors':credentials,'profile':state['profile'],'requested_flows':list(checkpoint_selection(state)),'flows':{kind:{**flow,'password':secrets.token_urlsafe(30)} for kind,flow in state['flows'].items()}}
   process=subprocess.Popen(['node','tools/squad/web-guest-hosted.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
   process.stdin.write(json.dumps(payload)+'\n');process.stdin.flush();payload=None
   previous_handler=signal.signal(signal.SIGALRM,deadline);signal.alarm(780);result=None
   try:
    for line in process.stdout:
     message=json.loads(line);phase=message.get('phase');kind=message.get('kind');reply=None
     if phase=='complete':result=message['results'];break
     if phase=='failed':
      diagnostic=validate_diagnostic(message.get('diagnostic'))
      evidence['failure_diagnostic']=diagnostic;evidence_write(state,evidence)
      raise AssertionError('Guest acceptance failed at '+str(diagnostic['kind'])+'/'+diagnostic['stage']+' ('+diagnostic['type']+')')
     assert kind in checkpoint_selection(state),'Browser requested an unselected guest flow'
     f=state['flows'][kind]
     if phase=='assert_scope':c.execute('SELECT sa_domain.account_rehearsal_scope(%s)',(f['id'],));reply={'ready':True}
     elif phase=='request_recorded':
      assert message['id']==f['id'];assert c.execute('SELECT state FROM sa_domain.account_flows WHERE id=%s',(f['id'],)).fetchone()[0]=='pending';reply={'recorded':True}
     elif phase=='mail_proof':
      assert message['id']==f['id'];job=send_job(c,state,kind)
      message_id='<squad-'+f['id']+'@scottinternational.com>'
      print(json.dumps({'proof_required':kind,'mailbox':f['email'],'message_id':message_id,'subject':'Your Squad One '+{'register':'registration','confirm':'email confirmation','recovery':'password recovery','invite':'account invitation'}[kind]+' code','job_id':job}),flush=True)
      code=getpass.getpass('Observed Mailinator code (hidden): ');assert len(code)==8 and code.isascii() and code.isdecimal()
      evidence['mail'][kind]={'job_id':job,'smtp_submitted_message_id':message_id,'observed_message_id':None,'provider_delivery':'done','inbox_proof':'Operator read the code from the unique fixture recipient and matching purpose in the actual inbox; successful completion independently binds it to the server flow. SMTP-submitted Message-ID is not claimed as an observed inbox header.','observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()};evidence_write(state,evidence)
      reply={'recipient':f['email'],'messageId':message_id,'code':code};code=None
     elif phase=='completion_recorded':verify_receipt(c,state,kind,message['receipt']);reply={'recorded':True}
     elif phase=='flow_passed':
      assert message['result']['kind']==kind and message['result']['requestId']==f['id'];evidence['flows'][kind]=message['result'];evidence_write(state,evidence)
      print(json.dumps({'flow_passed':kind}),flush=True);reply={'recorded':True}
     else:raise AssertionError('Unexpected guest browser control message')
     process.stdin.write(json.dumps(reply)+'\n');process.stdin.flush();reply=None
    coverage=completed_selection(state,result)
    process.wait(timeout=15);assert process.returncode==0
   finally:signal.alarm(0);signal.signal(signal.SIGALRM,previous_handler)
  except BaseException as error:
   if evidence is not None:evidence['status']='failed';evidence['failure_type']=type(error).__name__;evidence_write(state,evidence)
   raise
  finally:
   if process and process.poll() is None:
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
   if credentials:
    for actor in credentials.values():actor['password']=''
   if state and execute:
    # Restore exclusive ownership before checking any net-zero/source proofs.
    if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False;c.execute('SELECT pg_advisory_lock(20261107,1)')
    with c.transaction():guest.revoke(c,state)
    cleaned=guest.cleanup(c,state);set_crons(c,state,False)
    if evidence is not None:
     evidence.update(cleanup=cleaned,completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),cutover_unchanged=True,cron_restored=True)
     if result and evidence['status']!='failed':
      evidence.update(completed_selection(state,result))
      evidence['status']='passed' if evidence['all_flows_passed'] else 'passed_selected_flows'
      if not cleaned.get('staff_auth_unchanged_since_fixture'):evidence['status']+='_with_external_staff_change'
      evidence['migration_prefix']=c.execute("SELECT max(version) FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%'").fetchone()[0]
      evidence_write(state,evidence,public=True)
     evidence_write(state,evidence)
    CHECKPOINT.unlink()
    print(json.dumps({'cleanup':cleaned}),flush=True)
   if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
   c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true');group.add_argument('--recover',action='store_true');parser.add_argument('--flows',help='Comma-separated selected flows; default register,confirm,recovery,invite. Cannot alter recovery checkpoint selection.');args=parser.parse_args();run(args.execute,args.recover,args.flows)
