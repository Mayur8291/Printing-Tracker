"""Pause only the three owned staging schedules during a reviewed DDL release.

The durable private checkpoint restores exact prior states, including a schedule
that was already disabled. This is maintenance in mirror mode, never cutover.
"""
import argparse,json,time
from pathlib import Path
from deploy import deploy,connect,ROOT,require
CHECKPOINT=ROOT/'tools/squad/private/deploy-schedules.json'
NAMES=('squad-jobs-minute','squad-documents-pump','squad-media-cleanup')

def restore():
 state=json.loads(CHECKPOINT.read_text());require(state['environment']=='staging','Unexpected checkpoint')
 with connect('staging') as c,c.transaction():
  require(c.execute('SELECT environment FROM sa_sync.environment_state').fetchone()==('staging',),'Wrong environment')
  for row in state['schedules']:
   require(c.execute('SELECT jobname FROM cron.job WHERE jobid=%s',(row['id'],)).fetchone()==(row['name'],),'Schedule identity changed')
   c.execute('SELECT cron.alter_job(%s,active:=%s)',(row['id'],row['active']))
 CHECKPOINT.unlink();print('Restored exact prior staging schedule states',flush=True)

def run(check=True,through=None):
 require(not CHECKPOINT.exists(),'Recover the existing deployment schedule checkpoint before proceeding')
 saved=False
 try:
  with connect('staging') as c,c.transaction():
   require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None),'Maintenance requires idle staging mirror')
   require(c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status='leased' AND lease_until>now()").fetchone()[0]==0,'Wait for active worker leases')
   rows=c.execute('SELECT jobid,jobname,active FROM cron.job WHERE jobname=ANY(%s) ORDER BY jobid',(list(NAMES),)).fetchall()
   require({r[1] for r in rows}==set(NAMES),'Expected all owned schedules')
   CHECKPOINT.parent.mkdir(exist_ok=True,mode=0o700)
   with CHECKPOINT.open('x') as f:json.dump({'environment':'staging','schedules':[{'id':r[0],'name':r[1],'active':r[2]} for r in rows]},f)
   CHECKPOINT.chmod(0o600);saved=True
   for id_,_,_ in rows:c.execute('SELECT cron.alter_job(%s,active:=false)',(id_,))
  print('Paused three owned staging schedules; allowing current cleanup calls to drain',flush=True)
  time.sleep(15)
  deploy(check=check,through=through)
 finally:
  if saved:restore()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--through');p.add_argument('--restore',action='store_true');a=p.parse_args()
 if a.restore:restore()
 else:run(check=not a.apply,through=a.through)
