"""Rollback-only local maximum-batch saga timing; synthetic provider proofs, no HTTP."""
import argparse,hashlib,json,math,statistics,time,uuid
from pathlib import Path
from psycopg.types.json import Jsonb
from fixtures import rpc
from test_pricing import rmp
from test_warehouse_amendments import WarehouseAmendments

def main():
 p=argparse.ArgumentParser();p.add_argument('--runs',type=int,default=7);a=p.parse_args()
 evidence={'scope':'local synthetic rollback transactions; actual SQL publication, simulated provider acknowledgments','migration_sha256':hashlib.sha256(Path('supabase/migrations/20261108084246_squad_warehouse_amendments.sql').read_bytes()).hexdigest(),'lines':50,'pieces':2000,'runs':a.runs,'samples':{}}
 WarehouseAmendments.setUpClass()
 for provider in ['dashboard','unicommerce']:
  samples={}
  for n in range(a.runs+1):
   x=WarehouseAmendments();x.setUp()
   def timed(name,f):
    begin=time.perf_counter();r=f()
    if n:samples.setdefault(name,[]).append((time.perf_counter()-begin)*1000)
    return r
   try:
    if provider=='unicommerce':x.use_uniware()
    x.place();version=x.version();q=rpc(x.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(40) for _ in range(50)]}),))
    result=rpc(x.c,'v1_order_edit',(x.oid,uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-02T07:00:00Z'}),'Maximum-batch benchmark',version,uuid.uuid4()));x.rid=uuid.UUID(result['request_id']);j=x.claim()[0];intent=timed('prepare_initial',lambda:x.prepare(j));assert intent['state']=='prepared',intent
    result=timed('finish_inspect',lambda:x.finish(j,x.observed(intent)));assert result['state']=='pending',result;j=x.claim()[0];intent=timed('prepare_mutation',lambda:x.prepare(j));assert intent['state']=='prepared',intent
    if provider=='unicommerce':
     result=timed('finish_cancel',lambda:x.finish(j,x.cancel_ack(intent)));assert result['state']=='pending',result;j=x.claim()[0];intent=timed('prepare_replacement',lambda:x.prepare(j));assert intent['state']=='prepared',intent
    result=timed('finish_publish',lambda:x.finish(j,x.ack(intent)));assert result['state']=='done',result
    assert x.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(x.oid,))==[(2000,)]
   finally:x.tearDown()
  evidence['samples'][provider]={name:{'p50_ms':round(statistics.median(xs),3),'p95_ms':round(sorted(xs)[math.ceil(len(xs)*.95)-1],3),'max_ms':round(max(xs),3),'budget_ms':500,'pass':max(xs)<500} for name,xs in samples.items()}
 target=Path('docs/squad-one-audit/implementation-evidence/warehouse-amendments-local.json');target.write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence,indent=2))
 if not all(v['pass'] for p in evidence['samples'].values() for v in p.values()):raise SystemExit('Local saga budget exceeded')
if __name__=='__main__':main()
