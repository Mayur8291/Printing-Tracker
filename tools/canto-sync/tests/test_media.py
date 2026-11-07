import unittest,tempfile,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from media_sync import decode_copy,source_url,inventory
class MediaTests(unittest.TestCase):
 def test_copy_unicode_null_and_escapes(self):
  self.assertIsNone(decode_copy(b'\\N'))
  self.assertEqual(decode_copy(b'caf\xc3\xa9\\tfile\\\\name\\040x'), 'café\tfile\\name x')
 def test_matching_origins_and_no_production_fallback(self):
  self.assertEqual(source_url('production','authorized_brands',7,'logo','logo.png',True),'https://leaderboard.sagarfab.com/uploads/authorized_brand/logo/7/logo.png')
  self.assertIsNone(source_url('staging','users',1,'profile_image','https://leaderboard.sagarfab.com/uploads/user/profile_image/1/x.png',True))
  for url in ['http://127.0.0.1/uploads/x','http://169.254.169.254/latest/meta-data','file:///etc/passwd','https://leaderboard.sagarfab.com.evil.test/uploads/x']:
   self.assertIsNone(source_url('production','users',1,'profile_image',url,True))
 def test_unsafe_paths(self):
  for value in ['../x','/uploads/../x','/uploads/%2e%2e/x','/uploads/x\\evil','a\n.png']:
   with self.assertRaises(RuntimeError):source_url('staging','users',1,'profile_image',value,True)
 def test_generated_pdf_links_and_ordinary_application_links(self):
  for value in ['/pdfs/report.pdf','pdfs/report.pdf','http://64.227.186.227/pdfs/report.pdf']:
   self.assertEqual(source_url('staging','products',4,'images',value),'http://64.227.186.227/pdfs/report.pdf')
  self.assertIsNone(source_url('staging','products',4,'images','http://64.227.186.227/orders/4'))
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);(p/'products.copy').write_bytes(b'4\tReport: pdfs/report.pdf\n')
   refs=inventory(p,{'environment':'staging','tables':{'products':{'columns':['id','description']}}})
   self.assertEqual(refs[0]['source_url'],'http://64.227.186.227/pdfs/report.pdf')
   self.assertEqual(refs[0]['pointer'],'#text:8:23')
 def test_inventory_nested_json_and_all_uploader_fields(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);(p/'products.copy').write_bytes(b'4\t["http://64.227.186.227/uploads/a.png",{"url":"https://youtu.be/example"}]\n')
   refs=inventory(p,{'environment':'staging','tables':{'products':{'columns':['id','images']}}})
   self.assertEqual(len(refs),2);self.assertEqual(refs[0]['pointer'],'/0');self.assertEqual(refs[1]['status'],'external')
   self.assertEqual(refs[0]['source_url'],'http://64.227.186.227/uploads/a.png')

