"""Separate, fixed-scope catalogue media rehearsal proof. Never used by profile recovery.

Only a new owned product/reference PNG and optional new unlinked branding/.cdr
are allowed. Source roots come from immutable server audits, not browser IDs.
The integrator must run Storage cleanup before the ordinary business cleanup
callback and retain checkpoints on every refusal.
"""
import copy
import datetime
import hashlib
import json
import uuid
from pathlib import Path
from psycopg.types.json import Jsonb
from psycopg import sql
import urllib.request
from web_media_recovery import png, snapshot, storage_rows

FORMAT='squad-web-catalogue-media/v1'
SCHEMA='sa_snapshot_20261019'

def bytes_for(run_id, kind):
    if kind=='product_png':return png(run_id, 0)
    assert kind=='branding_opaque'
    return ('Squad inert download-only branding acceptance\n'+str(uuid.UUID(run_id))+'\n').encode('ascii')

def manifest(run_id, private, opaque):
    rows=[]
    for kind,ext,mime in [('product_png','png','image/png')]+([('branding_opaque','cdr','application/octet-stream')] if opaque else []):
        data=bytes_for(run_id,kind);digest=hashlib.sha256(data).hexdigest();filename=f'catalogue-media-{run_id}-{kind}.{ext}'
        rows.append({'kind':kind,'filename':filename,'path':str(Path(private)/filename),'sha256':digest,'bytes':len(data),'content_type':mime,'canonical':f'sha256/{digest[:2]}/{digest}'})
    return rows

def plan(c,state,private,opaque=False):
    actor=next(a for a in state['identity']['actors'] if a['role']==3)
    files=manifest(state['run_id'],private,opaque)
    for item in files:
        assert not c.execute('SELECT 1 FROM sa_media.objects WHERE sha256=%s',(item['sha256'],)).fetchone()
        assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='canto-media' AND name=%s",(item['canonical'],)).fetchone()
    state['web_catalogue_media']={'format':FORMAT,'actor_id':actor['auth_id'],'legacy_id':str(actor['id']),'opaque':opaque,'files':files,
        'configuration':copy.deepcopy(state['fixture']['customConfig']),'branding_spec':{'type':'print','side':'front','width':'3','height':'2','unit':'inch','comment':state['label']} if opaque else None,'before':snapshot(c),'storage_receipts':[],'storage_deleted':False}
    validate(state)

def validate(state):
    p=state['web_catalogue_media'];actor=next(a for a in state['identity']['actors'] if a['role']==3)
    assert p['format']==FORMAT and p['actor_id']==actor['auth_id'] and p['legacy_id']==str(actor['id'])
    assert type(p['opaque']) is bool
    assert p['files']==manifest(state['run_id'],Path(state['journal']).parent,p['opaque'])
    assert p['configuration']==state['fixture']['customConfig']
    assert p['branding_spec']==({'type':'print','side':'front','width':'3','height':'2','unit':'inch','comment':state['label']} if p['opaque'] else None)
    return p

def write_files(state):
    for item in validate(state)['files']:
        path=Path(item['path']);path.write_bytes(bytes_for(state['run_id'],item['kind']));path.chmod(0o600)

def journal_keys(state,entries):
    keys=set()
    for entry in entries:
        if entry.get('kind')=='command':
            value=entry['value'];key=uuid.UUID(value['key'])
            assert key==uuid.uuid5(uuid.UUID(state['run_id']),value['label'])
            keys.add(key)
    return keys

