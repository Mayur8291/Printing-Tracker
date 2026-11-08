"""Workforce SDK composition against real SQL; one rollback-only local fixture."""
import json
import selectors
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from local_db import connect
from test_business_journey_composition import ROOT, ROLES, dispatch, prepare_local


class WorkforceExtrasComposition(unittest.TestCase):
    def test_managed_work_payroll_documents_and_retained_archived_history(self):
        original=(ROOT/'tools/squad/business_journeys_local_bridge.mjs').read_text()
        # Reuse the common transport, but hold this focused sequence independent
        # of additional journey modules the integrated runner may later add.
        code="import {runJourney as workforceProbe} from './business_journey_workforce_extras.mjs';\n"+original.split(" phase='commercial';",1)[0]
        code+="""
 phase='commercial';ctx.commercial=await commercial(ctx);
 phase='factory';const factoryResult=await factory(ctx);
 phase='ratings';ctx.commercial=await finishJourney(ctx,ctx.commercial);
 phase='workforce-extras';const workforceResult=await workforceProbe(ctx);
 phase='collaboration';const collaborationResult=await collaboration(ctx);
 emit({kind:'result',report:{commercial:ctx.commercial,factory:factoryResult,workforce:workforceResult,collaboration:collaborationResult},journal});
"""+original[original.index('}catch(error)'):]
        runner=None;process=None;selector=selectors.DefaultSelector()
        with connect() as c:
            baseline=c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()
            c.execute('BEGIN')
            try:
                fixture=prepare_local(c)
                with tempfile.NamedTemporaryFile(mode='w',dir=ROOT/'tools/squad',prefix='.workforce-test-',suffix='.mjs',delete=False) as out:
                    out.write(code);runner=Path(out.name)
                process=subprocess.Popen(['node',str(runner)],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
                process.stdin.write(json.dumps({'roles':ROLES,'fixture':fixture})+'\n');process.stdin.flush()
                selector.register(process.stdout,selectors.EVENT_READ)
                deadline=time.monotonic()+45;report=None
                while report is None:
                    self.assertGreater(deadline,time.monotonic())
                    self.assertTrue(selector.select(timeout=5),'SDK runner stalled')
                    line=process.stdout.readline();self.assertTrue(line,'SDK runner ended without result')
                    message=json.loads(line)
                    if message['kind']=='result':report=message['report'];break
                    self.assertEqual(message['kind'],'rpc',message)
                    process.stdin.write(json.dumps(dispatch(c,message))+'\n');process.stdin.flush()
                process.stdin.close();self.assertEqual(process.wait(timeout=5),0,process.stderr.read())
                result=report['workforce'];self.assertEqual(len(result['checks']),5)
                entities=result['entities'];self.assertEqual(len(entities['documentIds']),2)
                c.execute('RESET ROLE')
                docs=c.execute('SELECT kind,state,request,snapshot IS NULL,job_id FROM sa_domain.documents WHERE id=ANY(%s::uuid[]) ORDER BY kind',(entities['documentIds'],)).fetchall()
                self.assertEqual([d[0] for d in docs],['delivery_challan','tailor_weekly'])
                self.assertTrue(all(d[1]=='queued' and d[2]['delivery']=='download' and d[3] for d in docs))
                self.assertEqual(docs[0][2]['dispatch_id'],entities['selectedDispatchId'])
                quantity=c.execute('SELECT sum(dispatched_quantity) FROM sa_snapshot_20261019.sa_dispatched_quantities WHERE job_sheet_dispatched_date_id=%s',(int(entities['selectedDispatchId']),)).fetchone()[0]
                self.assertEqual(quantity,1)
                self.assertEqual(c.execute('SELECT count(*) FROM sa_domain.outbox WHERE id=ANY(%s::uuid[]) AND status=\'pending\' AND attempts=0',([str(d[4]) for d in docs],)).fetchone()[0],2)
                self.assertEqual(c.execute('SELECT count(*) FROM sa_identity.sa_auth_identities WHERE legacy_user_id=ANY(%s)',([int(entities['tailorId']),int(entities['subtailorId'])],)).fetchone()[0],0)
                self.assertEqual(c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE id=ANY(%s) AND deleted_at IS NOT NULL',([int(entities['tailorId']),int(entities['subtailorId'])],)).fetchone()[0],2)
            finally:
                selector.close()
                if process:
                    if process.poll() is None:process.kill();process.wait(timeout=5)
                    for stream in [process.stdin,process.stdout,process.stderr]:
                        if stream and not stream.closed:stream.close()
                if runner:runner.unlink(missing_ok=True)
                c.execute('ROLLBACK')
            self.assertEqual(c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone(),baseline)


if __name__=='__main__':unittest.main()
