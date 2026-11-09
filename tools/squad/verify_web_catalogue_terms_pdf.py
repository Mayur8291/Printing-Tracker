"""Verify the actual catalogue PDF and its byte-exact embedded terms file."""
import hashlib,json,sys
from decimal import Decimal,ROUND_HALF_UP
from pathlib import Path
from pypdf import PdfReader

def verify(value):
    receipt=value['receipt'];snapshot=value['snapshot'];file=value['file'];label=value['label']
    data=Path(value['path']).read_bytes()
    assert data.startswith(b'%PDF-') and len(data)==receipt['bytes']
    assert hashlib.sha256(data).hexdigest()==receipt['sha256']
    assert snapshot['kind']==receipt['kind']=='catalogue' and snapshot['document_id']==receipt['document_id']
    rows=snapshot['rows'];assert len(rows)==1 and rows[0]['class_id']==str(value['class_id'])
    row=rows[0];assert row['name']==label+' RMP class'
    assert row['display_price']==str((Decimal(row['unit_price'])*Decimal('1.125')).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
    terms=Path(file['path']).read_bytes();assert len(terms)==file['bytes'] and hashlib.sha256(terms).hexdigest()==file['sha256']
    asset=snapshot['terms_attachment'];assert (asset['bucket'],asset['path'],asset['bytes'],asset['content_type'])==('canto-media',file['canonical'],file['bytes'],'text/plain')
    assert asset['path']==f"sha256/{file['sha256'][:2]}/{file['sha256']}",'Snapshot must bind the exact content-addressed file'
    reader=PdfReader(value['path']);assert len(reader.pages)==receipt['pages'] and 0<len(reader.pages)<=5
    attachments=dict(reader.attachments);assert set(attachments)=={'terms.txt'}
    assert list(attachments['terms.txt'])==[terms],'Embedded original terms differ from uploaded bytes'
    text=' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())
    for expected in ['Product catalogue',label+' catalogue',row['name'],row['brand'],row['category'],row['display_price'],'Attached terms','terms.txt']:
        assert expected in text,'Expected captured catalogue content missing: '+expected
    assert '\ufffd' not in text
    return {'pages':len(reader.pages),'fixture_class_only':True,'captured_price_verified':True,'embedded_terms_sha256':file['sha256'],'embedded_terms_bytes':len(terms),'content_verified':True,'visual_review_required':True}

if __name__=='__main__':print(json.dumps(verify(json.load(sys.stdin))))
