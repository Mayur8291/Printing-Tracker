"""Read-only paired diagnostic called only by the parent-owned staging lifecycle.

The caller supplies an existing, trusted Auth/session pair; this helper never
creates sessions. No CLI, secret discovery, hosted connection or artifact write.
"""
import hashlib
import json
import uuid
import psycopg

SAFE_PLAN_FIELDS=('Node Type','Parent Relationship','Relation Name','Schema','Alias','Index Name','Scan Direction','Join Type','Strategy','Actual Startup Time','Actual Total Time','Actual Rows','Actual Loops','Planning Time','Execution Time','Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Temp Read Blocks','Temp Written Blocks')

def safe_plan(value):
    """Explicit allowlist discards SQL literals, filters, outputs and parameters."""
    if not isinstance(value,dict):return {}
    result={k:v for k,v in value.items() if k in SAFE_PLAN_FIELDS and isinstance(v,(str,int,float,bool))}
    if isinstance(value.get('Plan'),dict):result['Plan']=safe_plan(value['Plan'])
    if isinstance(value.get('Plans'),list):result['Plans']=[safe_plan(v) for v in value['Plans'][:32]]
    return result

def measure_me_sql(c,*,auth_id,session_id,expected_user_id):
    auth_id=uuid.UUID(str(auth_id));session_id=uuid.UUID(str(session_id));expected_user_id=int(expected_user_id)
    assert expected_user_id>0
    result={'format':'squad-me-sql-diagnostic/v1','environment':'staging','role':3,'contract':'canto_api.v1_me','samples':[],'access_paths':{},'application_mutations':0}
    with c.transaction():
        c.execute('SET TRANSACTION READ ONLY')
        c.execute("SET LOCAL statement_timeout='10s'")
        c.execute("SET LOCAL lock_timeout='2s'")
        assert c.execute('SELECT environment FROM sa_sync.environment_state WHERE singleton').fetchone()==('staging',)
        row=c.execute('''SELECT u.id,u.role FROM sa_identity.sa_auth_identities m
          JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id
          JOIN auth.users a ON a.id=m.auth_user_id
          JOIN auth.sessions s ON s.id=%s AND s.user_id=a.id
          WHERE m.auth_user_id=%s AND m.enrollment_state='ready' AND a.role='sa_app'
          AND (a.banned_until IS NULL OR a.banned_until<now()) AND(s.not_after IS NULL OR s.not_after>now())
          AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE
          AND lower(btrim(u.email))=lower(btrim(a.email))''',(session_id,auth_id)).fetchone()
        assert row==(expected_user_id,3),'Existing Customer session is not eligible'
        result['migration_prefix']=c.execute("SELECT max(version) FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%'").fetchone()[0]
        functions=['sa_domain.v1_me()','sa_domain.actor()','sa_domain.auth_context()','sa_domain.version(text,bigint)','sa_domain.rehearsal_actor_allowed(uuid)']
        result['function_sha256']={name:hashlib.sha256(c.execute('SELECT pg_get_functiondef(%s::regprocedure)',(name,)).fetchone()[0].encode()).hexdigest() for name in functions}
        # These privileged point-lookup plans prove access paths only; their
        # execution time is not claimed as API/RLS or end-to-end performance.
        queries={
          'auth_user':('SELECT id FROM auth.users WHERE id=%s',(auth_id,)),
          'auth_session':('SELECT id FROM auth.sessions WHERE id=%s AND user_id=%s',(session_id,auth_id)),
          'identity_mapping':('SELECT legacy_user_id FROM sa_identity.sa_auth_identities WHERE auth_user_id=%s',(auth_id,)),
          'source_person':('SELECT id FROM sa_snapshot_20261019.sa_users WHERE id=%s',(expected_user_id,)),
          'entity_version':("SELECT revision FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=%s",(expected_user_id,))}
        for label,(query,args) in queries.items():
            result['access_paths'][label]=safe_plan(c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0])
        c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth_id),'session_id':str(session_id)}),))
        c.execute('SET LOCAL ROLE sa_app')
        for index in range(6):
            try:
                with c.transaction():
                    plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_me()').fetchone()[0][0]
                    result['samples'].append({'index':index,'outcome':'completed','sql_execution_ms':plan['Execution Time'],'planning_ms':plan['Planning Time'],'plan':safe_plan(plan)})
            except psycopg.Error as error:
                result['samples'].append({'index':index,'outcome':'failed','sqlstate':error.sqlstate})
        result['read_only']=c.execute('SHOW transaction_read_only').fetchone()==('on',)
        assert result['read_only']
        raise psycopg.Rollback()
    result['all_requests_completed']=all(x['outcome']=='completed' for x in result['samples'])
    result['measurement']='Six direct SQL executions under existing Customer claims and sa_app role in a read-only rolled-back transaction. Outer EXPLAIN cannot expose nested PL/pgSQL plans; point-lookup plans are separate privileged index evidence, not full API plans.'
    result['warmth']='Repeated on one database connection; not comparable to controlled-warm browser latency or a capacity/SLA test.'
    return result
