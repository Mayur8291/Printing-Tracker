"""Runs inside the staging harness's rollback transaction and sequence fence."""
import datetime,json,uuid,copy
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]

def exercise(c,order,request,details,checks):
 results=[]
 def measure(name,query,args,budget):
  samples=[]
  for sample in range(11):
   with c.transaction():
    plan=c.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0]
    samples.append(plan['Execution Time']);raise psycopg.Rollback()
   if sample>=1 and samples[-1]>budget*5:break
  result={'name':name,'samples_ms':samples[1:],'p95_ms':max(samples[1:]),'target_ms':budget};results.append(result)
  print(json.dumps({k:result[k] for k in ['name','p95_ms','target_ms']}),flush=True)
  return result
 id_=int(order['id']);before=c.execute('SELECT canto_api.v1_order_get(%s)',(id_,)).fetchone()[0]
 request=copy.deepcopy(request);request['lines'][0]['quantities'][0]['quantity']=10
 q=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb(request),)).fetchone()[0]
 args=(id_,uuid.UUID(q['quote_id']),q['version'],Jsonb(details),'Rollback amendment',order['version'],uuid.uuid4())
 measure('single_custom_amendment','SELECT canto_api.v1_order_edit(%s,%s,%s,%s,%s,%s,%s)',args,500)
 amended=c.execute('SELECT canto_api.v1_order_edit(%s,%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
 assert amended['state']=='applied' and amended['id']==order['id'] and amended['items'][0]['item_id']!=order['items'][0]['item_id']
 assert amended==c.execute('SELECT canto_api.v1_order_edit(%s,%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
 after=c.execute('SELECT canto_api.v1_order_get(%s)',(id_,)).fetchone()[0]
 assert after['created_on']==before['created_on'] and after['created_at']==before['created_at'] and after['customer_id']==before['customer_id']
 checks.append('SC amendment preserves identity/dates with immutable source history and exact retry')
 item=int(amended['items'][0]['item_id'])
 for section in ['quantities','bulk_plan','brandings','criteria','parts','addons','images','source_images','variants']:
  measure('item_'+section,'SELECT canto_api.v1_order_item_get(%s,%s,NULL,100)',(item,section),200)
  value=c.execute('SELECT canto_api.v1_order_item_get(%s,%s,NULL,100)',(item,section)).fetchone()[0]
  assert value['id']==str(item) and value['section']==section and len(value['records']['data'])<=100
 checks.append('all nine bounded detail sections read on staging')
 # Maximum supported amendment line count, created only in this transaction.
 request['lines']=[copy.deepcopy(request['lines'][0]) for _ in range(50)]
 details=copy.deepcopy(details);details['line_settings']={str(n):details['line_settings']['1'] for n in range(1,51)}
 q=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb(request),)).fetchone()[0]
 args=(id_,uuid.UUID(q['quote_id']),q['version'],Jsonb(details),'Rollback maximum amendment',amended['version'],uuid.uuid4())
 measure('fifty_line_amendment_enqueue','SELECT canto_api.v1_order_edit(%s,%s,%s,%s,%s,%s,%s)',args,500)
 queued=c.execute('SELECT canto_api.v1_order_edit(%s,%s,%s,%s,%s,%s,%s)',args).fetchone()[0];assert queued['state']=='queued' and not queued['provider_confirmation_required']
 c.execute('SET LOCAL ROLE sa_executor')
 measure('fifty_line_amendment_background_apply','SELECT sa_domain.execute_local_amendment(%s)',(uuid.UUID(queued['request_id']),),2000)
 amended=c.execute('SELECT sa_domain.execute_local_amendment(%s)',(uuid.UUID(queued['request_id']),)).fetchone()[0]
 assert amended==c.execute('SELECT sa_domain.execute_local_amendment(%s)',(uuid.UUID(queued['request_id']),)).fetchone()[0]
 c.execute('SET LOCAL ROLE sa_app');assert len(amended['items'])==50
 measure('fifty_line_order_detail','SELECT canto_api.v1_order_get(%s,NULL,50)',(id_,),200)
 page=c.execute('SELECT canto_api.v1_order_get(%s,NULL,30)',(id_,)).fetchone()[0]['items'];assert len(page['data'])==30 and page['next_cursor']
 more=c.execute('SELECT canto_api.v1_order_get(%s,%s,30)',(id_,page['next_cursor'])).fetchone()[0]['items'];assert len(more['data'])==20 and not more['next_cursor']
 assert not {x['id'] for x in page['data']}&{x['id'] for x in more['data']};checks.append('50-line amendment and disjoint continuation pages')
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,
 'scope':'warm database execution; mapped SC; all rows and sessions rolled back, sequences restored by harness; no provider calls'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-order-amendments-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 failed=[r for r in results if r['p95_ms']>=r['target_ms']]
 assert not failed,[{k:r[k] for k in ['name','p95_ms','target_ms']} for r in failed]
 checks.append('detail reads below 200ms; interactive apply/enqueue below 500ms; 50-line background transaction below 2s DB p95')
