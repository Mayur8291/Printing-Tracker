"""Exact single catalogue and immutable terms cleanup, never a broad media sweep."""
import hashlib
import json
import re
import uuid
import urllib.request
from pathlib import Path

import test_hosted_business_journeys as business
from release_mirror import row_digest
from web_media_recovery import snapshot as media_snapshot


def content(run_id):
    return ('Synthetic Squad catalogue terms.\nRun '+str(uuid.UUID(run_id))+'\nNo real customer conditions.\n').encode()


def expected_file(state):
    data=content(state['run_id']);digest=hashlib.sha256(data).hexdigest()
    filename='catalogue-terms-'+state['run_id']+'.txt'
    return {'path':str(Path(state['journal']).parent/filename),'filename':filename,'sha256':digest,
            'bytes':len(data),'content_type':'text/plain','canonical':'sha256/'+digest[:2]+'/'+digest}


def plan(c,state):
    actor=next(a for a in state['identity']['actors'] if a['role']==3);file=expected_file(state)
    assert not c.execute('SELECT 1 FROM sa_media.objects WHERE sha256=%s',(file['sha256'],)).fetchone()
    assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='canto-media' AND name=%s",(file['canonical'],)).fetchone()
    state['web_catalogue_terms']={'format':'squad-catalogue-terms/v1','actor_id':actor['auth_id'],'file':file,
       'before':media_snapshot(c),'attachments_before':row_digest(c,'sa_domain','document_attachments'),
       'storage_receipts':[],'storage_deleted':False}


def validate(state):
    business.validate(state);proof=state['web_catalogue_terms']
    actor=next(a for a in state['identity']['actors'] if a['role']==3)
    assert proof['format']=='squad-catalogue-terms/v1' and proof['actor_id']==actor['auth_id']
    assert proof['file']==expected_file(state) and state.get('web_output_rehearsal') is not True
    return proof


def write_file(state):
    file=validate(state)['file'];path=Path(file['path'])
    with open(path,'wb') as stream:
        import os
        os.chmod(path,0o600);stream.write(content(state['run_id']));stream.flush();os.fsync(stream.fileno())


def keys(state,entries):
    result=set()
    for entry in entries:
        if entry.get('kind')!='command':continue
        value=entry['value'];label=value['label'];key=uuid.UUID(value['key'])
        assert key==uuid.uuid5(uuid.UUID(state['run_id']),label),'Browser key changed'
        match=re.fullmatch(r'web\.role3\.([0-9]{1,3})',label)
        if match:
            assert int(match[1])<256;result.add(key)
    return result


def owned_documents(c,state,entries,allow_removed=False):
    proof=validate(state);command_keys=keys(state,entries)
    rows=c.execute("""SELECT a.changes->>'document_id',a.command_key,a.entity_id,a.xmin::text
     FROM sa_domain.audit a WHERE a.actor_id=%s AND a.generation=%s
      AND a.operation='document.requested' AND a.kind='document' AND a.id>%s""",
      (proof['actor_id'],state['identity']['generation'],state['audit_start'])).fetchall()
    assert len(rows)<=1 and all(r[1] in command_keys for r in rows),'Unowned catalogue document request'
    docs=[]
    for id,key,sequence,xid in rows:
        d=c.execute('SELECT to_jsonb(d),xmin::text FROM sa_domain.documents d WHERE id=%s',(id,)).fetchone()
        if d is None:
            assert allow_removed,'Owned document disappeared';docs.append({'id':id,'request_xmin':xid,'missing':True});continue
        value,_=d
        assert value['kind']=='catalogue' and value['actor_id']==proof['actor_id'] and value['role_id']==3
        assert value['generation']==state['identity']['generation'] and value['request']['delivery']=='download' and value['delivery_state']=='not_requested'
        assert value['sequence_id']==sequence
        job=c.execute("SELECT command_key,actor_id,generation,event_type,aggregate_kind,aggregate_id,payload FROM sa_domain.outbox WHERE id=%s",(value['job_id'],)).fetchone()
        assert job==(key,uuid.UUID(proof['actor_id']),value['generation'],'document.requested','document',sequence,{'document_id':id})
        value['request_xmin']=xid;docs.append(value)
    return docs


