"""Reviewed staging SQL profiler: every fixture and sequence change rolls back.

Default invocation is read-only. --execute is for the release integrator after
review; --local executes only against the isolated local PostgreSQL harness.
This measures actual shared SDK calls through SQL, not Auth or HTTP latency.
"""
import argparse
import datetime
import json
import os
import re
import selectors
import subprocess
import time
from pathlib import Path

import psycopg
from psycopg import sql

from test_business_journey_composition import BASE, DATA_BASE, ROOT, ROLES, dispatch, prepare_local
from test_hosted_business_journeys import CHECKPOINT, cron_state, source_state
from test_hosted_personas import connect as hosted_connect, public_structure, staff_auth

PRIVATE=ROOT/'tools/squad/private'
SCHEMAS=('sa_snapshot_20261019','sa_domain','sa_identity','sa_sync')
PHASES={'identity','commercial','factory','ratings','collaboration'}


def context_functions(context):
    """Discard query text, arguments, messages and detail; retain code locations."""
    result=[]
    for line in (context or '').splitlines():
        match=re.match(r'(?:PL/pgSQL|SQL) function "?([a-z_][a-z0-9_.]*)"?(?=\(|\s|$)',line)
        if match:
            number=re.search(r'\) line ([0-9]+)\b',line)
            row={'function':match.group(1)}
            if number:row['line']=int(number.group(1))
            if row not in result:result.append(row)
    return result[:30]


def sequence_states(c):
    names=c.execute("SELECT n.nspname,q.relname FROM pg_class q JOIN pg_namespace n ON n.oid=q.relnamespace WHERE q.relkind='S' AND n.nspname=ANY(%s) ORDER BY 1,2",(list(SCHEMAS),)).fetchall()
    assert 0<len(names)<=200,'Unexpected sequence inventory'
    queries=[sql.SQL('SELECT {},last_value,is_called FROM {}.{}').format(sql.Literal(schema+'.'+name),sql.Identifier(schema),sql.Identifier(name)) for schema,name in names]
    return {name:(value,called) for name,value,called in c.execute(sql.SQL(' UNION ALL ').join(queries))}


def fence_sequences(c):
    """RESTART uses transactional sequence storage; rollback restores exact state.

    The initial no-op CACHE alteration locks before reading last_value. CACHE1
    is required, preventing previously reserved values in other connections.
    No setval restoration window exists, including on process disconnect.
    """
    assert c.info.transaction_status.name=='INTRANS'
    c.execute('CREATE TEMP TABLE squad_profile_sequences(name text PRIMARY KEY,value bigint,called boolean) ON COMMIT DROP')
    c.execute("""DO $profile$
      DECLARE r record; v bigint; used boolean; next_value bigint;
      BEGIN
        FOR r IN SELECT n.nspname,q.relname,s.* FROM pg_sequence s
          JOIN pg_class q ON q.oid=s.seqrelid JOIN pg_namespace n ON n.oid=q.relnamespace
          WHERE n.nspname IN('sa_snapshot_20261019','sa_domain','sa_identity','sa_sync') ORDER BY n.nspname,q.relname
        LOOP
          IF r.seqcache<>1 OR r.seqcycle OR r.seqincrement<>1 THEN
            RAISE EXCEPTION 'Profiler requires uncached ascending noncycling sequences';
          END IF;
          EXECUTE format('ALTER SEQUENCE %I.%I CACHE 1',r.nspname,r.relname);
          EXECUTE format('SELECT last_value,is_called FROM %I.%I',r.nspname,r.relname) INTO v,used;
          next_value:=v+CASE WHEN used THEN 1 ELSE 0 END;
          IF next_value>r.seqmax THEN RAISE EXCEPTION 'Profiler sequence exhausted'; END IF;
          INSERT INTO pg_temp.squad_profile_sequences VALUES(r.nspname||'.'||r.relname,v,used);
          EXECUTE format('ALTER SEQUENCE %I.%I RESTART WITH %s',r.nspname,r.relname,next_value);
        END LOOP;
      END $profile$""")
    return {name:(value,called) for name,value,called in c.execute('SELECT name,value,called FROM pg_temp.squad_profile_sequences ORDER BY name')}


def preflight(c):
    state=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
    assert state[:3]==('staging',False,None) and state[3]==state[4],'Requires an idle clean staging mirror'
    assert c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()==(False,[],None),'Rehearsal already enabled'
    assert not c.execute("SELECT 1 FROM sa_domain.outbox WHERE status IN('pending','leased') LIMIT 1").fetchone(),'Existing jobs must finish first'
    assert not c.execute("SELECT 1 FROM sa_domain.account_flows WHERE state IN('pending','processing') LIMIT 1").fetchone(),'Existing account flows must finish first'
    assert not CHECKPOINT.exists(),'Recover committed business fixture before profiling'
    return state


