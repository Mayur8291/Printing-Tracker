"""Staging weekly scheduler SQL acceptance; all rows roll back, no SMTP/Cron/HTTP.

This is deliberately not a rendered-PDF, inbox-delivery, or actual Cron test.
An exclusive session refresh fence protects the brief sequence restoration.
"""
import argparse
import datetime
import hashlib
import json
import sys
import time
import uuid
from pathlib import Path

import psycopg
from psycopg import sql

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect as hosted_connect,public_structure

SEQUENCES=['sa_domain.audit_id_seq','sa_domain.documents_sequence_id_seq','sa_domain.outbox_sequence_id_seq']
TABLES=['weekly_tailor_schedule','weekly_tailor_runs','weekly_tailor_entries','documents','outbox','job_attempts','commands','audit','business_mail_deliveries']
FUNCTIONS=['sa_domain.squad_weekly_tailor_heartbeat(integer)','sa_domain.v1_weekly_tailor_schedule_configure(boolean,text,uuid)','sa_domain.squad_document_prepare(uuid,uuid)']


def run(local=False):
 if local:
  from local_db import connect
  from test_catalogue import seed_catalogue
  with connect() as db:seed_catalogue(db)
  open_connection=connect
 else:open_connection=lambda:hosted_connect('staging')
 checks=[];samples=[];report=None
 with open_connection() as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
  try:
   environment=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert environment[0:3]==('staging',False,None) and environment[3]==environment[4],'Requires an idle staging mirror'
   assert not c.execute("SELECT FROM sa_domain.outbox WHERE status IN('pending','leased') LIMIT 1").fetchone(),'Existing work must finish first'
   assert not c.execute('SELECT enabled FROM sa_domain.weekly_tailor_schedule').fetchone()[0],'An active user schedule is not an acceptance fixture'
   assert all(c.execute('SELECT to_regprocedure(%s)',(f,)).fetchone()[0] for f in FUNCTIONS),'Required deployed contracts are missing'
   prefix=None if local else c.execute("SELECT max(version) FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%'").fetchone()[0]
   definitions={f:hashlib.sha256(c.execute('SELECT pg_get_functiondef(%s::regprocedure)',(f,)).fetchone()[0].encode()).hexdigest() for f in FUNCTIONS}
   counts={t:c.execute(sql.SQL('SELECT count(*) FROM sa_domain.{}').format(sql.Identifier(t))).fetchone()[0] for t in TABLES}
   sequences={n:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone() for n in SEQUENCES}
   before_structure=public_structure(c) if not local else None
   cron=[] if local else c.execute("SELECT jobid,active FROM cron.job WHERE jobname IN('squad-jobs-minute','squad-documents-pump','squad-media-cleanup') ORDER BY jobid").fetchall()
   admin=c.execute("""SELECT u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready' JOIN auth.users a ON a.id=m.auth_user_id AND a.role='sa_app' WHERE u.role=0 AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND(a.banned_until IS NULL OR a.banned_until<now()) ORDER BY u.id LIMIT 1""").fetchone();assert admin,'An eligible mapped Admin is required'
   actor_id,auth_id=admin;session_id=uuid.uuid4();tailors=c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE role=5 AND deleted_at IS NULL').fetchone()[0];assert 0<tailors<=100,'Acceptance is bounded to1..100 current root Tailors'
   try:
    with c.transaction():
     c.execute("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s'")
     def privileged():c.execute('SET LOCAL ROLE postgres')
     def worker():
      privileged();c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role')
     def actor():
      privileged();c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth_id),'session_id':str(session_id)}),));c.execute('SET LOCAL ROLE sa_app')
     def heartbeat(limit=25):
      worker();start=time.perf_counter();value=c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(%s)',(limit,)).fetchone()[0];samples.append(round((time.perf_counter()-start)*1000,3));return value
     def configure(enabled,version,key=None):
      actor();return c.execute('SELECT canto_api.v1_weekly_tailor_schedule_configure(%s,%s,%s)',(enabled,version,key or uuid.uuid4())).fetchone()[0]
     assert heartbeat()['error_code']=='MIRROR_OR_REFRESH';checks.append('mirror blocks automatic effects')
     privileged();c.execute('UPDATE sa_sync.environment_state SET cutover=true')
     with open_connection() as blocker:
      with blocker.transaction():
       blocker.execute("SET LOCAL lock_timeout='2s'");blocker.execute('SELECT singleton FROM sa_domain.weekly_tailor_schedule FOR UPDATE')
       assert heartbeat()=={'state':'busy','queued':0};checks.append('concurrent schedule row lock returns bounded busy')
       raise psycopg.Rollback()
     assert heartbeat()['state']=='disabled'
     privileged();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session_id,auth_id));c.execute("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[%s]::bigint[] WHERE kind='tailor_weekly'",(actor_id,))
     actor();initial=c.execute('SELECT canto_api.v1_weekly_tailor_schedule_status()').fetchone()[0];key=uuid.uuid4();settings=configure(True,initial['version'],key);assert settings==configure(True,initial['version'],key)
     privileged();latest=str(c.execute('SELECT sa_domain.weekly_tailor_latest_week(statement_timestamp())').fetchone()[0]);assert settings['next_week_start']==latest;checks.append('latest completed Kolkata week; idempotent self-delegation')
     first=heartbeat(1);assert first['queued']==1 and first['week_start']==latest;run_id=uuid.UUID(first['run_id']);privileged()
     row=c.execute("SELECT e.tailor_id,d.id,d.actor_id,d.legacy_user_id,d.role_id,d.kind,d.request,d.delivery_state,j.event_type,j.payload FROM sa_domain.weekly_tailor_entries e JOIN sa_domain.documents d ON d.id=e.document_id JOIN sa_domain.outbox j ON j.id=d.job_id WHERE e.run_id=%s",(run_id,)).fetchone();assert row and row[2:6]==(auth_id,actor_id,0,'tailor_weekly') and row[6]=={'tailor_id':str(row[0]),'week_start':latest,'include_team':False,'delivery':'email'} and row[7]=='pending' and row[8]=='document.requested';assert row[9]['schedule_run_id']==str(run_id);checks.append('bounded one-Tailor document and job use exact owner, period, delivery and run')
     first_document=row[1]
     terminal=first
     for _ in range(4):
      if terminal['state']=='queued':break
      terminal=heartbeat(25);assert terminal['queued']<=25
     assert terminal['state']=='queued';assert heartbeat()['state']=='waiting';privileged();assert c.execute('SELECT count(*) FROM sa_domain.weekly_tailor_entries WHERE run_id=%s',(run_id,)).fetchone()[0]==tailors;checks.append('entire current Tailor cohort enumerates in bounded pages; natural final page waits without duplicates')
     worker();jobs=c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'];assert len(jobs)==1 and jobs[0]['handler']=='document_render';job=jobs[0];args=(uuid.UUID(job['id']),uuid.UUID(job['lease_token']));prepared=c.execute('SELECT canto_api.squad_document_prepare(%s,%s)',args).fetchone()[0];assert prepared['state']=='prepared' and prepared['snapshot']['kind']=='tailor_weekly';checks.append('real document worker prepares the authorized weekly snapshot; no READY or SMTP fabricated')
     disabled=configure(False,settings['version']);worker();assert c.execute('SELECT canto_api.squad_document_prepare(%s,%s)',args).fetchone()[0]['state']=='dead';privileged();assert not c.execute("SELECT FROM sa_domain.outbox WHERE event_type IN('document.mail','business.mail') AND payload->>'document_id'=%s",(str(first_document),)).fetchone();checks.append('disabling delegation revokes queued rendering before any mail job')
     settings=configure(True,disabled['version'])
     for mode,error in [('owner','SCHEDULE_OWNER_UNAVAILABLE'),('recipients','MAIL_RECIPIENTS_NOT_CONFIGURED'),('generation','SOURCE_REFRESH_RECONFIGURE')]:
      with c.transaction():
       privileged()
       if mode=='owner':c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=%s',(actor_id,))
       elif mode=='recipients':c.execute("UPDATE sa_domain.business_mail_settings SET recipient_ids='{}' WHERE kind='tailor_weekly'")
       else:c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1')
       assert heartbeat()['error_code']==error;raise psycopg.Rollback()
     checks.append('current owner, current recipient configuration and generation gates remain live')
     actor()
     try:
      with c.transaction():c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(1)')
     except psycopg.errors.InsufficientPrivilege:pass
     else:raise AssertionError('App role invoked service heartbeat')
     checks.append('sa_app cannot invoke service heartbeat')
     raise psycopg.Rollback()
   finally:
    c.execute('SET ROLE postgres')
    for name,(value,called) in sequences.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(name,value,called))
   assert environment==c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
   assert counts=={t:c.execute(sql.SQL('SELECT count(*) FROM sa_domain.{}').format(sql.Identifier(t))).fetchone()[0] for t in TABLES}
   assert sequences=={n:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone() for n in SEQUENCES}
   assert not c.execute('SELECT FROM auth.sessions WHERE id=%s',(session_id,)).fetchone()
   if not local:
    assert public_structure(c)==before_structure
    assert cron==c.execute("SELECT jobid,active FROM cron.job WHERE jobname IN('squad-jobs-minute','squad-documents-pump','squad-media-cleanup') ORDER BY jobid").fetchall()
   report={'environment':'local synthetic' if local else 'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'migration_prefix':prefix,'scope':'rollback-only SQL scheduler and document preparation acceptance; not Cron, PDF output, SMTP or inbox delivery','function_sha256':definitions,'checks':checks,'heartbeat_wall_ms':samples,'root_tailors_present':tailors,'fixture_window':'complete current root-Tailor cohort, bounded to100; normal immutable cursor and ceiling behavior','actor_legacy_id':str(actor_id),'all_rows_rolled_back':True,'sequences_restored_under_exclusive_fence':True,'cron_unchanged':True,'public_structure_unchanged':True,'real_messages':0,'provider_requests':0}
  finally:c.execute('SELECT pg_advisory_unlock(20261107,1)')
 if not local:(ROOT/'docs/squad-one-audit/implementation-evidence/staging-weekly-schedule-sql.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
 return report


if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--local',action='store_true');args=parser.parse_args();run(local=args.local)
