"""Original non-preview formats stay scoped to the owned branding attachment."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from test_catalogue import seed_catalogue
import test_media_uploads as media_tests

EXTENSIONS='doc docx xlxs xlsx xls xlsm xlsb xltx xltm xlt xlam xla xll xlw pptx pptm potx potm ppam ppa ppsx ppsm sldx sldm psd ai eps tiff tif bmp indd zip rar 7z csv ppt aiff wma ogg flac cdr raw'.split()
class BrandingAttachmentFormats(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.f=media_tests.Uploads();self.f.setUp();self.c=self.f.c
  self.target=dict(self.f.target,field='attachment');self.version=self.f.media(self.target)['version']
 def tearDown(self):self.f.tearDown()
 def reserve(self,name='reference.psd',size=10,target=None):
  return self.f.reserve(target or self.target,self.version,{'filename':name,'bytes':str(size),'content_type':'application/octet-stream'})
 def test_source_formats_accept_uppercase_and_preserve_bytes(self):
  for extension in EXTENSIONS:
   with self.subTest(extension=extension),self.c.transaction():
    value=self.reserve('reference.'+extension.upper());self.assertEqual(value['content_type'],'application/octet-stream');self.assertEqual(value['bytes'],'10')
    raise psycopg.Rollback()
 def test_active_content_unknown_and_disguised_extensions_rejected(self):
  for name in ['file.html','file.js','file.exe','file.svg','file.png','file.pdf','file.zip.exe','file.psd ','file','../file.psd']:
   with self.subTest(name=name),self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.reserve(name)
 def test_size_cap_is_enforced(self):
  self.assertEqual(self.reserve(size=26214400)['bytes'],'26214400')
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.reserve(size=26214401)
 def test_image_and_other_resource_fields_are_not_widened(self):
  for target in [self.f.target,{'resource':'users','record_id':'103','field':'profile_image'}]:
   with self.subTest(target=target),self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.reserve(target=target)
 def test_foreign_owner_remains_denied(self):
  self.f.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.reserve()
 def test_same_verified_attachment_lifecycle_keeps_opaque_type(self):
  upload=self.reserve();self.f.verify(upload,mime='application/octet-stream');result=self.f.attach(upload,self.version)
  media=self.f.media(self.target);self.assertEqual(media['status'],'ready');self.assertEqual(media['content_type'],'application/octet-stream');self.assertEqual(result['resource'],'brandings')

if __name__=='__main__':unittest.main()
