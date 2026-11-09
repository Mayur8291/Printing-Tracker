"""Actual local PDF parsing verifies embedded bytes and captured catalogue data."""
import copy,hashlib,tempfile,unittest
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import NameObject,DictionaryObject,DecodedStreamObject
from verify_web_catalogue_terms_pdf import verify

class CataloguePdf(unittest.TestCase):
 def fixture(self,root,terms=b'Synthetic original terms',embedded=None):
  text='Product catalogue SQB abc catalogue SQB abc RMP class Fixture brand Fixture category 90.00 Attached terms terms.txt'
  writer=PdfWriter();page=writer.add_blank_page(595,842)
  font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
  page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
  stream=DecodedStreamObject();stream.set_data(('BT /F1 10 Tf 10 800 Td ('+text+') Tj ET').encode());page[NameObject('/Contents')]=writer._add_object(stream)
  writer.add_attachment('terms.txt',terms if embedded is None else embedded)
  pdf=root/'catalogue.pdf';writer.write(pdf);data=pdf.read_bytes();path=root/'terms.txt';path.write_bytes(terms);digest=hashlib.sha256(terms).hexdigest();canonical='sha256/'+digest[:2]+'/'+digest
  return {'path':str(pdf),'class_id':'77','label':'SQB abc','file':{'path':str(path),'bytes':len(terms),'sha256':digest,'canonical':canonical},'receipt':{'kind':'catalogue','document_id':'doc','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'pages':1},'snapshot':{'kind':'catalogue','document_id':'doc','rows':[{'class_id':'77','name':'SQB abc RMP class','brand':'Fixture brand','category':'Fixture category','unit_price':'80','display_price':'90.00'}],'terms_attachment':{'bucket':'canto-media','path':canonical,'bytes':len(terms),'content_type':'text/plain'}}}
 def test_pdf_content_and_exact_embedded_original(self):
  with tempfile.TemporaryDirectory() as directory:self.assertTrue(verify(self.fixture(Path(directory)))['content_verified'])
 def test_changed_embedded_file_rejected(self):
  with tempfile.TemporaryDirectory() as directory,self.assertRaises(AssertionError):verify(self.fixture(Path(directory),embedded=b'Other terms'))
 def test_foreign_class_or_wrong_price_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   value=self.fixture(Path(directory))
   for key,bad in [('class_id','78'),('display_price','80.00')]:
    other=copy.deepcopy(value);other['snapshot']['rows'][0][key]=bad
    with self.assertRaises(AssertionError):verify(other)
 def test_wrong_snapshot_bucket_or_content_address_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   value=self.fixture(Path(directory))
   for key,bad in [('bucket','squad-uploads'),('path','sha256/00/'+'0'*64),('bytes',999),('content_type','text/html')]:
    other=copy.deepcopy(value);other['snapshot']['terms_attachment'][key]=bad
    with self.assertRaises(AssertionError):verify(other)
 def test_modified_pdf_bytes_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   value=self.fixture(Path(directory));p=Path(value['path']);p.write_bytes(p.read_bytes()+b'changed')
   with self.assertRaises(AssertionError):verify(value)
if __name__=='__main__':unittest.main(verbosity=2)
