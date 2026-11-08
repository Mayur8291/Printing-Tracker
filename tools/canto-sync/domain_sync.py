"""Refresh integration for the optional Squad One domain runtime.

Called inside the same publication transaction as business/Auth/media changes.
No business commands or outbound effects are replayed by source publication.
"""
from snapshot import require
import json
from pathlib import Path

def access_catalog(conn):
    queries=[
      "SELECT schemaname,tablename,policyname,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname IN('sa_snapshot_20261019','sa_domain','sa_identity','sa_sync','sa_media','sa_admin') ORDER BY 1,2,3",
      "SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sa_snapshot_20261019' AND a.attacl IS NOT NULL ORDER BY 1,2",
      "SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' OR (n.nspname='canto_api' AND (p.proname LIKE 'v1_%' OR p.proname LIKE 'squad_job_%' OR p.proname LIKE 'squad_notification_%' OR p.proname LIKE 'squad_document_%' OR p.proname LIKE 'squad_account_%' OR p.proname LIKE 'account_%')) ORDER BY 1,2,3",
      "SELECT rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname IN('sa_guard','sa_executor','sa_worker','sa_media_writer','sa_account_writer') ORDER BY 1"
      ,"SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('sa_domain','sa_media','sa_identity','sa_admin','sa_sync') AND c.relkind IN('r','p','S','v') ORDER BY 1,2"
      ,"SELECT schemaname,tablename,policyname,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND (policyname LIKE 'canto_media_%' OR policyname LIKE 'canto_masters_%') ORDER BY 1,2,3"
      ,"SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_admin' ORDER BY 1,2,3"
      ,"SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),n.nspname,p.proname,pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid)) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (t.tgrelid='auth.users'::regclass AND n.nspname IN('sa_identity','sa_domain')) OR (t.tgrelid=to_regclass('sa_domain.outbox') AND n.nspname='sa_domain') ORDER BY 1"
    ]
    return json.loads(json.dumps([conn.execute(q).fetchall() for q in queries]))

def check_access_catalog(conn,environment):
    if not conn.execute("SELECT to_regclass('sa_domain.runtime_state')").fetchone()[0]:return
    baseline=Path(__file__).parent/'baselines'/(environment+'-domain-access.json')
    require(baseline.exists(),'Domain access baseline is missing; review deployment before refresh')
    require(json.loads(baseline.read_text())==access_catalog(conn),'Domain access drift: review before refresh')

def before_publication(conn, expected_revision=None, restoring=False):
    require(conn.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],
            'Business writes are active; retry refresh publication')
    if not conn.execute("SELECT to_regclass('sa_sync.environment_state')").fetchone()[0]: return
    edit,synced,cutover=conn.execute('SELECT edit_revision,synced_revision,cutover FROM sa_sync.environment_state WHERE singleton FOR UPDATE').fetchone()
    require(not cutover,'Old-source publication is disabled after cutover')
    if expected_revision is not None:
        require(edit==expected_revision,'Local writes changed after refresh approval')
    elif not restoring:
        require(edit==synced,'Local edits require explicit replacement approval')

def after_publication(conn):
    if not conn.execute("SELECT to_regclass('sa_domain.runtime_state')").fetchone()[0]: return None
    generation=conn.execute('UPDATE sa_domain.runtime_state SET generation=generation+1 WHERE singleton RETURNING generation').fetchone()[0]
    # Mirror test commands belonged to the discarded generation. Their side effects
    # must not execute after their underlying data has been replaced.
    discarded=conn.execute("""UPDATE sa_domain.outbox SET status='dead',last_error_code='SOURCE_REFRESH_DISCARDED',
      lease_until=NULL,lease_token=NULL,completed_at=now()
      WHERE generation<%s AND status IN('pending','leased') RETURNING id""",(generation,)).fetchall()
    result={'generation':generation,'discarded_mirror_events':len(discarded)}
    if discarded and conn.execute("SELECT to_regclass('sa_domain.job_attempts')").fetchone()[0]:
        conn.execute("""UPDATE sa_domain.job_attempts SET state='failed',error_code='SOURCE_REFRESH_DISCARDED',finished_at=now()
          WHERE job_id=ANY(%s::uuid[]) AND state='leased'""",([row[0] for row in discarded],))
    if conn.execute("SELECT to_regclass('sa_domain.order_requests')").fetchone()[0]:
        requests=conn.execute("""UPDATE sa_domain.order_requests SET state='failed',updated_at=now(),
          spec=spec||'{"failure_code":"SOURCE_REFRESH_DISCARDED"}'::jsonb
          WHERE generation<%s AND state IN('queued','running') RETURNING id""",(generation,)).fetchall()
        if requests:result['discarded_order_requests']=len(requests)
    if conn.execute("SELECT to_regclass('sa_domain.account_requests')").fetchone()[0]:
        requests=conn.execute("""UPDATE sa_domain.account_requests SET state='discarded',updated_at=now(),error_code='SOURCE_REFRESH_DISCARDED'
          WHERE generation<%s AND state IN('queued','processing','failed') RETURNING id""",(generation,)).fetchall()
        if requests:result['discarded_account_requests']=len(requests)
    if conn.execute("SELECT to_regclass('sa_domain.account_flows')").fetchone()[0]:
        flows=conn.execute("""UPDATE sa_domain.account_flows SET state=CASE WHEN state IN('pending','processing') THEN 'expired' ELSE state END,
          code_cipher=NULL,payload='{}',password_fingerprint=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
          WHERE generation<%s AND (state IN('pending','processing') OR code_cipher IS NOT NULL OR payload<>'{}') RETURNING id""",(generation,)).fetchall()
        conn.execute('DELETE FROM sa_domain.invitation_grants WHERE generation<%s',(generation,))
        conn.execute('UPDATE sa_domain.credential_states SET active_flow=NULL,last_completed_flow=NULL,lease_until=NULL,revision=revision+1,generation=%s WHERE generation<%s',(generation,generation))
        if flows:result['discarded_account_flows']=len(flows)
    if conn.execute("SELECT to_regclass('sa_domain.media_uploads')").fetchone()[0]:
        rows=conn.execute("UPDATE sa_domain.media_uploads SET state='expired' WHERE generation<%s AND state IN('reserved','verified') RETURNING id",(generation,)).fetchall()
        if rows:result['discarded_media_uploads']=len(rows)
    if conn.execute("SELECT to_regclass('sa_domain.devices')").fetchone()[0]:
        rows=conn.execute('UPDATE sa_domain.devices SET active=false,revision=revision+1 WHERE generation<%s AND active RETURNING id',(generation,)).fetchall()
        if rows:result['discarded_device_bindings']=len(rows)
    if conn.execute("SELECT to_regclass('sa_domain.documents')").fetchone()[0]:
        rows=conn.execute("""UPDATE sa_domain.documents SET
          state=CASE WHEN state='ready' THEN 'expired' ELSE 'failed' END,
          delivery_state=CASE WHEN delivery_state='pending' THEN 'failed' ELSE delivery_state END,
          error_code='SOURCE_REFRESH_DISCARDED'
          WHERE generation<%s AND state IN('queued','rendering','ready') RETURNING id""",(generation,)).fetchall()
        if rows:result['discarded_documents']=len(rows)
    return result
