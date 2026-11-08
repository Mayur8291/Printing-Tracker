"""Actual shared-SDK business compositions against isolated SQL, rolled back.

This is not GoTrue/HTTP evidence. The SDK's RPC envelopes execute through the
real canto_api functions as sa_app with current synthetic identity/session rows.
There is no network/provider transport, no cutover, and no committed fixture.
"""
import datetime
import json
import selectors
import subprocess
import time
import unittest
import uuid
from pathlib import Path

from psycopg import sql
from psycopg.types.json import Jsonb

from business_fixture_commercial import prepare_fixture
from fixtures import session, sid, uid
from local_db import connect

ROOT=Path(__file__).resolve().parents[2]
ROLES=[0,1,2,3,4,7,8,9,10,11,12]
BASE=1900008000
DATA_BASE=1901100000


def prepare_local(c):
    run=uuid.uuid4();state={'run_id':str(run),'base':BASE,'data_base':DATA_BASE,'label':'SQB '+run.hex[:12]}
    assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id BETWEEN %s AND %s',(BASE,BASE+12)).fetchone()
    assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_factories WHERE id=%s',(BASE+100,)).fetchone()
    c.execute('INSERT INTO sa_snapshot_20261019.sa_factories(id,name,created_at,updated_at) VALUES(%s,%s,now(),now())',(BASE+100,state['label']+' factory'))
    for role in range(13):
        n=BASE+role
        c.execute('''INSERT INTO sa_snapshot_20261019.sa_users
          (id,email,name,role,approved,onboarded,disabled,factory_id,factory_manager_id,parent_tailor_id,created_by_id,is_direct_deal,created_at,updated_at)
          VALUES(%s,%s,%s,%s,true,true,false,%s,%s,%s,%s,%s,now(),now())''',
          (n,f'local-{n}@squad.invalid',state['label']+f' role{role}',role,BASE+100 if role==4 else None,
           BASE+4 if role in [5,7,8,9] else None,BASE+5 if role==6 else None,BASE+1 if role in [3,10] else None,role==3))
        if role in ROLES:
            c.execute('INSERT INTO sa_sync.legacy_identity_keys(legacy_user_id) VALUES(%s)',(n,))
            c.execute('''INSERT INTO sa_identity.sa_auth_identities
              (auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis)
              VALUES(%s,%s,%s,'candidate','ready',true,'source_confirmed')''',(uid(n),n,f'local-{n}@squad.invalid'))
            c.execute("INSERT INTO auth.users(id,role,email) VALUES(%s,'sa_app',%s)",(uid(n),f'local-{n}@squad.invalid'))
            c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid(n),uid(n)))
    c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '5 minutes'",([uid(BASE+r) for r in ROLES],))
    fixture=prepare_fixture(c,state)
    fixture['actors']={str(role):str(BASE+role) for role in range(13)}
    now=datetime.datetime.now(datetime.timezone.utc)
    fixture['dueAt']=(now+datetime.timedelta(days=14)).isoformat()
    fixture['completionBy']=(now+datetime.timedelta(days=13)).isoformat()
    return fixture


def dispatch(c,request,actors=None,observer=None,privileged_role=None):
    """Adapt the actual SDK's named RPC parameters, never implement business rules."""
    role,name,args=request['role'],request['name'],request['args']
    assert role in ROLES and name.startswith('v1_') and name.replace('_','').isalnum()
    assert isinstance(args,dict)
    assert privileged_role in (None,'postgres')
    def privileged():c.execute('SET LOCAL ROLE postgres' if privileged_role else 'RESET ROLE')
    privileged();c.execute('SAVEPOINT sdk_request')
    started=None
    try:
        choices=[]
        for names,types in c.execute('''SELECT p.proargnames,oidvectortypes(p.proargtypes)
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='canto_api' AND p.proname=%s''',(name,)):
            if set(args)<=set(names or []):choices.append(dict(zip(names or [],types.split(', '))))
        assert choices, 'Unknown SDK argument names'
        types=min(choices,key=len);fragments=[];params=[]
        for key,value in args.items():
            type_=types[key]
            # Types are trusted PostgreSQL catalogue values, never runner input.
            fragments.append(sql.SQL('{}=>%s::{}').format(sql.Identifier(key),sql.SQL(type_)))
            params.append(Jsonb(value) if type_=='jsonb' and value is not None else value)
        if actors is None:
            session(c,BASE+role)
        else:
            actor=actors[role]
            c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor['auth_id'],'session_id':actor['session_id'],'role':'sa_app'}),))
            c.execute('SET LOCAL ROLE sa_app')
        started=time.perf_counter()
        value=c.execute(sql.SQL('SELECT canto_api.{}({})').format(sql.Identifier(name),sql.SQL(',').join(fragments)),params).fetchone()[0]
        if observer:observer({'elapsed_ms':(time.perf_counter()-started)*1000,'error':None})
        privileged();c.execute('RELEASE SAVEPOINT sdk_request')
        return {'data':value,'error':None}
    except Exception as error:
        if observer:observer({'elapsed_ms':None if started is None else (time.perf_counter()-started)*1000,'error':error})
        c.execute('ROLLBACK TO SAVEPOINT sdk_request');privileged();c.execute('RELEASE SAVEPOINT sdk_request')
        return {'data':None,'error':{'code':getattr(error,'sqlstate','LOCAL_BRIDGE_ERROR'),'message':str(error)}}


