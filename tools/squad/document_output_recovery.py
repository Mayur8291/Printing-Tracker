"""Exact owned output cleanup; no generic worker or source ownership bypass."""
import datetime
import hashlib
import json
import uuid
import urllib.request
from psycopg import sql
from business_cleanup_documents import cleanup_documents

LABELS={'delivery_challan':('workforce.challan',7),'tailor_weekly':('workforce.weekly',4)}


def bindings(c,state):
    """Derive all authority from fixed command keys and immutable server audits."""
    result=[];actors={a['role']:a for a in state['identity']['actors']}
    for kind,(label,role) in LABELS.items():
        key=uuid.uuid5(uuid.UUID(state['run_id']),label);actor=actors[role]
        row=c.execute("""SELECT to_jsonb(d),encode(sha256(convert_to(jsonb_build_object('kind',d.kind,'request',d.request,'actor_id',d.actor_id,'generation',d.generation)::text,'UTF8')),'hex')
          FROM sa_domain.audit a JOIN sa_domain.documents d ON d.id=(a.changes->>'document_id')::uuid
          JOIN sa_domain.outbox j ON j.id=d.job_id
          WHERE a.actor_id=%s AND a.command_key=%s AND a.operation='document.requested' AND a.kind='document'
            AND a.entity_id=d.sequence_id AND j.actor_id=a.actor_id AND j.command_key=a.command_key
            AND j.event_type='document.requested' AND j.aggregate_kind='document' AND j.aggregate_id=d.sequence_id
            AND j.payload=jsonb_build_object('document_id',d.id)""",(actor['auth_id'],key)).fetchall()
        assert len(row)==1,'Exact workforce document audit is unavailable'
        d,digest=row[0]
        assert d['kind']==kind and d['actor_id']==actor['auth_id'] and d['role_id']==role and d['legacy_user_id']==int(actor['id'])
        assert d['generation']==state['identity']['generation'] and d['request']['delivery']=='download' and d['delivery_state']=='not_requested'
        result.append({'document_id':d['id'],'job_id':d['job_id'],'actor_id':d['actor_id'],'generation':d['generation'],'kind':kind,'role':role,'request_hash':digest,
          'prefix':f"g{d['generation']}/{d['actor_id']}/{d['id']}/"})
    return result


def register(c,state):
    docs=bindings(c,state)
    for item in docs:
        assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='squad-documents' AND starts_with(name,%s)",(item['prefix'],)).fetchone(),'Output prefix already exists'
        d=c.execute('SELECT state,snapshot FROM sa_domain.documents WHERE id=%s',(item['document_id'],)).fetchone();assert d==('queued',None)
    # Save before the caller commits this transaction. Crash recovery discovers
    # server state instead of assuming that a successful response was received.
    state['document_outputs']={'format':'squad-document-outputs/v1','documents':docs,'storage_receipts':[],'storage_deleted':False,'registered_at':c.execute('SELECT clock_timestamp()').fetchone()[0].isoformat()}
    for item in docs:
        c.execute("INSERT INTO sa_domain.document_rehearsals(job_id,document_id,actor_id,generation,expires_at) VALUES(%s,%s,%s,%s,least(clock_timestamp()+interval '10 minutes',(SELECT test_write_expires_at FROM sa_domain.runtime_state)))",(item['job_id'],item['document_id'],item['actor_id'],item['generation']))
    return docs


def provenance(c,docs):
    for item in docs:
        row=c.execute("""SELECT d.state,d.xmin::text,a.xmin::text,r.job_id,r.document_id,r.phase,r.lease_token,
          r.document_xmin=d.xmin::text,r.document_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex')
          FROM sa_domain.documents d JOIN sa_domain.outbox j ON j.id=d.job_id
          JOIN sa_domain.audit a ON a.actor_id=j.actor_id AND a.command_key=j.command_key AND a.operation='document.requested'
          LEFT JOIN sa_domain.document_rehearsal_receipts r ON r.job_id=j.id WHERE d.id=%s""",(item['document_id'],)).fetchone()
        assert row is not None
        if row[3] is None:
            # Registration can have rolled back after the local checkpoint was
            # flushed. Only the original untouched command row is recoverable.
            assert row[0]=='queued' and row[1]==row[2], 'Document has no original or worker provenance'
            assert not c.execute('SELECT 1 FROM sa_domain.job_attempts WHERE job_id=%s',(item['job_id'],)).fetchone()
        else:
            assert str(row[3])==item['job_id'] and str(row[4])==item['document_id'] and row[7:]==(True,True),'Document changed outside recorded worker phase'
            if row[6] is None:assert row[5]=='registered'
            else:assert c.execute('SELECT 1 FROM sa_domain.job_attempts WHERE job_id=%s AND lease_token=%s',(item['job_id'],row[6])).fetchone(),'Worker receipt has no attempt'


