"""Default-off exact owned stock counter UI proof; --execute is integrator-only.
No native cutover, background worker, provider or cleanup permission changes.
"""
import argparse,datetime,json,os,uuid
from pathlib import Path
import test_hosted_business_journeys as business
import web_stock_fixture as stock
from test_web_document_outputs_hosted import child

def marker(state):
 value=state.get('web_stock_reconciliation');assert isinstance(value,dict) and value.get('format')==stock.MARKER and value.get('run_id')==state['run_id'],'Use the original dedicated recovery harness';return value

def run(execute=False,recover=False):
 if not recover:assert not business.CHECKPOINT.exists(),'Recover existing fixture first'
 with business.identities.connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release active'
  shared=False;credentials=[]
  try:
   if recover:
    state=business.validate(json.loads(business.CHECKPOINT.read_text()));marker(state)
    result=business.cleanup(c,state);business.set_crons(c,state,False);business.CHECKPOINT.unlink();print(json.dumps(result));return
   state=stock.plan(business.plan(c))
   if not execute:print(json.dumps({'mode':'read-only preflight','scope':stock.MARKER,'cutover':False,'receipt_count':1,'counter_before':1,'expected_consumed':0,'provider_execution':False}));return
   business.save(state);Path(state['journal']).touch(mode=0o600,exist_ok=False)
   def emit(entry):
    with open(state['journal'],'a') as stream:stream.write(json.dumps(entry)+'\n');stream.flush();os.fsync(stream.fileno())
   try:
    business.set_crons(c,state,True)
    with c.transaction():
     credentials=business.prepare(c,state);stock.prepare(c,state,emit);business.save(state)
    c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
    payload={'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture']}
    env=dict(os.environ,SQUAD_WEB_JOURNEYS='stock-reconciliation')
    report=child(['node','tools/squad/web-business-hosted.mjs'],payload,business.PRIVATE/('web-stock-'+state['run_id']),'browser',600,env)
    assert report['run_id']==state['run_id'] and report['environment']=='staging' and set(report['journeys'])=={'stock-reconciliation'}
   finally:
    for actor in credentials:actor['password']=''
    if shared:
     c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
    marker(state);cleaned=business.cleanup(c,state);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
   report.update(cleanup=cleaned,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),cutover_unchanged=True,cron_restored=True,provider_execution=False,setup_scope=stock.MARKER)
   destination=business.ROOT/'docs/squad-one-web/evidence/stock-reconciliation-acceptance.json';destination.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  finally:
   if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
   c.execute('SELECT pg_advisory_unlock(20261107,1)')
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true');group.add_argument('--recover',action='store_true');args=parser.parse_args();run(args.execute,args.recover)
