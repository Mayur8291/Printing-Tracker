"""One immutable PNG, two owned ready references and one missing promotion.
Default-off setup only; no new media permission, provider or hosted execution.
"""
import hashlib,json,uuid,urllib.request
from psycopg import sql
from web_media_recovery import png,snapshot
FORMAT='squad-web-content-fixture/v1'
URL='https://scvojtvgnkmbupvyslmb.supabase.co'
SCHEMA='sa_snapshot_20261019'

def specification(state):
 data=png(state['run_id'],2);digest=hashlib.sha256(data).hexdigest();base=state['data_base'];label=state['label']
 return {'format':FORMAT,'run_id':state['run_id'],'sha256':digest,'bytes':len(data),'content_type':'image/png',
         'path':f'sha256/{digest[:2]}/{digest}','filename':f'content-{state["run_id"]}.png',
         'class_id':str(base+104),'ready_id':str(base+300),'missing_id':str(base+301),
         'category':label+' content','ready_name':label+' ready PNG','missing_name':label+' missing PNG',
         'product_name':label+' RMP class','upload_date':state['created_at'][:10]}

def planned_rows(state):
 p=state['web_content_media'];s=specification(state)
 assert all(p.get(k)==v for k,v in s.items()),'Content marker differs from immutable plan'
 rows=[]
 for kind in ('ready','missing'):
  rows.append({'id':int(s[kind+'_id']),'name':s[kind+'_name'],'category':s['category'],
   'upload_date':s['upload_date'],'file_size':str(s['bytes']),
   'link':'squad:'+s['sha256'] if kind=='ready' else s['filename']+'.missing','is_deleted':False})
 return {'table':SCHEMA+'.sa_promotions','ids':[r['id'] for r in rows],'rows':rows}

def plan(c,state):
 assert state['stage']=='planned' and 'web_content_media' not in state
 from business_fixture_commercial import plan_fixture
 p=specification(state);p.update(before=snapshot(c),storage_intent=False,upload_started_at=None,upload_completed=False,storage_receipt=None,storage_deleted=False,setup_receipt=None)
 state['web_content_media']=p;state['fixture']=plan_fixture(state)
 for table,ids in [('sa_promotions',[int(p['ready_id']),int(p['missing_id'])])]:
  assert not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE id=ANY(%s::bigint[])').format(sql.Identifier(SCHEMA),sql.Identifier(table)),(ids,)).fetchone(),'Planned content IDs collide'
 assert not c.execute('SELECT 1 FROM sa_media.objects WHERE sha256=%s',(p['sha256'],)).fetchone()
 assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='canto-media' AND name=%s",(p['path'],)).fetchone()
 return p

def validate(state):
 p=state['web_content_media'];s=specification(state)
 assert all(p.get(k)==v for k,v in s.items()),'Content marker differs from immutable plan'
 assert p['storage_intent'] in (True,False) and p['storage_deleted'] in (True,False) and p['upload_completed'] in (True,False)
 assert (p['upload_started_at'] is not None)==p['storage_intent']
 assert not p['upload_completed'] or p['storage_intent']
 return p

def targets(p):return [('rmp_classes',int(p['class_id']),'image_1'),('promotions',int(p['ready_id']),'link'),('promotions',int(p['missing_id']),'link')]

def db_receipt(c,p):
 refs=[];source=[]
 for resource,id,field in targets(p):
  refs+=c.execute("SELECT to_jsonb(r),xmin::text FROM sa_media.references r WHERE resource=%s AND record_id=%s AND field=%s ORDER BY pointer",(resource,id,field)).fetchall()
  source+=c.execute(sql.SQL("SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),xmin::text FROM {}.{} t WHERE id=%s").format(sql.Identifier(SCHEMA),sql.Identifier('sa_'+resource)),(id,)).fetchall()
 objects=c.execute('SELECT to_jsonb(o),xmin::text FROM sa_media.objects o WHERE sha256=%s',(p['sha256'],)).fetchall()
 return json.loads(json.dumps({'refs':refs,'source':source,'objects':objects}))

def prepare(c,state):
 p=validate(state);xid=str(c.execute('SELECT txid_current()').fetchone()[0])
 assert state['stage']=='prepared' and int(xid) in state['setup_xids'],'Must share original setup transaction'
 assert p['setup_receipt'] is None
 marker='squad:'+p['sha256']
 assert c.execute('UPDATE sa_snapshot_20261019.sa_rmp_classes SET image_1=%s WHERE id=%s AND image_1 IS NULL RETURNING xmin::text',(marker,int(p['class_id']))).fetchone()==(xid,)
 c.execute("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,%s,'image/png')",(p['sha256'],p['path'],p['bytes']))
 for resource,id,field in targets(p):
  missing=id==int(p['missing_id']) and resource=='promotions'
  c.execute("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES(%s,%s,%s,'',%s,%s,%s)",(resource,id,field,p['filename']+'.missing' if missing else marker,'missing' if missing else 'ready',None if missing else p['sha256']))
 p['setup_receipt']=db_receipt(c,p)
 assert len(p['setup_receipt']['refs'])==3 and len(p['setup_receipt']['source'])==3 and len(p['setup_receipt']['objects'])==1
 assert all(row[1]==xid for rows in p['setup_receipt'].values() for row in rows)
 return p