def validate(c,state):
    proof=state.get('document_outputs')
    if not proof:return []
    assert proof['format']=='squad-document-outputs/v1' and len(proof['documents'])==2
    assert bindings(c,state)==proof['documents'],'Output checkpoint differs from immutable request ownership'
    provenance(c,proof['documents'])
    return proof['documents']


def object_rows(c,docs):
    prefixes=[d['prefix'] for d in docs]
    rows=c.execute("SELECT to_jsonb(o)-'last_accessed_at' FROM storage.objects o WHERE bucket_id='squad-documents' AND EXISTS(SELECT 1 FROM unnest(%s::text[]) p WHERE starts_with(o.name,p)) ORDER BY name",(prefixes,)).fetchall()
    allowed={d['prefix']+'document.pdf' for d in docs}
    assert len(rows)<=2 and all(row[0]['name'] in allowed for row in rows),'Unexpected output or multipart object'
    return [row[0] for row in rows]


def quiesce(c,state):
    """Revoke capabilities first; refuse in-flight execution, even on recovery."""
    docs=validate(c,state)
    if not docs:return
    jobs=[d['job_id'] for d in docs]
    with c.transaction():
        assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
        assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['identity']['generation'],'Source generation changed'
        actors={uuid.UUID(a['auth_id']) for a in state['identity']['actors']}
        current=c.execute('SELECT test_actor_ids FROM sa_domain.runtime_state').fetchone()[0]
        assert set(current) in (set(),actors),'Another rehearsal owns the write scope'
        c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=%s::uuid[],test_write_expires_at=NULL',([],))
        c.execute('DELETE FROM sa_domain.document_rehearsals WHERE job_id=ANY(%s::uuid[])',(jobs,))
    for job in c.execute('SELECT id,status,lease_until FROM sa_domain.outbox WHERE id=ANY(%s::uuid[])',(jobs,)).fetchall():
        if job[1]=='leased':
            # A timed-out HTTP caller does not prove the Edge stopped uploading.
            assert job[2] is not None and job[2]+datetime.timedelta(seconds=60)<datetime.datetime.now(datetime.timezone.utc),'Document worker may still be running; preserve checkpoint and recover after lease plus 60 seconds'
            with c.transaction():
                c.execute("UPDATE sa_domain.job_attempts SET state='failed',finished_at=clock_timestamp(),error_code='REHEARSAL_OUTPUT_ABORT' WHERE job_id=%s AND state='leased'",(job[0],))
                c.execute("UPDATE sa_domain.outbox SET status='dead',lease_until=NULL,last_error_code='REHEARSAL_OUTPUT_ABORT',completed_at=clock_timestamp() WHERE id=%s AND status='leased'",(job[0],))


