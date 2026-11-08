"""Synthetic 1.96 MP PNGs and exact-owned staging catalogue fixture records."""
import hashlib,json,struct,uuid,zlib,urllib.request
def png(seed,index):
 width=height=1400
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 rows=[]
 for y in range(height):
  color=bytes([(seed[0]+index*17+y//100*25)%256,(seed[1]+index*31)%256,(seed[2]+y//200*31)%256])
  rows.append(b'\0'+color*width)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),6))+chunk(b'IEND',b'')
def prepare():
 seed=uuid.uuid4().bytes;files=[]
 for index in range(11):
  content=png(seed,index);sha=hashlib.sha256(content).hexdigest();files.append({'id':9000000000001000+index,'sha256':sha,'path':'sha256/'+sha[:2]+'/'+sha,'bytes':len(content),'filename':'squad-acceptance-'+sha+'.png','content':content})
 return files
def storage(key,path,method,body,content_type='application/json'):
 request=urllib.request.Request('https://scvojtvgnkmbupvyslmb.supabase.co/storage/v1/'+path,data=body,headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':content_type,'x-upsert':'false'},method=method)
 with urllib.request.urlopen(request,timeout=60) as r:assert r.status in(200,201)
def create(c,files,key):
 ids=[f['id'] for f in files]
 assert not c.execute('SELECT FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=ANY(%s)',(ids,)).fetchone()
 assert not c.execute('SELECT FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=ANY(%s)',(ids,)).fetchone()
 template=c.execute("""SELECT s.rmp_size_id,s.rmp_brand_id,s.rmp_category_id,cl.rmp_color_id FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_classes cl ON cl.id=s.rmp_class_id JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id JOIN sa_snapshot_20261019.sa_rmp_sizes z ON z.id=s.rmp_size_id
 WHERE s.is_deleted IS NOT TRUE AND b.is_deleted IS NOT TRUE AND cl.is_deleted IS NOT TRUE AND z.is_deleted IS NOT TRUE AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_category_brands cb JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=cb.rmp_category_id WHERE cb.rmp_brand_id=b.id AND cb.is_deleted IS NOT TRUE AND cat.is_deleted IS NOT TRUE) ORDER BY s.id LIMIT 1""").fetchone();assert template
 with c.transaction():
  for f in files:
   assert not c.execute('SELECT FROM sa_media.objects WHERE sha256=%s',(f['sha256'],)).fetchone()
   c.execute("INSERT INTO sa_snapshot_20261019.sa_rmp_classes(id,name,rmp_color_id,image_1_thumb,created_at,updated_at) VALUES(%s,'Squad document acceptance image',%s,%s,now(),now())",(f['id'],template[3],f['filename']))
   c.execute("INSERT INTO sa_snapshot_20261019.sa_rmp_skus(id,name,rmp_class_id,rmp_size_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(%s,'Squad document acceptance SKU',%s,%s,%s,%s,now(),now())",(f['id'],f['id'],template[0],template[1],template[2]))
   c.execute("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,%s,'image/png')",(f['sha256'],f['path'],f['bytes']))
   c.execute("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('rmp_classes',%s,'image_1_thumb','',%s,'ready',%s)",(f['id'],f['filename'],f['sha256']))
   storage(key,'object/canto-media/'+f['path'],'POST',f['content'],'image/png')
def cleanup(c,files,key):
 ids=[f['id'] for f in files]
 assert not c.execute("SELECT FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=ANY(%s) AND name<>'Squad document acceptance image'",(ids,)).fetchone()
 with c.transaction():
  c.execute("DELETE FROM sa_media.references WHERE resource='rmp_classes' AND record_id=ANY(%s)",(ids,))
  c.execute('DELETE FROM sa_snapshot_20261019.sa_rmp_skus WHERE id=ANY(%s) AND rmp_class_id=ANY(%s)',(ids,ids));c.execute('DELETE FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=ANY(%s)',(ids,))
  for f in files:
   assert not c.execute('SELECT FROM sa_media.references WHERE sha256=%s',(f['sha256'],)).fetchone()
   c.execute('DELETE FROM sa_media.objects WHERE sha256=%s',(f['sha256'],))
 storage(key,'object/canto-media','DELETE',json.dumps({'prefixes':[f['path'] for f in files]}).encode())