def bindings(c,state):
 p=validate(state)
 assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
 assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['identity']['generation']
 current=db_receipt(c,p)
 absent=all(not rows for rows in current.values())
 if p['setup_receipt'] is None:
  assert absent,'Uncommitted setup has unexpected content'
 elif absent:
  # The checkpoint was fsynced before the setup transaction committed. A full
  # rollback must leave neither content nor any planned Auth identity.
  assert not c.execute('SELECT 1 FROM auth.users WHERE id=ANY(%s::uuid[]) LIMIT 1',([a['auth_id'] for a in state['identity']['actors']],)).fetchone(),'Committed content disappeared'
 else:assert current==p['setup_receipt'],'Owned content changed after setup'
 refs=c.execute('SELECT resource,record_id,field FROM sa_media.references WHERE sha256=%s ORDER BY resource,record_id,field',(p['sha256'],)).fetchall()
 expected=sorted(targets(p)[:2]) if not absent else []
 assert refs==expected,'Foreign reference points at fixture media'
 assert not c.execute('SELECT 1 FROM sa_domain.media_uploads WHERE sha256=%s LIMIT 1',(p['sha256'],)).fetchone(),'Upload references fixture media'
 assert not c.execute('SELECT 1 FROM sa_domain.document_attachments WHERE sha256=%s LIMIT 1',(p['sha256'],)).fetchone(),'Document references fixture media'
 assert not c.execute("SELECT 1 FROM sa_admin.media WHERE position(%s IN url)>0 LIMIT 1",(p['sha256'],)).fetchone(),'Override references fixture media'
 return p

def storage_row(c,p):
 row=c.execute("SELECT to_jsonb(o)-'last_accessed_at' FROM storage.objects o WHERE bucket_id='canto-media' AND name=%s",(p['path'],)).fetchone()
 return row[0] if row else None

def storage_request(key,p,method):
 path='object/canto-media'+('/'+p['path'] if method in ('POST','GET') else '')
 data=png(p['run_id'],2) if method=='POST' else json.dumps({'prefixes':[p['path']]}).encode() if method=='DELETE' else None
 req=urllib.request.Request(URL+'/storage/v1/'+path,method=method,data=data,headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'image/png' if method=='POST' else 'application/json','x-upsert':'false'})
 with urllib.request.urlopen(req,timeout=30) as response:
  assert response.status in (200,201)
  return response.read(p['bytes']+1) if method=='GET' else None

def verify_storage(c,p,key):
 row=storage_row(c,p);assert row,'Owned Storage object missing'
 assert row['bucket_id']=='canto-media' and row['name']==p['path'] and str(uuid.UUID(row['id']))==row['id']
 assert row.get('metadata',{}).get('mimetype')=='image/png' and row['metadata'].get('size')==p['bytes'],'Storage MIME/size differs from planned PNG'
 if p['storage_receipt'] is not None:assert row==p['storage_receipt'],'Owned Storage metadata changed'
 data=storage_request(key,p,'GET');assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256'],'Owned Storage bytes changed'
 return row

def upload(c,state,key,save):
 p=bindings(c,state);assert p['setup_receipt'] and not p['storage_intent'] and not storage_row(c,p)
 p['storage_intent']=True;p['upload_started_at']=c.execute('SELECT clock_timestamp()').fetchone()[0].isoformat();save(state)
 storage_request(key,p,'POST');p['upload_completed']=True;save(state)
 p['storage_receipt']=verify_storage(c,p,key);save(state)

def cleanup_storage(c,state,key,save):
 p=bindings(c,state);row=storage_row(c,p)
 if p['storage_intent'] and not p['upload_completed']:
  assert c.execute("SELECT %s::timestamptz+interval '2 hours 10 minutes'<clock_timestamp()",(p['upload_started_at'],)).fetchone()==(True,), 'Unknown upload completion; retain checkpoint until media grace expires'
 if row:
  assert p['storage_intent'],'Storage appeared without an owned upload attempt'
  p['storage_receipt']=verify_storage(c,p,key);save(state)
  bindings(c,state);assert storage_row(c,p)==p['storage_receipt'],'Storage changed before deletion'
  storage_request(key,p,'DELETE')
 assert not storage_row(c,p),'Owned Storage object remains'
 p['storage_deleted']=True;save(state)

def cleanup_database(c,state,entries):
 p=bindings(c,state);assert p['storage_deleted'] and not storage_row(c,p)
 removed=len(db_receipt(c,p)['refs']);object_count=len(db_receipt(c,p)['objects'])
 for resource,id,field in targets(p):c.execute('DELETE FROM sa_media.references WHERE resource=%s AND record_id=%s AND field=%s',(resource,id,field))
 assert not c.execute('SELECT 1 FROM sa_media.references WHERE sha256=%s',(p['sha256'],)).fetchone()
 c.execute('DELETE FROM sa_media.objects WHERE sha256=%s',(p['sha256'],))
 assert snapshot(c)==p['before'],'Existing media or Storage changed'
 return {'owned_ready_references':2 if removed else 0,'owned_missing_references':1 if removed else 0,'owned_storage_objects':object_count,'existing_media_preserved':True,'storage_removed':True}