def cleanup_storage(c,state,service_key,save,url):
    docs=validate(c,state)
    if not docs:return
    quiesce(c,state)
    proof=state['document_outputs'];current=object_rows(c,docs)
    if proof['storage_deleted']:
        assert not current,'Output object reappeared after cleanup'
        return
    old={r['object']['name']:r for r in proof['storage_receipts']}
    assert len(old)==len(proof['storage_receipts'])<=2
    assert set(old)<={d['prefix']+'document.pdf' for d in docs},'Storage receipt path is outside this rehearsal'
    assert all(r['object']['bucket_id']=='squad-documents' and str(uuid.UUID(r['object']['id']))==r['object']['id'] for r in old.values()),'Storage receipt identity is invalid'
    for obj in current:
        name=obj['name']
        if name in old:assert old[name]['object']==obj,'Storage object changed since cleanup checkpoint'
        else:
            # Only exact previously absent immutable UUID paths are eligible.
            req=urllib.request.Request(url+'/storage/v1/object/authenticated/squad-documents/'+name,headers={'apikey':service_key,'Authorization':'Bearer '+service_key})
            with urllib.request.urlopen(req,timeout=60) as response:
                assert response.status==200;data=response.read(67108865)
            assert 10<=len(data)<=67108864 and data.startswith(b'%PDF-')
            old[name]={'object':obj,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    proof['storage_receipts']=list(old.values());save(state)
    for item in docs:
        d=c.execute('SELECT state,bytes,sha256,object_path,snapshot,parts FROM sa_domain.documents WHERE id=%s',(item['document_id'],)).fetchone()
        if d[4] is not None:assert len(d[4]['rows'])<=100 and d[5]==[],'Unexpected multipart fixture'
        if d[0]=='ready':
            receipt=old.get(item['prefix']+'document.pdf');assert receipt and (d[1],d[2],d[3])==(receipt['bytes'],receipt['sha256'],receipt['object']['name']),'Published output differs from stored bytes'
    if current:
        # Capability revocation and settled leases prevent the app from replacing
        # these fresh random paths. Storage deletion never uses a broad prefix.
        assert object_rows(c,docs)==current,'Storage objects changed before deletion'
        body=json.dumps({'prefixes':[row['name'] for row in current]}).encode()
        req=urllib.request.Request(url+'/storage/v1/object/squad-documents',data=body,method='DELETE',headers={'apikey':service_key,'Authorization':'Bearer '+service_key,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=60) as response:assert response.status==200
    assert not object_rows(c,docs),'Output storage deletion is not confirmed'
    proof['storage_deleted']=True;save(state)


def cleanup_callback(c,state,audit_rows,auths,owned_xids):
    docs=validate(c,state)
    if not docs:return {'removed_documents':cleanup_documents(c,state,audit_rows,auths,owned_xids),'executed_job_ids':[]}
    proof=state['document_outputs'];assert proof['storage_deleted'] is True,'Storage cleanup has not been confirmed'
    assert not object_rows(c,docs),'Output Storage objects remain'
    jobs=[d['job_id'] for d in docs];ids=[d['document_id'] for d in docs];processed=0
    assert not c.execute('SELECT 1 FROM sa_domain.document_rehearsals WHERE job_id=ANY(%s::uuid[])',(jobs,)).fetchone(),'Document capability remains active'
    for item in docs:
        d=c.execute('SELECT to_jsonb(d),xmin::text FROM sa_domain.documents d WHERE id=%s FOR UPDATE',(item['document_id'],)).fetchone()
        j=c.execute('SELECT status,attempts,lease_until FROM sa_domain.outbox WHERE id=%s FOR UPDATE',(item['job_id'],)).fetchone()
        attempts=c.execute('SELECT state,finished_at,xmin::text FROM sa_domain.job_attempts WHERE job_id=%s',(item['job_id'],)).fetchall()
        assert j[0] in ('pending','done','dead') and j[2] is None and len(attempts)<=5,'Output job not settled'
        assert all(a[0] in ('done','failed','expired') and a[1] is not None for a in attempts),'Unsettled document attempt'
        assert j[1]==0 and not attempts or attempts,'Attempt receipt missing'
        # The server-side receipt records the actual nested document xid and
        # canonical row digest; top-level attempt xid equality is not valid.
        provenance(c,[item])
        assert d[0]['parts']==[] and d[0]['next_part']==0,'Unexpected multipart output'
        processed+=d[0]['state']!='queued'
    children=c.execute("""SELECT n.nspname,t.relname,a.attname,cardinality(f.conkey),cardinality(f.confkey)
      FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=f.conkey[1] WHERE f.contype='f' AND f.confrelid='sa_domain.documents'::regclass""").fetchall()
    for schema,table,column,n,m in children:
        assert n==m==1
        assert not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE {}=ANY(%s::uuid[]) LIMIT 1').format(sql.Identifier(schema),sql.Identifier(table),sql.Identifier(column)),(ids,)).fetchone(),'Document has unreviewed dependent work'
    c.execute('DELETE FROM sa_domain.documents WHERE id=ANY(%s::uuid[])',(ids,))
    remaining=[row for row in audit_rows if not(row[2]=='document.requested' and row[5].get('document_id') in ids)]
    count=cleanup_documents(c,state,remaining,auths,owned_xids)
    return {'removed_documents':len(docs)+count,'processed_documents':processed,'executed_job_ids':jobs}
