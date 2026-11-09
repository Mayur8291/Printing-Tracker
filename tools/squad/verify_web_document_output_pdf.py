"""Read-only content verification for exact-owned browser-created documents.
Root supplies the trusted captured snapshot and independent owned item IDs.
Poppler rendering and human/agent visual review remain separate requirements.
"""
import hashlib,json,re,sys
from decimal import Decimal
from pathlib import Path
from pypdf import PdfReader


def verify(path,snapshot,receipt,owned_item_ids):
    owned={str(i) for i in owned_item_ids};assert owned and len(owned)<=100
    data=Path(path).read_bytes();assert data.startswith(b'%PDF-') and len(data)==receipt['bytes']
    assert hashlib.sha256(data).hexdigest()==receipt['sha256']
    reader=PdfReader(path);assert len(reader.pages)==receipt['pages'] and 0<len(reader.pages)<=10
    text=' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())
    assert '\ufffd' not in text,'PDF contains replacement glyphs'
    assert snapshot['document_id']==receipt['document_id'] and snapshot['kind']==receipt['kind']
    rows=snapshot['rows'];assert 0<len(rows)<=100,'Expected bounded, nonempty owned output'
    if snapshot['kind']=='delivery_challan':
        assert str(snapshot['item_id']) in owned
        assert snapshot['quantity_basis']=='selected_dispatch_only'
        assert snapshot['destination_basis']=='dispatch_snapshot'
        assert snapshot['destination']['mode']=='customer'
        assert 0<snapshot['quantity']<snapshot['order_quantity'],'Fixture must exercise a partial dispatch'
        assert sum(row['quantity'] for row in rows)==snapshot['quantity']
        assert sum(Decimal(snapshot[k]) for k in ['subtotal','cgst','sgst','igst'])==Decimal(snapshot['total'])
        expected=['Delivery challan','Selected dispatch quantities',f"Quantity in this dispatch: {snapshot['quantity']}",'Mode: customer','This challan is not a tax invoice']
        amount_label='TOTAL';amount=snapshot['total']
    else:
        assert snapshot['kind']=='tailor_weekly'
        assert snapshot['period']['timezone']=='Asia/Kolkata'
        assert all(str(row['item_id']) in owned for row in rows)
        assert snapshot['summary']['needs_reconciliation'] is False
        assert sum(row['completed'] for row in rows)==snapshot['summary']['completed']>0
        assert sum(row['pending'] for row in rows)==snapshot['summary']['pending']==0
        assert sum(Decimal(row['amount']) for row in rows)==Decimal(snapshot['summary']['amount'])
        expected=['Weekly work and payment report','Basis: assignment week',f"Completed: {snapshot['summary']['completed']}",'Pending: 0',snapshot['period']['week_start'],snapshot['period']['week_end']]
        amount_label='Amount';amount=snapshot['summary']['amount']
    for phrase in expected:assert phrase.lower() in text.lower(),'Missing expected PDF content: '+phrase
    # Renderer preserves decimal strings, including intentional trailing zeros.
    assert re.search(re.escape(amount_label)+r':\s+INR\s+'+re.escape(str(amount))+r'\b',text),'Captured total not rendered exactly'
    return {'kind':snapshot['kind'],'pages':len(reader.pages),'content_verified':True,'text_characters':len(text),'fixture_items_only':True,'layout_review_required':True}

if __name__=='__main__':
    values=json.load(sys.stdin)
    print(json.dumps([verify(v['path'],v['snapshot'],v['receipt'],v['owned_item_ids']) for v in values]))
