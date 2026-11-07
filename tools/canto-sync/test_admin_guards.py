"""Transaction-only tests of authorization, edit/cutover guards, and interrupted job status."""
import json,uuid,psycopg
from psycopg.types.json import Jsonb
from database import connect

def main():
    checks=[]
    with connect('staging') as conn:
        with conn.transaction():
            conn.execute('SELECT pg_advisory_xact_lock(20261107,1)')
            assert conn.execute('SELECT active_job FROM sa_sync.environment_state WHERE singleton').fetchone()[0] is None
            actor=conn.execute("SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.role='admin' AND u.role='authenticated' LIMIT 1").fetchone()[0]
            session=uuid.uuid4();conn.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session,actor))
            conn.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor),'role':'authenticated','session_id':str(session)}),))
            def role(name):conn.execute('SET LOCAL ROLE '+name)
            def rejects(statement,parameters,code):
                try:
                    with conn.transaction():conn.execute(statement,parameters)
                except psycopg.DatabaseError as error:assert error.sqlstate==code,error.sqlstate
                else:raise AssertionError('Expected request to be rejected')
            role('authenticated')
            rejects("SELECT canto_api.request_refresh('production',NULL)",(),'22023');checks.append('environment isolation')
            role('postgres');conn.execute('UPDATE sa_sync.environment_state SET cutover=true WHERE singleton');role('authenticated')
            rejects("SELECT canto_api.request_refresh('staging',NULL)",(),'PT409');checks.append('cutover refusal')
            role('postgres');conn.execute('UPDATE sa_sync.environment_state SET cutover=false,edit_revision=edit_revision+1 WHERE singleton');role('authenticated')
            rejects("SELECT canto_api.request_refresh('staging',NULL)",(),'PT409');checks.append('unconfirmed edit replacement refusal')
            revision=conn.execute("SELECT (canto_api.access()->>'edit_revision')::bigint").fetchone()[0]
            rejects("SELECT canto_api.request_refresh('staging',%s)",(revision-1,),'PT409');checks.append('stale replacement confirmation refusal')
            job=conn.execute("SELECT canto_api.request_refresh('staging',%s)",(revision,)).fetchone()[0]
            rejects("SELECT canto_api.request_refresh('staging',%s)",(revision,),'PT409')
            rejects("SELECT canto_api.masters('colors','create',%s)",(Jsonb({'values':{'name':'Must roll back','hex_code':'#FFFFFF','is_deleted':False}}),),'PT409');checks.append('queued job blocks second refresh and writes')
            rejects("SELECT canto_api.refresh_reconcile(%s,'workflow_completed',NULL)",(job['id'],),'42501');checks.append('clients cannot finalize jobs')
            role('service_role');conn.execute("SELECT canto_api.refresh_reconcile(%s,'workflow_completed','test')",(job['id'],));role('authenticated')
            state=conn.execute('SELECT canto_api.refresh_status()').fetchone()[0];assert state['state']['active_job'] is None and state['jobs'][0]['status']=='failed';checks.append('failed workflow reconciles without a commit')
            job=conn.execute("SELECT canto_api.request_refresh('staging',%s)",(revision,)).fetchone()[0]
            role('postgres');conn.execute("INSERT INTO sa_sync.refresh_runs(run_id,environment,report) VALUES(%s,'staging',%s)",('acceptance-'+uuid.uuid4().hex,Jsonb({'job_id':job['id'],'changes':{'inserted':0,'updated':0,'deleted':0}})))
            role('service_role');conn.execute("SELECT canto_api.refresh_reconcile(%s,'workflow_completed','test')",(job['id'],));role('authenticated')
            state=conn.execute('SELECT canto_api.refresh_status()').fetchone()[0];assert state['state']['active_job'] is None and next(j for j in state['jobs'] if j['id']==job['id'])['status']=='succeeded';checks.append('commit journal resolves lost success acknowledgement')
            for name in ['anon','sa_app']:
                role('postgres');role(name);rejects('SELECT canto_api.access()',(),'42501')
            checks.append('anonymous and imported customer roles denied')
            role('postgres');conn.execute('DELETE FROM auth.sessions WHERE id=%s',(session,));role('authenticated');rejects('SELECT canto_api.access()',(),'42501');checks.append('revoked session denied')
            print(json.dumps({'passed':checks,'all_changes_rolled_back':True},indent=2));raise psycopg.Rollback()

if __name__=='__main__':main()