class TransferTests(unittest.TestCase):
 def test_changed_same_path_retry_missing_and_no_duplicate_uploads(self):
  import io,unittest.mock as mock
  import media_sync as media
  class Source(io.BytesIO):
   def __init__(self,b):super().__init__(b);self.headers={'Content-Length':str(len(b)),'Content-Type':'application/pdf'}
  class Cursor:
   def __init__(self,c):self.c=c
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def executemany(self,q,rows):
    for sha,path,size,mime in rows:self.c.objects[sha]=(sha,path,size)
  class Conn:
   def __init__(self):self.objects={}
   def execute(self,q):return list(self.objects.values())
   def cursor(self):return Cursor(self)
  class Store:
   blobs={};uploads=0;verifications=0
   def __init__(self,e):pass
   def upload(self,path,file,size,mime):self.blobs[path]=Path(file).read_bytes();Store.uploads+=1
   def verify(self,path,sha,size):
    import hashlib
    Store.verifications+=1
    assert hashlib.sha256(self.blobs[path]).hexdigest()==sha and len(self.blobs[path])==size
   def exists(self,path,size):return path in self.blobs and len(self.blobs[path])==size
  with tempfile.TemporaryDirectory() as folder,mock.patch.object(media,'Storage',Store):
   p=Path(folder);(p/'catalogues.copy').write_bytes(b'1\treport.pdf\n')
   m={'environment':'staging','tables':{'catalogues':{'columns':['id','url']}}};conn=Conn()
   with mock.patch.object(media,'open_source',side_effect=lambda u:Source(b'%PDF-original')):
    first=media.prepare(conn,'staging',p,m);again=media.prepare(conn,'staging',p,m)
   self.assertEqual(Store.uploads,1);self.assertEqual(again['summary']['unchanged'],1)
   (p/'catalogues.copy').write_bytes(b'1\treport.pdf\n2\treport.pdf\n')
   checks=Store.verifications
   with mock.patch.object(media,'open_source',side_effect=lambda u:Source(b'%PDF-original')):
    duplicate=media.prepare(conn,'staging',p,m)
   self.assertEqual(duplicate['summary']['unchanged'],2)
   self.assertEqual(Store.verifications-checks,1) # distinct URLs, one immutable object
   (p/'catalogues.copy').write_bytes(b'1\treport.pdf\n')
   import http.client
   with mock.patch.object(media,'open_source',side_effect=[http.client.IncompleteRead(b'partial',5),Source(b'%PDF-original')]),mock.patch.object(media.time,'sleep'):
    resumed=media.prepare(conn,'staging',p,m)
   self.assertEqual(resumed['summary']['failed'],0)
   with mock.patch.object(media,'open_source',side_effect=lambda u:Source(b'%PDF-changed')):
    changed=media.prepare(conn,'staging',p,m)
   self.assertNotEqual(first['references'][0]['sha256'],changed['references'][0]['sha256'])
   self.assertEqual(len(Store.blobs),2) # prior version retained for rollback
   with mock.patch.object(media,'open_source',return_value=None):missing=media.prepare(conn,'staging',p,m)
   self.assertEqual(missing['summary']['missing'],1);self.assertFalse(missing['summary']['complete'])
   with mock.patch.object(media,'open_source',side_effect=OSError('offline')):
    progress=[]
    with self.assertRaisesRegex(RuntimeError,'previous publication preserved'):media.prepare(conn,'staging',p,m,lambda stage,detail:progress.append(detail))
    self.assertEqual(progress[-1]['media']['failure_samples'],[{'resource':'catalogues','record_id':1,'field':'url','error_type':'OSError'}])
    self.assertNotIn('offline',json.dumps(progress))
   (p/'catalogues.copy').write_bytes(b'')
   empty=media.prepare(conn,'staging',p,m);self.assertEqual(empty['references'],[]);self.assertEqual(len(Store.blobs),2)



class ResumableTests(unittest.TestCase):
 def test_short_read_retries_but_wrong_checksum_is_a_hard_failure(self):
  import io,hashlib,media_sync as m
  store=m.Storage.__new__(m.Storage);store.base='https://example.test/storage/v1'
  store.request=lambda *a,**k:io.BytesIO(b'partial')
  with self.assertRaises(m.TransientMediaError):store.verify('test',hashlib.sha256(b'complete').hexdigest(),8)
  with self.assertRaisesRegex(RuntimeError,'read-back verification failed'):store.verify('test','0'*64,7)
 def test_lost_acknowledgement_resumes_without_duplicate_chunk(self):
  import media_sync as m
  import unittest.mock as mock
  class Response:
   def __init__(self,headers):self.headers=headers
   def __enter__(self):return self
   def __exit__(self,*a):pass
  class TestStorage(m.Storage):
   def __init__(self):self.tus='https://test.storage.supabase.co/storage/v1/upload/resumable';self.received=b'';self.lost=False
   def request(self,url,method='GET',data=None,headers=None):
    if method=='POST':return Response({'Location':self.tus+'/upload-id'})
    if method=='HEAD':return Response({'Upload-Offset':str(len(self.received))})
    assert method=='PATCH' and int(headers['Upload-Offset'])==len(self.received)
    self.received+=data
    if not self.lost:self.lost=True;raise OSError('Lost acknowledgement')
    return Response({'Upload-Offset':str(len(self.received))})
  data=b'x'*(m.CHUNK+17);store=TestStorage()
  with tempfile.NamedTemporaryFile() as f,mock.patch.object(m.time,'sleep'):
   f.write(data);f.flush();store.upload('test',f.name,len(data),'video/mp4')
  self.assertEqual(store.received,data)

if __name__=='__main__':unittest.main()
