"""Compile the pinned legacy notification vocabulary into shared routing data.

Reads the approved local Rails source only. This inventory is not, by itself,
proof of runtime delivery or permission parity; SQL/worker acceptance is separate.
"""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'../Canto/scott-international-backend/app'
OUT=ROOT/'packages/shared/squad-notification-rules.json'

def snake(name):return re.sub(r'([a-z0-9])([A-Z])',r'\1_\2',re.sub(r'(.)([A-Z][a-z]+)',r'\1_\2',name)).lower()
def topic(n):
 if n==1:return 'customer.registered'
 if n==2:return 'customer.coordinator_assigned'
 for lo,hi,t in [(3,15,'order.placed'),(16,17,'order.processing'),(18,19,'order.cancelled'),(20,21,'order.pickup_partial'),(22,23,'order.completed'),(24,24,'order.dealer_ready'),(26,28,'order.due_changed'),(29,32,'order.factory_assigned'),(33,36,'item.cutter_assigned'),(37,40,'item.cut_partial'),(41,44,'item.cut_complete'),(45,48,'item.work_assigned'),(49,52,'item.inspected_partial'),(53,57,'item.inspected_complete'),(58,60,'item.dispatched'),(61,64,'order.worker_assigned'),(65,66,'item.worker_cost_changed'),(67,68,'item.fabric_ordered'),(69,70,'item.cutting_started'),(71,73,'item.stitching_started'),(74,77,'order.price_changed'),(78,96,'order.edited'),(97,99,'order.rmp_price_changed'),(100,105,'order.cancelled'),(106,117,'order.placed')]:
  if lo<=n<=hi:return t
 raise ValueError('Unmapped type')
def build():
 base=SOURCE/'services/notifications';factory=(base/'strategy_factory.rb').read_text();types=(base/'types.rb').read_text()
 mapping=[(int(n),name) for n,name in re.findall(r'"(\d+)"\s*=>\s*Strategies::(\w+)',factory)];assert len(mapping)==115 and len({n for n,_ in mapping})==115
 templates={}
 for match in re.finditer(r'"(\d+)":\s*\{(.*?)\n\s*\}',types,re.S):
  values={k:json.loads('"'+v+'"') for k,v in re.findall(r'(title|body|action):\s*"((?:\\.|[^"\\])*)"',match[2])};templates[int(match[1])]=values
 calls={n:[] for n,_ in mapping}
 for path in sorted(SOURCE.rglob('*.rb')):
  for i,line in enumerate(path.read_text().splitlines(),1):
   if line.lstrip().startswith('#'):continue
   m=re.search(r'(?:SendNotificationJob\.perform_later|SendByTypeServiceV2\.(?:call|new)|send_notification)\(\s*["\']?(\d+)',line)
   if m and int(m[1]) in calls:calls[int(m[1])].append(str(path.relative_to(SOURCE))+':'+str(i))
 rules=[]
 dynamic={n:[] for n,_ in mapping}
 update_path=base/'update_notification_order_service.rb'
 for i,line in enumerate(update_path.read_text().splitlines(),1):
  for values in re.findall(r'\[((?:\d+,\s*)*\d+)\]',line):
   for n in map(int,values.split(',')):
    if n in dynamic:dynamic[n].append(str(update_path.relative_to(SOURCE))+':'+str(i))
 for n,name in mapping:
  path=base/'strategies'/(snake(name)+'.rb');source=path.read_text()
  match=re.search(r'def resolve_recipients\n(.*?)(?=\n      def |\Z)',source,re.S);assert match,name
  recipients=list(dict.fromkeys(re.findall(r'add_([a-z_]+)_recipients',match[1])))
  correction=None
  if n==14:recipients=['customer_when_actor_customer','dealer_when_actor_dealer']
  elif n==105:recipients=['actor']
  elif n==92:
   assert recipients==['dealers_customer'];recipients=['customer'];correction='The source calls undefined add_dealers_customer_recipients. Resolve the order customer, then apply current recipient scope.'
  assert recipients and set(recipients)<={'admin','sales_coordinator','customer','dealer','production_coordinator','factory_manager','inspectors','cutting_master','jobworker','actor','customer_when_actor_customer','dealer_when_actor_dealer'},(n,recipients)
  assert {'title','body'}<=templates[n].keys(),n
  rules.append({'legacy_type':n,'strategy':name,'topic':topic(n),'recipients':recipients,'entity':'person' if n<3 else 'order',**templates[n],
   'source':str(path.relative_to(SOURCE)),'callsites':calls[n],'dynamic_callsites':dynamic[n],**({'correction':correction} if correction else {})})
 return {'source_commit':'14277820c78e018e62be3da1a14cd8d716cdbf02','rules':rules,'policy':'Configuration selects candidates; live identity, role, resource and capability rules must authorize each recipient. Push payloads must not contain sensitive template values.'}
if __name__=='__main__':
 value=build();OUT.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'legacy_mappings':len(value['rules']),'shared_topics':len({r['topic'] for r in value['rules']}),'types_without_static_callsite':[r['legacy_type'] for r in value['rules'] if not r['callsites']],'explicit_corrections':[r['legacy_type'] for r in value['rules'] if r.get('correction')]}))
