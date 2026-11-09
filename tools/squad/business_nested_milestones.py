"""Authorize only single-target children attested by a journaled atomic batch."""
import hashlib,uuid

def owned_nested_milestones(raw_rows,auths,keys):
    owned=set()
    for actor,key,operation,kind,entity,changes,xid in raw_rows:
        if operation!='milestones.created' or actor not in auths or key not in keys:continue
        ids=changes.get('ids');subject=changes.get('subject_id')
        assert kind=='milestone' and isinstance(ids,list) and 1<=len(ids)<=24
        assert all(isinstance(value,str) and value.isdigit() and int(value)>0 for value in ids)
        assert len(set(ids))==len(ids) and str(entity)==ids[0]
        assert isinstance(subject,str) and subject.isdigit() and int(subject)>0
        for ordinal,value in enumerate(ids,1):
            child=uuid.UUID(hashlib.md5((str(key)+':milestone:'+str(ordinal)).encode()).hexdigest())
            matches=[r for r in raw_rows if r[0]==actor and r[1]==child]
            assert len(matches)==1,'Missing or repeated atomic target child'
            row=matches[0]
            assert row[2:5]==('milestone.saved','milestone',int(value)) and row[5].get('subject_id')==subject and row[6]==xid,'Atomic target child does not match parent receipt'
            owned.add((actor,child,'milestone.saved','milestone',int(value)))
    return owned