def run_sdk(c,fixture,actors=None,run_id=None):
    """Reusable real SDK loop for both composition and exact-cleanup tests."""
    process=subprocess.Popen(['node','tools/squad/business_journeys_local_bridge.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    selector=selectors.DefaultSelector()
    try:
        process.stdin.write(json.dumps({'roles':ROLES,'fixture':fixture,'run_id':run_id})+'\n');process.stdin.flush()
        selector.register(process.stdout,selectors.EVENT_READ)
        calls=0;denied=0;deadline=time.monotonic()+30
        while True:
            assert deadline>time.monotonic(),'Local SDK composition exceeded 30 seconds'
            assert selector.select(timeout=5),'Local SDK runner stopped responding'
            line=process.stdout.readline();assert line,'Local SDK runner ended without result'
            message=json.loads(line)
            if message['kind']=='result':
                process.stdin.close();assert process.wait(timeout=5)==0,process.stderr.read()
                return {**message,'calls':calls,'denied':denied}
            assert message['kind']=='rpc',message
            response=dispatch(c,message,actors);calls+=1;denied+=response['error'] is not None
            process.stdin.write(json.dumps(response)+'\n');process.stdin.flush()
    finally:
        selector.close()
        if process.poll() is None:process.kill();process.wait(timeout=5)
        for stream in [process.stdin,process.stdout,process.stderr]:
            if stream and not stream.closed:stream.close()


class BusinessJourneyComposition(unittest.TestCase):
    def test_commercial_factory_ratings_worker_dealer_and_team_compositions(self):
        with connect() as c:
            baseline=c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()
            mirror=c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
            self.assertFalse(mirror[0]);c.execute('BEGIN')
            process=None
            try:
                fixture=prepare_local(c)
                process=subprocess.Popen(['node','tools/squad/business_journeys_local_bridge.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
                process.stdin.write(json.dumps({'roles':ROLES,'fixture':fixture})+'\n');process.stdin.flush()
                selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
                report=None;calls=0;denied=0;deadline=time.monotonic()+30
                while report is None:
                    self.assertGreater(deadline,time.monotonic(),'Local SDK composition exceeded 30 seconds')
                    self.assertTrue(selector.select(timeout=5),'Local SDK runner stopped responding')
                    line=process.stdout.readline();self.assertTrue(line,'Local SDK runner ended without result')
                    message=json.loads(line)
                    if message['kind']=='result':report=message['report'];break
                    self.assertEqual(message['kind'],'rpc',message)
                    response=dispatch(c,message);calls+=1;denied+=response['error'] is not None
                    process.stdin.write(json.dumps(response)+'\n');process.stdin.flush()
                process.stdin.close();self.assertEqual(process.wait(timeout=5),0,process.stderr.read())
                self.assertEqual(len(report['commercial']['checks']),8)
                self.assertEqual(len(report['factory']['checks']),3)
                self.assertEqual(len(report['collaboration']['checks']),7)
                self.assertGreater(calls,100);self.assertGreater(denied,10)
                self.assertEqual(report['factory']['finalProgress'],{'required':3,'cut':3,'assigned':3,'sewn':3,'dispatched':3,'order_completed':True})
                # The deferred provider/email consumers never execute in this test.
                self.assertFalse(c.execute("SELECT 1 FROM sa_domain.outbox WHERE actor_id=ANY(%s) AND attempts>0 LIMIT 1",([uid(BASE+r) for r in ROLES],)).fetchone())
            finally:
                if process and process.poll() is None:process.kill();process.wait(timeout=5)
                if process:
                    for stream in [process.stdin,process.stdout,process.stderr]:
                        if stream and not stream.closed:stream.close()
                c.execute('ROLLBACK')
            self.assertEqual(c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone(),baseline)
            self.assertEqual(c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone(),mirror)
            self.assertFalse(c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id BETWEEN %s AND %s',(BASE,BASE+12)).fetchone())
            self.assertFalse(c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_base_products WHERE id=%s',(DATA_BASE+5,)).fetchone())


if __name__=='__main__':unittest.main(verbosity=2)