def roots(c,state,entries):
    p=validate(state);keys=journal_keys(state,entries);generation=state['identity']['generation'];actor=uuid.UUID(p['actor_id'])
    audits=c.execute('SELECT operation,kind,entity_id,changes,command_key,xmin::text FROM sa_domain.audit WHERE actor_id=%s AND generation=%s AND id>%s ORDER BY id',(actor,generation,state['audit_start'])).fetchall()
    assert all(row[4] in keys for row in audits),'Unjournaled catalogue media command'
    allowed={'preset.configured','design.saved','media.reserved','media.attached','media.detached','product_image.comment_saved'}
    assert all(row[0] in allowed for row in audits),'Unreviewed command in catalogue-only rehearsal'
    created={};owned_xids={row[5] for row in audits}
    for operation,kind,entity,changes,key,xid in audits:
        if operation not in ('preset.configured','design.saved'):continue
        label='product' if operation=='preset.configured' else 'branding'
        assert label not in created,'Only one new product and one new branding are allowed'
        assert kind==label and (label!='branding' or p['opaque'])
        result=c.execute('SELECT result FROM sa_domain.commands WHERE actor_id=%s AND generation=%s AND key=%s AND operation=%s',(actor,generation,key,operation)).fetchall()
        assert len(result)==1 and result[0][0]['id']==str(entity),'Creation receipt does not match audit'
        result=result[0][0]
        payload={'configuration':p['configuration'],'name':state['label']+' media preset','comment':''} if label=='product' else {'id':None,'product_id':None,'spec':p['branding_spec'],'version':None}
        assert c.execute("SELECT payload_hash=sha256(convert_to(%s::jsonb::text,'UTF8')) FROM sa_domain.commands WHERE actor_id=%s AND key=%s",(Jsonb(payload),actor,key)).fetchone()==(True,),'Root request differs from preplanned payload'
        if label=='product':
            assert result.get('reused') is False and changes.get('reused') is False,'Preexisting/reused product refused'
            row=c.execute('SELECT created_by_id,product_type,created_at,xmin::text,sa_domain.product_configuration(id)=sa_domain.normalize_configuration(%s),encode(sha256(convert_to(sa_domain.product_configuration(id)::text,\'UTF8\')),\'hex\') FROM sa_snapshot_20261019.sa_products WHERE id=%s',(Jsonb(p['configuration']),entity)).fetchone()
            assert row and str(row[0])==p['legacy_id'] and row[1]==0 and row[4] is True and row[5]==result['fingerprint'],'Product scope/configuration differs'
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_items WHERE product_id=%s',(entity,)).fetchone(),'Product has order usage'
            owners=c.execute('SELECT actor_id,generation,fingerprint FROM sa_domain.preset_index WHERE product_id=%s',(entity,)).fetchall()
            assert owners==[(actor,generation,result['fingerprint'])],'Product fingerprint ownership differs'
            at,current_xid=row[2:4]
        else:
            assert changes.get('product_id') is None and result.get('product_id') is None,'Only unlinked branding allowed'
            row=c.execute('SELECT item_id,product_id,parent_id,created_at,xmin::text FROM sa_snapshot_20261019.sa_brandings WHERE id=%s',(entity,)).fetchone()
            assert row and row[:3]==(None,None,None),'Branding linked to source business graph'
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_brandings WHERE parent_id=%s',(entity,)).fetchone(),'Branding inherited by another design'
            assert not c.execute('SELECT 1 FROM sa_domain.archived_designs WHERE branding_id=%s',(entity,)).fetchone(),'Branding archived elsewhere'
            owners=c.execute('SELECT actor_id,generation,xmin::text FROM sa_domain.design_owners WHERE branding_id=%s',(entity,)).fetchall()
            assert owners==[(actor,generation,xid)],'Branding creation ownership differs'
            at,current_xid=row[3:5]
        table='sa_products' if label=='product' else 'sa_brandings'
        assert int(entity)>(state['source_before'][table]['max_id'] or 0) and at is not None
        assert at.replace(tzinfo=datetime.timezone.utc)>=datetime.datetime.fromisoformat(state['created_at']) and current_xid in owned_xids,'Source root is preexisting or independently modified'
        created[label]=int(entity)
    return created,keys,owned_xids,audits

