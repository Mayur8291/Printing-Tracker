"""Reviewed web-contract staging release; preserves exact schedule state.

Rollback-only by default. No provider credentials or data refresh is involved.
An interrupted schedule change leaves a durable recovery checkpoint.
"""
import argparse,json,time
from deploy import ROOT,deploy
from database import connect
from release_mirror import atomic_json,cron_state
from snapshot import require
CHECKPOINT=ROOT/'tools/squad/private/web-release-staging-schedules.json'
NAMES=['squad-jobs-minute','squad-documents-pump','squad-media-cleanup']
def restore():
 state=json.loads(CHECKPOINT.read_text());require(state['environment']=='staging','Wrong checkpoint')
 with connect('staging') as c,c.transaction():
  require(c.execute('SELECT environment FROM sa_sync.environment_state').fetchone()==('staging',),'Wrong environment')
  current=cron_state(c)
  require([(r[0],r[1]) for r in current]==[(r[0],r[1]) for r in state['all_schedules']],'Schedule identities changed')
  # release_mirror hashes the full row, including active. Reconstruct each
  # original active flag for comparison; pausing must not look like drift.
  for job_id,name,active,digest in state['all_schedules']:
   original=c.execute("SELECT encode(sha256(convert_to(((to_jsonb(j)-'active')||jsonb_build_object('active',%s::boolean))::text,'UTF8')),'hex') FROM cron.job j WHERE jobid=%s AND jobname=%s",(active,job_id,name)).fetchone()
   require(original==(digest,),'Schedule definitions changed')
  for id_,name,active in state['schedules']:
   require(c.execute('SELECT jobname FROM cron.job WHERE jobid=%s',(id_,)).fetchone()==(name,),'Schedule identity changed')
   c.execute('SELECT cron.alter_job(%s,active:=%s)',(id_,active))
  require(cron_state(c)==state['all_schedules'],'Exact schedule restoration failed')
 CHECKPOINT.unlink();print('Exact staging schedules restored',flush=True)
def run(through,apply=False,recover=False):
 if recover:return restore()
 require(not CHECKPOINT.exists(),'Restore outstanding web release schedules first')
 saved=False
 try:
  with connect('staging') as c,c.transaction():
   require(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Refresh/release active')
   require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None),'Requires idle staging mirror')
   rows=c.execute('SELECT jobid,jobname,active FROM cron.job WHERE jobname=ANY(%s) ORDER BY jobid',(NAMES,)).fetchall()
   require({r[1] for r in rows}==set(NAMES),'Unexpected owned schedules')
   atomic_json(CHECKPOINT,{'environment':'staging','schedules':rows,'all_schedules':cron_state(c)});saved=True
   for id_,_,_ in rows:c.execute('SELECT cron.alter_job(%s,active:=false)',(id_,))
  print('Paused three Squad schedules; waiting for in-flight calls',flush=True);time.sleep(15)
  deploy(check=not apply,through=through)
 finally:
  if saved:restore()
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--through');parser.add_argument('--apply',action='store_true');parser.add_argument('--restore-schedules',action='store_true');args=parser.parse_args()
 require(args.restore_schedules or args.through,'Exact migration cutoff required')
 run(args.through,args.apply,args.restore_schedules)
