"""Local rollback-only RLS seek benchmark; never accepts a remote database."""
import json
from local_db import connect
from fixtures import session

def run():
 c=connect();c.execute('BEGIN')
 try:
  assert c.info.host in('localhost','127.0.0.1') and c.info.port==55441
  c.execute("INSERT INTO sa_snapshot_20261019.sa_orders SELECT (jsonb_populate_record(NULL::sa_snapshot_20261019.sa_orders,to_jsonb(o)||jsonb_build_object('id',8000000+g,'due_on','2027-01-01'::timestamp+g*interval '1 minute','created_at','2026-12-01'::timestamp+g*interval '1 minute'))).* FROM sa_snapshot_20261019.sa_orders o CROSS JOIN generate_series(1,10000) g WHERE o.id=1001")
  c.execute('ANALYZE sa_snapshot_20261019.sa_orders');session(c,103);c.execute('SET LOCAL ROLE sa_executor')
  results=[]
  for name,column,operator,direction,stamp in [('due','due_on','>','ASC','2027-01-06'),('created','created_at','<','DESC','2026-12-06')]:
   result=c.execute(f"EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM sa_domain.filtered_orders('{{}}') o WHERE {column} IS NOT NULL AND ({column},id){operator}(%s::timestamp,8007200) ORDER BY {column} {direction} NULLS LAST,id {direction} LIMIT 31",(stamp,)).fetchone()[0][0]
   def nodes(p):
    yield p
    for child in p.get('Plans',[]):yield from nodes(child)
   index=next((p for p in nodes(result['Plan']) if p.get('Index Name')=='squad_orders_'+name+'_seek'),None)
   assert index is not None,result
   assert 'ROW(' in index.get('Index Cond',''),index
   assert index.get('Rows Removed by Filter',0)==0,index
   assert result['Plan']['Actual Rows']==31
   results.append({'sort':name,'index':index['Index Name'],'index_condition':index['Index Cond'],'rows':31,'rows_removed':index.get('Rows Removed by Filter',0),'execution_ms':result['Execution Time'],'shared_hit_blocks':result['Plan']['Shared Hit Blocks']})
  return {'local_only':True,'synthetic_rows':10000,'scope':'Customer103','deep_cursor_id':8007200,'results':results,'changes':'rolled_back'}
 finally:c.rollback();c.close()
if __name__=='__main__':print(json.dumps(run(),indent=2))
