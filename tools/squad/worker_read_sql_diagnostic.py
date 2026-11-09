"""Exact pre-existing Worker/session/order, bounded read-only SQL observations."""
import hashlib
import json
import uuid
import psycopg
from me_sql_diagnostic import safe_plan

def measure_worker_sql(c,*,auth_id,session_id,expected_user_id,order_id):
    auth_id=uuid.UUID(str(auth_id));session_id=uuid.UUID(str(session_id));expected_user_id=int(expected_user_id);order_id=int(order_id)
    assert expected_user_id>0 and order_id>0
    result={'format':'squad-worker-sql-diagnostic/v1','environment':'staging','role':11,'contract':'canto_api.v1_order_get','samples':[],'application_mutations':0}
    with c.transaction():
        c.execute('SET TRANSACTION READ ONLY');c.execute("SET LOCAL statement_timeout='10s'");c.execute("SET LOCAL lock_timeout='2s'")
        assert c.execute('SELECT environment FROM sa_sync.environment_state WHERE singleton').fetchone()==('staging',)
        row=c.execute('''SELECT u.id,u.role FROM sa_identity.sa_auth_identities m
          JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id JOIN auth.users a ON a.id=m.auth_user_id
          JOIN auth.sessions s ON s.id=%s AND s.user_id=a.id
          WHERE m.auth_user_id=%s AND m.enrollment_state='ready' AND a.role='sa_app'
          AND(a.banned_until IS NULL OR a.banned_until<now()) AND(s.not_after IS NULL OR s.not_after>now())
          AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE
          AND lower(btrim(u.email))=lower(btrim(a.email))''',(session_id,auth_id)).fetchone()
        assert row==(expected_user_id,11),'Existing Worker session is not eligible'
        assert c.execute('SELECT assigned_worker_id FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(order_id,)).fetchone()==(expected_user_id,),'Order is not assigned to the exact Worker'
        functions=['sa_domain.v1_order_get(bigint,text,integer)','sa_domain.v1_order_item_get(bigint,text,text,integer)','sa_domain.actor()','sa_domain.auth_context()','sa_domain.scope_order_ids()','sa_domain.scope_item_ids()']
        result['function_sha256']={name:hashlib.sha256(c.execute('SELECT pg_get_functiondef(%s::regprocedure)',(name,)).fetchone()[0].encode()).hexdigest() for name in functions}
        result['settings']={name:c.execute('SELECT current_setting(%s)',(name,)).fetchone()[0] for name in ['statement_timeout','lock_timeout','jit','plan_cache_mode','work_mem']}
        # Expose names and fixed configuration only, never arbitrary role secrets.
        allowed=('statement_timeout','lock_timeout','jit','plan_cache_mode','work_mem','pgrst.db_pre_request')
        result['role_settings']={role:{setting.split('=',1)[0]:setting.split('=',1)[1] for setting in settings or [] if setting.split('=',1)[0] in allowed} for role,settings in c.execute("SELECT rolname,rolconfig FROM pg_roles WHERE rolname IN('authenticator','sa_app')")}
        result['database_role_settings']=[{'role':role,'scope':'current_database' if database else 'all_databases','settings':{setting.split('=',1)[0]:setting.split('=',1)[1] for setting in settings or [] if setting.split('=',1)[0] in allowed}} for role,database,settings in c.execute("""SELECT coalesce(r.rolname,'all_roles'),s.setdatabase<>0,s.setconfig
          FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole
          WHERE (s.setrole=0 OR r.rolname IN('authenticator','sa_app'))
          AND(s.setdatabase=0 OR s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()))""")]
        c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth_id),'session_id':str(session_id)}),));c.execute('SET LOCAL ROLE sa_app')
        for index in range(6):
            try:
                with c.transaction():
                    plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_order_get(%s,NULL,25)',(order_id,)).fetchone()[0][0]
                    result['samples'].append({'index':index,'outcome':'completed','sql_execution_ms':plan['Execution Time'],'planning_ms':plan['Planning Time'],'plan':safe_plan(plan)})
            except psycopg.Error as error:result['samples'].append({'index':index,'outcome':'failed','sqlstate':error.sqlstate})
        result['read_only']=c.execute('SHOW transaction_read_only').fetchone()==('on',);assert result['read_only']
        raise psycopg.Rollback()
    result['all_requests_completed']=all(s['outcome']=='completed' for s in result['samples'])
    result['measurement']='Six serial EXPLAIN ANALYZE reads under the exact existing Worker Auth session and sa_app role; 10-second diagnostic timeout. Outer plans do not expose nested functions. Direct SQL bypasses PostgREST pre-request/connection setup and network; not a gateway or capacity measurement.'
    return result
