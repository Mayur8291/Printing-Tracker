"""Read-only PDF content checks. Run with the bundled Python containing pypdf."""
import hashlib
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader


def verify(path, snapshot, receipt):
    data=Path(path).read_bytes()
    assert len(data)==receipt['bytes'] and hashlib.sha256(data).hexdigest()==receipt['sha256']
    reader=PdfReader(path);assert len(reader.pages)==receipt['pages'] and 0<len(reader.pages)<=10
    text=' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())
    assert '\ufffd' not in text, 'PDF contains replacement glyphs'
    if snapshot['kind']=='delivery_challan':
        assert snapshot['quantity']==1 and snapshot['order_quantity']==4
        assert snapshot['quantity_basis']=='selected_dispatch_only'
        assert snapshot['destination_basis']=='dispatch_snapshot' and snapshot['destination']['mode']=='customer'
        assert sum(row['quantity'] for row in snapshot['rows'])==1
        for phrase in ['Delivery challan','Selected dispatch quantities','Quantity in this dispatch: 1','Mode: customer','This challan is not a tax invoice']:
            assert phrase.lower() in text.lower(), 'Missing challan content: '+phrase
        assert re.search(r'TOTAL:\s+INR\s+525(?:\.00)?\b',text), 'Selected-dispatch total must be INR 525'
        assert float(snapshot['total'])==525
    else:
        assert snapshot['kind']=='tailor_weekly' and snapshot['period']['timezone']=='Asia/Kolkata'
        assert snapshot['summary']['completed']==3 and snapshot['summary']['pending']==0
        assert float(snapshot['summary']['amount'])==105 and snapshot['summary']['needs_reconciliation'] is False
        assert len(snapshot['rows'])==2 and sum(row['completed'] for row in snapshot['rows'])==3
        for phrase in ['Weekly work and payment report','Basis: assignment week','Completed: 3','Pending: 0',snapshot['period']['week_start'],snapshot['period']['week_end']]:
            assert phrase in text, 'Missing weekly content: '+phrase
        assert re.search(r'Amount:\s+INR\s+105(?:\.00)?\b',text), 'Weekly payment total must be INR 105'
    return {'kind':snapshot['kind'],'pages':len(reader.pages),'content_verified':True,'text_characters':len(text)}

if __name__=='__main__':
    config=json.load(sys.stdin)
    print(json.dumps([verify(item['path'],item['snapshot'],item['receipt']) for item in config]))