def bindings(c,state,entries,allow_removed=False):
    proof=validate(state);file=proof['file'];command_keys=keys(state,entries)
    rows=c.execute('SELECT to_jsonb(u),xmin::text FROM sa_domain.media_uploads u WHERE actor_id=%s',(proof['actor_id'],)).fetchall()
    assert len(rows)<=1,'Unexpected terms uploads'
    docs=owned_documents(c,state,entries,allow_removed)
    if not rows:
        assert not docs and not c.execute('SELECT 1 FROM sa_domain.document_attachments WHERE actor_id=%s',(proof['actor_id'],)).fetchone()
        return None,docs
    u,uxid=rows[0]
    assert (u['resource'],u['field'],u['filename'],u['bytes'],u['content_type'],u['generation'])==('document_attachments','terms',file['filename'],file['bytes'],file['content_type'],state['identity']['generation'])
    assert u['sha256'] in (None,file['sha256'])
    reserve=c.execute("SELECT key,result,xmin::text FROM sa_domain.commands WHERE actor_id=%s AND operation='document.attachment_reserved' AND generation=%s AND result->>'upload_id'=%s",(proof['actor_id'],u['generation'],u['id'])).fetchall()
    assert len(reserve)==1 and reserve[0][0] in command_keys,'Unowned attachment reservation'
    result=reserve[0][1]
    assert (result['path'],result['bucket'],result['filename'],result['bytes'],result['content_type'],result['expected_version'])==('pending/'+u['id'],'squad-uploads',file['filename'],str(file['bytes']),file['content_type'],str(u['generation'])+':'+str(u['record_id']))
    attachments=c.execute('SELECT to_jsonb(a),xmin::text FROM sa_domain.document_attachments a WHERE actor_id=%s',(proof['actor_id'],)).fetchall()
    assert len(attachments)==1
    a,axid=attachments[0]
    assert (a['id'],a['generation'],a['purpose'])==(u['record_id'],u['generation'],'catalogue_terms')
    proofs={reserve[0][2]}
    finalize=[]
    if u['state']=='attached':
        finalize=c.execute("""SELECT a.xmin::text,c.result=u.result FROM sa_domain.audit a
         JOIN sa_domain.commands c ON c.actor_id=a.actor_id AND c.key=a.command_key AND c.operation=a.operation AND c.generation=a.generation
         JOIN sa_domain.media_uploads u ON u.id=(a.changes->>'upload_id')::uuid AND u.actor_id=a.actor_id
         WHERE a.actor_id=%s AND a.operation='document.attachment_attached' AND a.generation=%s
          AND a.entity_id=%s AND a.kind='media' AND a.command_key=ANY(%s::uuid[])
          AND a.changes=jsonb_build_object('upload_id',u.id,'purpose','catalogue_terms','resource','document_attachments')""",
          (proof['actor_id'],u['generation'],a['id'],list(command_keys))).fetchall()
        assert finalize==[(uxid,True)],'Upload changed outside immutable finalization'
        assert a['state']=='ready' and a['sha256']==file['sha256']
        assert u['result']=={'resource':'document_attachments','record_id':str(a['id']),'field':'terms','pointer':'','status':'ready'}
        proofs.add(uxid)
    else:
        assert c.execute("SELECT expires_at+interval '2 hours 10 minutes'<clock_timestamp() FROM sa_domain.media_uploads WHERE id=%s",(u['id'],)).fetchone()==(True,),'Unfinished terms upload may still run or hold a signed PUT; preserve checkpoint through expiry plus2h10m'
    for doc in docs:
        if not doc.get('missing'):
            ref=doc['request'].get('terms_reference',{})
            assert ref.get('resource')=='document_attachments' and ref.get('record_id')==str(a['id']) and ref.get('field')=='terms'
        proofs.add(doc['request_xmin'])
        receipt=c.execute("SELECT attachment_id,attachment_xmin,attachment_row_sha256 FROM sa_domain.document_rehearsal_receipts WHERE document_id=%s",(doc['id'],)).fetchone()
        if receipt:
            exact=c.execute("SELECT %s=xmin::text AND %s=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') FROM sa_domain.document_attachments a WHERE id=%s",(receipt[1],receipt[2],a['id'])).fetchone()
            assert receipt[0]==a['id'] and exact==(True,),'Attachment changed outside worker receipt'
            proofs.add(receipt[1])
    assert axid in proofs,'Attachment changed outside owned commands or capture'
    hashes=[file['sha256']];doc_ids=[d['id'] for d in docs]
    assert not c.execute('SELECT 1 FROM sa_domain.media_uploads WHERE sha256=ANY(%s::text[]) AND id<>%s',(hashes,u['id'])).fetchone(),'Foreign upload shares terms'
    assert not c.execute('SELECT 1 FROM sa_domain.document_attachments WHERE sha256=ANY(%s::text[]) AND id<>%s',(hashes,a['id'])).fetchone(),'Foreign attachment shares terms'
    refs=c.execute("SELECT resource,record_id,field,pointer,source_value,status,sha256,xmin::text FROM sa_media.references WHERE sha256=ANY(%s::text[]) OR(resource='document_attachments' AND record_id=%s)",(hashes,a['id'])).fetchall()
    assert refs==[] or (len(refs)==1 and refs[0]==('document_attachments',a['id'],'terms','','squad:'+file['sha256'],'ready',file['sha256'],uxid) and finalize),'Unowned terms reference'
    assert not c.execute("SELECT 1 FROM sa_admin.media WHERE position(%s IN url)>0",(file['sha256'],)).fetchone(),'Override references terms'
    assert not c.execute("SELECT 1 FROM sa_domain.documents WHERE NOT(id=ANY(%s::uuid[])) AND ((request->'terms_reference'->>'resource'='document_attachments' AND request->'terms_reference'->>'record_id'=%s) OR snapshot->'terms_attachment'->>'path'=%s)",(doc_ids,str(a['id']),file['canonical'])).fetchone(),'Another document references terms'
    obj=c.execute('SELECT object_path,bytes,content_type FROM sa_media.objects WHERE sha256=%s',(file['sha256'],)).fetchone()
    assert obj is None or obj==(file['canonical'],file['bytes'],file['content_type']),'Canonical catalog differs from manifest'
    return {'upload':u,'attachment':a,'file':file},docs


