"""Read-only audit of all supported snapshot file references against published mappings."""
import argparse,json,tempfile
from pathlib import Path
from psycopg import sql
from database import connect,SCHEMA
from media_sync import CONTRACTS,inventory

def audit(environment):
 with connect(environment) as c,c.transaction(),tempfile.TemporaryDirectory() as folder:
  c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  rows=c.execute("""SELECT cl.relname,a.attname,t.typcategory,t.typname,a.attndims
    FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace
    JOIN pg_attribute a ON a.attrelid=cl.oid JOIN pg_type t ON t.oid=a.atttypid
    WHERE n.nspname=%s AND cl.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY cl.relname,a.attnum""",(SCHEMA,)).fetchall()
  tables={}
  for table,name,category,typename,dimensions in rows:
   tables.setdefault(table,[]).append((name,category,typename,dimensions))
  manifest={'environment':environment,'tables':{}}
  for table,columns in tables.items():
   resource=table.removeprefix('sa_')
   if 'id' not in [x[0] for x in columns]:continue
   known=CONTRACTS.get(resource,{}).get('fields',[])
   fields=[name for name,category,typename,dimensions in columns if name!='id' and (category=='S' or typename in ('json','jsonb') or dimensions>0 or name in known)]
   if not fields:continue
   selected=['id']+fields
   criteria=[sql.SQL("{}::text ~ '(https?://|uploads/|pdfs/)'").format(sql.Identifier(name)) for name in fields]
   criteria += [sql.SQL("coalesce({}::text,'')<>''").format(sql.Identifier(name)) for name in known]
   statement=sql.SQL('COPY (SELECT {} FROM {} WHERE {}) TO STDOUT').format(sql.SQL(',').join(map(sql.Identifier,selected)),sql.Identifier(SCHEMA,table),sql.SQL(' OR ').join(criteria))
   with (Path(folder)/(resource+'.copy')).open('wb') as out,c.cursor().copy(statement) as copy:
    for block in copy:out.write(block)
   manifest['tables'][resource]={'columns':selected}
  expected=inventory(folder,manifest)
  keys=['resource','record_id','field','pointer','source_value','source_url']
  expected={tuple(r.get(k) for k in keys) for r in expected}
  actual=set(c.execute('SELECT resource,record_id,field,pointer,source_value,source_url FROM sa_media.references').fetchall())
  result={'environment':environment,'references_discovered':len(expected),'references_published':len(actual),'missing_mappings':len(expected-actual),'unexpected_mappings':len(actual-expected)}
  print(json.dumps(result),flush=True)
  assert expected==actual,'Published media inventory differs from the current scanner'
  return result
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('environment',choices=['staging','production']);audit(p.parse_args().environment)