def bindings(c,state,entries):
    p=validate(state);created,keys,xids,audits=roots(c,state,entries);actor=uuid.UUID(p['actor_id']);generation=state['identity']['generation']
    rows=c.execute('SELECT to_jsonb(u) FROM sa_domain.media_uploads u WHERE actor_id=%s ORDER BY created_at,id',(actor,)).fetchall()
    assert len(rows)<=len(p['files']),'Extra catalogue upload reservation'
    files={item['filename']:item for item in p['files']};seen=set();owned=[];concrete={}
    for (upload,) in rows:
        item=files.get(upload['filename']);assert item and upload['filename'] not in seen,'Unknown or repeated upload filename';seen.add(upload['filename'])
        target=('products',created.get('product'),'images') if item['kind']=='product_png' else ('brandings',created.get('branding'),'attachment')
        assert target[1] is not None and (upload['resource'],upload['record_id'],upload['field'])==target,'Upload target not exact owned root'
        assert upload['generation']==generation and upload['bytes']==item['bytes'] and upload['content_type']==item['content_type']
        assert upload['sha256'] in (None,item['sha256'])
        receipts=c.execute("SELECT key,result FROM sa_domain.commands WHERE actor_id=%s AND generation=%s AND operation='media.reserved' AND result->>'upload_id'=%s",(actor,generation,upload['id'])).fetchall()
        assert len(receipts)==1 and receipts[0][0] in keys,'Missing owned reserve receipt'
        receipt=receipts[0][1]
        assert receipt['filename']==item['filename'] and receipt['bytes']==str(item['bytes']) and receipt['content_type']==item['content_type'] and receipt['bucket']=='squad-uploads' and receipt['path']=='pending/'+upload['id']
        if upload['state']=='attached':
            attached=c.execute("""SELECT a.xmin::text=u.xmin::text,c.result=u.result,a.changes,u.result FROM sa_domain.audit a
             JOIN sa_domain.commands c ON c.actor_id=a.actor_id AND c.key=a.command_key AND c.operation=a.operation AND c.generation=a.generation
             JOIN sa_domain.media_uploads u ON u.id=(a.changes->>'upload_id')::uuid
             WHERE a.actor_id=%s AND a.generation=%s AND a.operation='media.attached' AND a.changes->>'upload_id'=%s
             AND a.command_key=ANY(%s::uuid[]) AND a.entity_id=u.record_id AND u.actor_id=a.actor_id""",(actor,generation,upload['id'],list(keys))).fetchall()
            assert len(attached)==1 and attached[0][:2]==(True,True),'Attach audit/receipt transaction mismatch'
            changes,result=attached[0][2:]
            assert changes['resource']==target[0] and changes['field']==target[2]
            concrete_target=('product_images',int(result['record_id']),'image') if item['kind']=='product_png' else target
            assert (result['resource'],int(result['record_id']),result['field'])==concrete_target
            if item['kind']=='product_png':
                image=c.execute('SELECT product_id,created_at,xmin::text FROM sa_snapshot_20261019.sa_product_images WHERE id=%s',(concrete_target[1],)).fetchone()
                assert image and image[0]==target[1] and image[2] in xids,'Concrete image does not belong to this new product'
                assert concrete_target[1]>(state['source_before']['sa_product_images']['max_id'] or 0)
                assert image[1].replace(tzinfo=datetime.timezone.utc)>=datetime.datetime.fromisoformat(state['created_at'])
            assert concrete_target not in concrete,'Repeated concrete target'
            concrete[concrete_target]=item['sha256']
        else:
            assert c.execute("SELECT expires_at+interval '2 hours 10 minutes'<clock_timestamp() FROM sa_domain.media_uploads WHERE id=%s",(upload['id'],)).fetchone()==(True,),'Incomplete upload; preserve checkpoint until safe expiry'
        owned.append((upload,item))
    comments=[row for row in audits if row[0]=='product_image.comment_saved']
    assert len(comments)<=2,'Unexpected product image note commands'
    image_targets=[target for target in concrete if target[0]=='product_images']
    for index,(_,kind,entity,changes,key,xid) in enumerate(comments):
        assert len(image_targets)==1 and kind=='product' and entity==created.get('product')
        assert changes['image_id']==str(image_targets[0][1]) and changes['after_comment']==f'{state["label"]} note{index}'
        assert changes['before_comment']==(None if index==0 else f'{state["label"]} note0'),'Image note history changed'
    hashes=[item['sha256'] for item in p['files']];ids=[upload['id'] for upload,_ in owned]
    assert not c.execute('SELECT 1 FROM sa_domain.media_uploads WHERE sha256=ANY(%s::text[]) AND NOT(id=ANY(%s::uuid[]))',(hashes,ids)).fetchone(),'Foreign upload references bytes'
    refs=c.execute('SELECT resource,record_id,field,pointer,sha256,xmin::text FROM sa_media.references WHERE sha256=ANY(%s::text[])',(hashes,)).fetchall()
    assert all(row[:3] in concrete and row[4]==concrete[row[:3]] and row[3]=='' and row[5] in xids for row in refs),'Foreign media reference'
    for target in concrete:
        current=c.execute('SELECT sha256,xmin::text,pointer FROM sa_media.references WHERE resource=%s AND record_id=%s AND field=%s',target).fetchall()
        assert all(digest==concrete[target] and xid in xids and pointer=='' for digest,xid,pointer in current),'Owned field changed independently'
    assert not c.execute("SELECT 1 FROM sa_admin.media WHERE EXISTS(SELECT 1 FROM unnest(%s::text[]) h WHERE position(h IN url)>0)",(hashes,)).fetchone(),'Foreign admin override'
    assert not c.execute('SELECT 1 FROM sa_domain.document_attachments WHERE sha256=ANY(%s::text[])',(hashes,)).fetchone(),'Foreign document attachment'
    for item in p['files']:
        metadata=c.execute('SELECT object_path,bytes,content_type FROM sa_media.objects WHERE sha256=%s',(item['sha256'],)).fetchone()
        assert metadata in (None,(item['canonical'],item['bytes'],item['content_type'])),'Canonical metadata differs'
    history=c.execute('SELECT resource,record_id,field,operation,previous_references,sha256,command_key,xmin::text FROM sa_domain.media_history WHERE actor_id=%s AND generation=%s',(actor,generation)).fetchall()
    assert len(history)<=2*len(p['files']),'Unexpected media history'
    parent_targets={('products',created['product'],'images'):next(f['sha256'] for f in p['files'] if f['kind']=='product_png')} if 'product' in created else {}
    if 'branding' in created:parent_targets[('brandings',created['branding'],'attachment')]=next(f['sha256'] for f in p['files'] if f['kind']=='branding_opaque')
    for resource,rid,field,operation,previous,digest,key,xid in history:
        target=(resource,rid,field);assert key in keys and xid in xids and operation in ('attach','detach')
        if operation=='attach':assert target in parent_targets and digest==parent_targets[target] and previous==[]
        else:
            assert target in concrete and digest is None
            assert len(previous)==1 and previous[0]['sha256']==concrete[target] and previous[0]['resource']==resource and previous[0]['record_id']==rid and previous[0]['field']==field
    assert len([h for h in history if h[3]=='attach'])==len(concrete),'Attach history incomplete'
    # Include embedded text/JSON and every source media field, not only current references.
    fields=c.execute('SELECT sa_domain.media_fields()').fetchone()[0]
    assert len(fields)<=100 and all(len(v)<=30 for v in fields.values())
    for resource,names in fields.items():
        for field in names:
            # Some media DTO fields are virtual override slots with no source column.
            if not c.execute('SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s',(SCHEMA,'sa_'+resource,field)).fetchone():continue
            query=sql.SQL('SELECT id,{}::text FROM {}.{} WHERE EXISTS(SELECT 1 FROM unnest(%s::text[]) h WHERE position(h IN {}::text)>0)').format(sql.Identifier(field),sql.Identifier(SCHEMA),sql.Identifier('sa_'+resource),sql.Identifier(field))
            for rid,value in c.execute(query,(hashes,)):
                target=(resource,rid,field)
                assert target in concrete and value=='squad:'+concrete[target],'Foreign source value references bytes'
    return owned,created,concrete


