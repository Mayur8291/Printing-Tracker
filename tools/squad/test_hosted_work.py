"""Hosted command contracts in a rollback-only transaction, including sequence restore."""
import datetime,json,sys,uuid
from pathlib import Path
from psycopg import sql
import psycopg
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
    checks=[]
    sequences=['sa_snapshot_20261019.sa_tasks_id_seq','sa_snapshot_20261019.sa_task_users_id_seq',
      'sa_snapshot_20261019.sa_responsibilities_id_seq','sa_snapshot_20261019.sa_milestones_id_seq','sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq']
    with connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/write is active'
        before={name:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone() for name in sequences}
        try:
            with c.transaction():
                actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u
                  JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id JOIN auth.users a ON a.id=m.auth_user_id
                  WHERE u.role IN(0,1) AND m.enrollment_state='ready' AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE
                  AND a.banned_until IS NULL ORDER BY u.role,u.id""").fetchall()
                assert len(actors)==2
                identities={}
                for role,legacy,actor in actors:
                    sid=uuid.uuid4();identities[role]=(legacy,actor,sid)
                    c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,actor))
                c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
                def actor(role):
                    c.execute('SET LOCAL ROLE postgres');legacy,user,sid=identities[role]
                    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(user),'session_id':str(sid)}),))
                    c.execute('SET LOCAL ROLE sa_app');return legacy
                sc=identities[1][0];actor(0)
                task=c.execute('SELECT canto_api.v1_task_save(NULL,%s,%s,NULL,%s,NULL,%s)',
                  ('Rollback-only acceptance task',datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2),[sc],uuid.uuid4())).fetchone()[0]
                actor(1)
                read=c.execute('SELECT canto_api.v1_task_get(%s)',(int(task['id']),)).fetchone()[0]
                assert read['assignee_ids']==[str(sc)]
                changed=c.execute('SELECT canto_api.v1_task_transition(%s,1,%s,%s)',(int(task['id']),task['version'],uuid.uuid4())).fetchone()[0]
                assert changed['state']==1;checks.append('task assignment and assignee completion')
                actor(0)
                goal=c.execute('SELECT canto_api.v1_responsibility_save(%s::jsonb,%s)',
                  (json.dumps([{'subject_id':str(sc),'kind':1,'note':'Rollback-only acceptance responsibility'}]),uuid.uuid4())).fetchone()[0]['items'][0]
                actor(1)
                result=c.execute("SELECT canto_api.v1_responsibility_transition(%s,'completed',NULL,%s,%s)",(int(goal['id']),goal['version'],uuid.uuid4())).fetchone()[0]
                assert result['state']=='completed';checks.append('admin assignment and subject goal completion')
                actor(0)
                target=c.execute("SELECT canto_api.v1_milestone_save(NULL,%s,'2098-01-01','2098-01-07',1000,'Rollback-only acceptance target',NULL,%s)",(sc,uuid.uuid4())).fetchone()[0]
                actor(1)
                progress=c.execute('SELECT canto_api.v1_milestone_progress(%s)',(int(target['id']),)).fetchone()[0]
                assert progress['subject_id']==str(sc);checks.append('admin target and coordinator-scoped progress')
                actor(0)
                try:
                    with c.transaction():
                        c.execute("SELECT canto_api.v1_milestone_save(NULL,%s,'2097-12-31','2098-01-08',1000,'Overlap must fail',NULL,%s)",(sc,uuid.uuid4()))
                except psycopg.errors.ExclusionViolation:checks.append('containing target interval rejected')
                else:raise AssertionError('Overlapping target was accepted')
                raise psycopg.Rollback()
        finally:
            c.execute('SET ROLE postgres')
            for name,(value,called) in before.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(name,value,called))
            assert all(c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()==state for name,state in before.items())
        print(json.dumps({'environment':'staging','passed':checks,'all_rows_rolled_back':True,'sequences_restored':True}))

if __name__=='__main__':run()
