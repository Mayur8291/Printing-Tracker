"""Staging-only rollback checks for disabled integration/schedule controls.

Uses an enrolled Admin with a transaction-local fixture session. This verifies
deployed SQL authority, not a fresh GoTrue login or an external provider call.
"""
import json,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
import psycopg

def run():
 with connect('staging') as c:
  before=public_structure(c)
  assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
  states={}
  with c.transaction():
   row=c.execute("""SELECT u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u
    JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
    JOIN auth.users a ON a.id=m.auth_user_id AND a.role='sa_app'
    WHERE u.role=0 AND u.disabled IS NOT TRUE AND u.deleted_at IS NULL
    AND (a.banned_until IS NULL OR a.banned_until<now()) ORDER BY u.id LIMIT 1""").fetchone()
   assert row,'An eligible staging Admin is required'
   session=uuid.uuid4()
   c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session,row[1]))
   c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(row[1]),'session_id':str(session),'role':'sa_app'}),))
   c.execute('SET LOCAL ROLE sa_app')
   for label,name in [('warehouse','v1_warehouse_schedule_status'),('weekly_tailor','v1_weekly_tailor_schedule_status'),('airtable_reports','v1_airtable_reports_status')]:
    result=c.execute('SELECT canto_api.'+name+'()').fetchone()[0]
    assert result['enabled'] is False and result['version'],label
    states[label]='disabled'
   settings=c.execute('SELECT canto_api.v1_mail_settings_read()').fetchone()[0]
   assert isinstance(settings,dict)
   states['mail_settings']='admin_read_verified'
   c.execute('SET LOCAL ROLE postgres')
   c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
   c.execute('SET LOCAL ROLE service_role')
   for name in ('squad_weekly_tailor_heartbeat','squad_warehouse_heartbeat'):
    result=c.execute('SELECT canto_api.'+name+'()').fetchone()[0]
    assert result['state']=='paused',name
   raise psycopg.Rollback()
  assert public_structure(c)==before
  assert not c.execute('SELECT 1 FROM auth.sessions WHERE id=%s',(session,)).fetchone()
  assert c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0
 print(json.dumps({'environment':'staging','controls':states,'mirror_heartbeats_paused':True,'temporary_session_rolled_back':True,'provider_requests':0,'public_structure_unchanged':True}))

if __name__=='__main__':run()