def cleanup_storage(c,state,entries,service_key,save,url):
    assert url=='https://scvojtvgnkmbupvyslmb.supabase.co'
    p=validate(state)
    with c.transaction():
        assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
        assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['identity']['generation']
        scope=c.execute('SELECT test_actor_ids FROM sa_domain.runtime_state').fetchone()[0]
        assert set(scope) in (set(),{uuid.UUID(a['auth_id']) for a in state['identity']['actors']})
        c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
    owned,_,_=bindings(c,state,entries);current=storage_rows(c,owned)
    allowed={(bucket,name):item for upload,item in owned for bucket,name in [('squad-uploads','pending/'+upload['id']),('canto-media',item['canonical'])]}
    receipts={(r['object']['bucket_id'],r['object']['name']):r for r in p['storage_receipts']}
    assert len(receipts)==len(p['storage_receipts'])<=4 and set(receipts)<=set(allowed)
    for key,receipt in receipts.items():
        assert str(uuid.UUID(receipt['object']['id']))==receipt['object']['id']
        assert receipt['sha256']==allowed[key]['sha256'] and receipt['bytes']==allowed[key]['bytes']
    for obj,item in current:
        key=(obj['bucket_id'],obj['name'])
        if key in receipts:assert receipts[key]['object']==obj,'Storage changed since retained receipt'
        request=urllib.request.Request(url+'/storage/v1/object/authenticated/'+'/'.join(key),headers={'apikey':service_key,'Authorization':'Bearer '+service_key})
        with urllib.request.urlopen(request,timeout=30) as response:data=response.read(item['bytes']+1)
        assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],'Storage bytes differ from manifest'
        receipts[key]={'object':obj,'sha256':item['sha256'],'bytes':item['bytes']}
    p['storage_receipts']=list(receipts.values());save(state)
    for bucket in ('squad-uploads','canto-media'):
        paths=[obj['name'] for obj,_ in current if obj['bucket_id']==bucket]
        if not paths:continue
        latest=storage_rows(c,bindings(c,state,entries)[0])
        assert all(receipts[(obj['bucket_id'],obj['name'])]['object']==obj for obj,_ in latest)
        assert {(obj['bucket_id'],obj['name']) for obj,_ in latest if obj['bucket_id']==bucket}=={(bucket,name) for name in paths}
        request=urllib.request.Request(url+'/storage/v1/object/'+bucket,method='DELETE',data=json.dumps({'prefixes':paths}).encode(),headers={'apikey':service_key,'Authorization':'Bearer '+service_key,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=30) as response:assert response.status==200
    assert not storage_rows(c,owned)
    p['storage_deleted']=True;save(state)


def cleanup_database(c,state,entries):
    p=validate(state);owned,created,concrete=bindings(c,state,entries)
    assert p['storage_deleted'] and not storage_rows(c,owned),'Storage must be proven removed first'
    hashes=[item['sha256'] for item in p['files']]
    for target in concrete:c.execute('DELETE FROM sa_media.references WHERE resource=%s AND record_id=%s AND field=%s',target)
    assert not c.execute('SELECT 1 FROM sa_media.references WHERE sha256=ANY(%s::text[])',(hashes,)).fetchone()
    c.execute('DELETE FROM sa_media.objects WHERE sha256=ANY(%s::text[])',(hashes,))
    # Branding is polymorphic/unlinked and is not discoverable through the source FK graph.
    # This exact root has already been proven above; no other design is deleted.
    if 'branding' in created:
        c.execute('DELETE FROM sa_domain.design_owners WHERE branding_id=%s AND actor_id=%s AND generation=%s',(created['branding'],uuid.UUID(p['actor_id']),state['identity']['generation']))
        c.execute('DELETE FROM sa_snapshot_20261019.sa_brandings WHERE id=%s',(created['branding'],))
    if 'product' in created:
        c.execute('DELETE FROM sa_domain.preset_index WHERE product_id=%s AND actor_id=%s AND generation=%s',(created['product'],uuid.UUID(p['actor_id']),state['identity']['generation']))
    assert snapshot(c)==p['before'],'Existing media/Storage differs from baseline'
    return {'owned_uploads':len(owned),'concrete_targets':len(concrete),'existing_media_preserved':True,'storage_removed':True,'upload_history_and_audits_retained':True,'explicit_branding_root_removed':'branding' in created}