def output_bindings(c,state):
    owned,docs=bindings(c,state,business.journal(state))
    assert owned and len(docs)==1,'Exactly one owned catalogue is required'
    d=docs[0];proof=validate(state)
    assert proof.get('document_id')==d['id'],'Catalogue checkpoint differs from immutable browser request'
    digest=c.execute("SELECT encode(sha256(convert_to(jsonb_build_object('kind',kind,'request',request,'actor_id',actor_id,'generation',generation)::text,'UTF8')),'hex') FROM sa_domain.documents WHERE id=%s",(d['id'],)).fetchone()[0]
    return [{'document_id':d['id'],'job_id':d['job_id'],'actor_id':d['actor_id'],'generation':d['generation'],'kind':'catalogue','role':3,'request_hash':digest,'prefix':f"g{d['generation']}/{d['actor_id']}/{d['id']}/"}]


def storage_rows(c,owned):
    if not owned:return []
    paths=[('squad-uploads','pending/'+owned['upload']['id']),('canto-media',owned['file']['canonical'])]
    return [row[0] for bucket,name in paths for row in c.execute("SELECT to_jsonb(o)-'last_accessed_at' FROM storage.objects o WHERE bucket_id=%s AND name=%s",(bucket,name)).fetchall()]


def cleanup_storage(c,state,entries,service_key,save,url):
    assert url==business.identities.URL=='https://scvojtvgnkmbupvyslmb.supabase.co'
    proof=validate(state)
    with c.transaction():
        assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
        assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['identity']['generation']
        allowed=c.execute('SELECT test_actor_ids FROM sa_domain.runtime_state').fetchone()[0]
        assert set(allowed) in (set(),{uuid.UUID(a['auth_id']) for a in state['identity']['actors']})
        c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
    owned,_=bindings(c,state,entries);current=storage_rows(c,owned);file=proof['file']
    allowed={(r['bucket_id'],r['name']) for r in current}
    if owned:allowed|={('squad-uploads','pending/'+owned['upload']['id']),('canto-media',file['canonical'])}
    receipts={(r['object']['bucket_id'],r['object']['name']):r for r in proof['storage_receipts']}
    assert len(receipts)==len(proof['storage_receipts'])<=2 and set(receipts)<=allowed
    for receipt in receipts.values():
        assert str(uuid.UUID(receipt['object']['id']))==receipt['object']['id']
        assert receipt['bytes']==file['bytes'] and receipt['sha256']==file['sha256']
    for obj in current:
        key=(obj['bucket_id'],obj['name'])
        if key in receipts:assert receipts[key]['object']==obj,'Terms Storage changed'
        request=urllib.request.Request(url+'/storage/v1/object/authenticated/'+'/'.join(key),headers={'apikey':service_key,'Authorization':'Bearer '+service_key})
        with urllib.request.urlopen(request,timeout=30) as response:data=response.read(file['bytes']+1)
        assert len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256']
        receipts[key]={'object':obj,'bytes':file['bytes'],'sha256':file['sha256']}
    proof['storage_receipts']=list(receipts.values());save(state)
    for obj in current:
        owned,_=bindings(c,state,entries)
        latest=storage_rows(c,owned)
        assert all(receipts[(r['bucket_id'],r['name'])]['object']==r for r in latest),'Terms Storage changed before deletion'
        assert obj in latest
        request=urllib.request.Request(url+'/storage/v1/object/'+obj['bucket_id'],method='DELETE',data=json.dumps({'prefixes':[obj['name']]}).encode(),headers={'apikey':service_key,'Authorization':'Bearer '+service_key,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=30) as response:assert response.status==200
    assert not storage_rows(c,owned),'Terms Storage remains'
    proof['storage_deleted']=True;save(state)


def cleanup_database(c,state,entries):
    proof=validate(state);owned,docs=bindings(c,state,entries,allow_removed=True)
    assert proof['storage_deleted'] and not storage_rows(c,owned)
    assert all(d.get('missing') for d in docs),'Document cleanup must precede attachment cleanup'
    if owned:
        id=owned['attachment']['id']
        c.execute("DELETE FROM sa_media.references WHERE resource='document_attachments' AND record_id=%s AND field='terms' AND pointer=''",(id,))
        c.execute('DELETE FROM sa_domain.document_attachments WHERE id=%s',(id,))
        c.execute('DELETE FROM sa_media.objects WHERE sha256=%s',(proof['file']['sha256'],))
    assert media_snapshot(c)==proof['before'],'Existing media or Storage changed'
    assert row_digest(c,'sa_domain','document_attachments')==proof['attachments_before'],'Other attachments changed'
    return {'owned_terms_uploads':1 if owned else 0,'owned_catalogues':len(docs),'existing_media_preserved':True,'storage_removed':True,'upload_history_and_audits_retained':True}
