"""Staging-only real Uniware authentication/inventory check, with no business DML.

The deployed worker reads existing credentials in its own secret store. This
script sends two existing SKU codes and optionally one source-linked order code;
it never receives credentials, quantities, customer data or custom-field values.
It does not prove order mutation acceptance or Rails facility parity.
"""
import argparse,datetime,json,sys,time,urllib.error,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import PROJECTS

def run(order=False):
 with connect('staging') as c:
  before=public_structure(c)
  state=c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()
  assert state==('staging',False,None),'Requires idle staging mirror'
  count=c.execute('SELECT count(*) FROM sa_domain.outbox').fetchone()[0]
  secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
  skus=[r[0] for r in c.execute("SELECT DISTINCT btrim(name) FROM sa_snapshot_20261019.sa_rmp_skus WHERE name IS NOT NULL AND name ~ '^[A-Za-z0-9_-]{1,100}$' ORDER BY 1 LIMIT 2")]
  assert len(skus)==2,'Expected existing SKU codes'
  payload={'skus':skus}
  if order:
   # The old staging snapshot contains legacy P- references. Reading their
   # provider shape is authorized; this is never permission to mutate them.
   row=c.execute("SELECT uc_order_id FROM sa_snapshot_20261019.sa_orders WHERE deleted_at IS NULL AND is_deleted IS NOT TRUE AND coalesce(order_source,'unicommerce')='unicommerce' AND uc_status='COMPLETE' AND uc_order_id ~ '^[SP]-[0-9]+(-[0-9]+)?$' ORDER BY id DESC LIMIT 1").fetchone()
   assert row,'Expected known source-linked staging Uniware order'
   payload['order_code']=row[0]
  url='https://'+PROJECTS['staging']+'.supabase.co/functions/v1/squad-jobs/warehouse-check'
  def call(authorization):
   req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':authorization},method='POST')
   try:
    with urllib.request.urlopen(req,timeout=60) as r:return r.status,json.loads(r.read())
   except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
  assert call('Bearer wrong')[0]==401,'Anonymous check must be rejected'
  started=time.monotonic();status,result=call('Bearer '+secret)
  elapsed=round((time.monotonic()-started)*1000,2)
  assert public_structure(c)==before
  assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==state
  assert c.execute('SELECT count(*) FROM sa_domain.outbox').fetchone()[0]==count
  evidence={'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':'staging','real_provider':True,'duration_ms':elapsed,'http_status':status,'result':result,'provider_business_writes':0,'database_business_writes':0,'public_structure_unchanged':True,'mirror_unchanged':True,'credential_values_returned':False,'rails_configuration_parity_verified':False,'order_mutations_verified':False}
  if order:evidence['source_reference_prefix']=payload['order_code'][:2]
  path=ROOT/'docs/squad-one-audit/implementation-evidence'/('staging-uniware-order-read.json' if order else 'staging-uniware-read.json')
  path.write_text(json.dumps(evidence,indent=2)+'\n')
  print(json.dumps(evidence))
  assert status==200 and result.get('state')=='verified','Uniware real read check did not verify; inspect sanitized evidence'

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--order',action='store_true');run(order=p.parse_args().order)