def sdk_profile(c,fixture,rpc_timeout_ms=10000,total_seconds=240,record=None):
    process=subprocess.Popen(['node','tools/squad/business_journeys_local_bridge.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    selector=selectors.DefaultSelector();samples=[];deadline=time.monotonic()+total_seconds
    try:
        process.stdin.write(json.dumps({'roles':ROLES,'fixture':fixture,'profile':True})+'\n');process.stdin.flush()
        selector.register(process.stdout,selectors.EVENT_READ)
        while True:
            assert time.monotonic()<deadline,'Profiler total time budget exceeded'
            assert selector.select(timeout=5),'SDK runner stopped responding'
            line=process.stdout.readline();assert line,'SDK runner ended without result'
            request=json.loads(line)
            if request['kind']=='result':
                return {'completed':True,'groups':{k:len(v['checks']) for k,v in request['report'].items()},'samples':samples}
            if request['kind']=='failed':
                # Node messages/stacks may reflect SQL values; never persist them.
                code=request['error'].get('code')
                return {'completed':False,'failure_code':code if re.fullmatch(r'[A-Z0-9_]{1,40}',code or '') else 'SDK_ASSERTION','samples':samples}
            assert request['kind']=='rpc' and request['phase'] in PHASES
            assert request['label'] is None or re.fullmatch(r'[A-Za-z0-9._-]{1,120}',request['label'])
            sample={'number':len(samples)+1,'phase':request['phase'],'command_label':request['label'],'role':request['role'],'rpc':request['name'],'argument_names':sorted(request['args'])}
            def observed(value):
                sample['sql_ms']=None if value['elapsed_ms'] is None else round(value['elapsed_ms'],3)
                error=value['error']
                sample['sqlstate']=None if error is None else getattr(error,'sqlstate','BRIDGE_ERROR')
                if error:sample['context_functions']=context_functions(getattr(getattr(error,'diag',None),'context',None))
            c.execute("SELECT set_config('statement_timeout',%s,true)",(str(rpc_timeout_ms),))
            started=time.monotonic();response=dispatch(c,request,observer=observed,privileged_role='postgres')
            sample['adapter_ms']=round((time.monotonic()-started)*1000,3);samples.append(sample)
            if record:record(sample)
            # The SDK only requires code/kind for these expected failures.
            if response['error']:response['error']['message']='SQL operation returned '+str(response['error']['code'])
            process.stdin.write(json.dumps(response)+'\n');process.stdin.flush()
    finally:
        selector.close()
        if process.poll() is None:process.kill();process.wait(timeout=5)
        for stream in [process.stdin,process.stdout,process.stderr]:
            if stream and not stream.closed:stream.close()


def run(local=False,execute=False,rpc_timeout_ms=10000):
    assert type(rpc_timeout_ms) is int and 1000<=rpc_timeout_ms<=30000
    if local:
        from local_db import connect
        opener=connect
    else:opener=lambda:hosted_connect('staging')
    with opener() as c:
        before=preflight(c)
        if not execute and not local:return {'environment':'staging','preflight':'ready','execute':False}
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh, release or another rehearsal is active'
        try:
            before=preflight(c)
            c.execute("SET statement_timeout='120s';SET lock_timeout='3s';SET idle_in_transaction_session_timeout='30s'")
            runtime=c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0]
            structure=public_structure(c);staff=staff_auth(c);crons=cron_state(c)
            initial_source=source_state(c)
            PRIVATE.mkdir(exist_ok=True,mode=0o700)
            stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            log=PRIVATE/f'business-sql-profile-{stamp}.jsonl'
            with open(log,'x') as stream:
                os.chmod(log,0o600)
                def record(sample):stream.write(json.dumps(sample)+'\n');stream.flush()
                result=None;failure=None;sequences=None
                try:
                    with c.transaction():
                        sequences=fence_sequences(c)
                        fixture=prepare_local(c)
                        # The fixed local fixture has no HTTP expiry pressure; this
                        # bounded window remains invisible outside the transaction.
                        c.execute("UPDATE sa_domain.runtime_state SET test_write_expires_at=statement_timestamp()+interval '5 minutes'")
                        result=sdk_profile(c,fixture,rpc_timeout_ms,record=record)
                        c.execute('SET LOCAL ROLE postgres')
                        assert not c.execute('SELECT 1 FROM sa_domain.outbox WHERE actor_id=ANY(SELECT auth_user_id FROM sa_identity.sa_auth_identities WHERE legacy_user_id BETWEEN %s AND %s) AND attempts>0',(BASE,BASE+12)).fetchone(),'Worker execution is not allowed'
                        raise psycopg.Rollback()
                except BaseException as error:
                    failure=error
                finally:
                    # c.transaction rolls back for ordinary exceptions and Ctrl-C;
                    # server transaction abort also restores fenced sequences.
                    assert c.info.transaction_status.name=='IDLE','Fixture transaction remains open'
            c.execute('SET ROLE postgres')
            assert before==c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
            assert runtime==c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0]
            if sequences is not None:assert sequences==sequence_states(c),'Sequence state changed despite rollback'
            assert initial_source==source_state(c),'Source baseline changed'
            assert structure==public_structure(c) and staff==staff_auth(c),'Unrelated public or staff state changed'
            assert crons==cron_state(c),'Cron state changed'
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id BETWEEN %s AND %s',(BASE,BASE+12)).fetchone()
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_base_products WHERE id=%s',(DATA_BASE+5,)).fetchone()
            if failure:raise failure
            return {**result,'environment':'local synthetic' if local else 'staging','scope':'Shared SDK via direct SQL; not GoTrue, HTTP, SMTP, Cron execution or provider acceptance','all_changes_rolled_back':True,'sequences_restored':len(sequences),'source_restored':True,'public_and_staff_unchanged':True,'cron_unchanged':True,'log':str(log)}
        finally:c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--local',action='store_true');parser.add_argument('--rpc-timeout-ms',type=int,default=10000);args=parser.parse_args()
    print(json.dumps(run(args.local,args.execute,args.rpc_timeout_ms),indent=2))
