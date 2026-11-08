"""Exact five-message rehearsal cleanup. External sends are never undone.

Immutable command audits, outbox attempts, send receipts and canonical worker
proofs remain. Source content must still pass the common whole-schema digest.
"""
import datetime,hashlib,json,uuid,urllib.request
from psycopg import sql
from business_cleanup_documents import cleanup_documents
import test_hosted_business_journeys as business


def cap_id(state):return uuid.uuid5(uuid.UUID(state['run_id']),'weekly-mail.capability')
def actors(state):return {x['role']:x for x in state['identity']['actors']}
def manual_documents(c,state,required=True):
    result=[]
    for kind,label,role in [('catalogue','mail.catalogue',0),('delivery_challan','mail.challan',7)]:
        a=actors(state)[role];key=uuid.uuid5(uuid.UUID(state['run_id']),label)
        rows=c.execute('''SELECT d.id FROM sa_domain.audit audit JOIN sa_domain.documents d
          ON d.id=(audit.changes->>'document_id')::uuid JOIN sa_domain.outbox j ON j.id=d.job_id
          WHERE audit.actor_id=%s AND audit.command_key=%s AND audit.operation='document.requested'
          AND audit.kind='document' AND audit.entity_id=d.sequence_id AND j.command_key=audit.command_key
          AND j.actor_id=audit.actor_id AND j.event_type='document.requested' AND d.kind=%s
          AND d.actor_id=audit.actor_id AND d.generation=%s AND d.request->>'delivery'='email'
          AND j.payload=jsonb_build_object('document_id',d.id)''',(a['auth_id'],key,kind,state['identity']['generation'])).fetchall()
        assert len(rows)<=1 and (rows or not required),'Exact audited email document unavailable'
        if rows:result.append(rows[0][0])
    return result


def capture_settings(c,state):
    assert 'weekly_mail' not in state
    state['weekly_mail']={'format':'squad-weekly-mail/v1','capability_id':str(cap_id(state)),
      'settings_before':c.execute("SELECT to_jsonb(m) FROM sa_domain.business_mail_settings m WHERE kind='tailor_weekly'").fetchone()[0],
      'schedule_before':c.execute('SELECT to_jsonb(s) FROM sa_domain.weekly_tailor_schedule s').fetchone()[0],
      'storage_receipts':[],'storage_deleted':False,'settings_restored':False,'cron':None}


def register(c,state):
    proof=state['weekly_mail'];assert proof['capability_id']==str(cap_id(state))
    docs=manual_documents(c,state)
    assert str(c.execute('SELECT sa_domain.weekly_tailor_latest_week(clock_timestamp())').fetchone()[0])==state['fixture']['weeklyMail']['weekStart'],'Weekly boundary crossed; rebuild the fixture'
    for doc in docs:
        row=c.execute('SELECT generation,actor_id,state FROM sa_domain.documents WHERE id=%s',(doc,)).fetchone();assert row[2]=='queued'
        prefix=f'g{row[0]}/{row[1]}/{doc}/'
        assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='squad-documents' AND starts_with(name,%s)",(prefix,)).fetchone()
    c.execute('''INSERT INTO sa_domain.weekly_mail_rehearsals(id,fixture_run_id,controlled_inbox,generation,owner_user_id,tailor_id,recipient_ids,manual_documents,expires_at)
       VALUES(%s,%s,%s,%s,%s,%s,%s,%s,least(clock_timestamp()+interval '10 minutes',(SELECT test_write_expires_at FROM sa_domain.runtime_state)))''',
       (cap_id(state),state['run_id'],state['identity']['weekly_mail_inbox'],state['identity']['generation'],state['base'],int(state['fixture']['weeklyMail']['tailorId']),
        [state['base']+r for r in [0,2,3,4]],docs))
    proof['registered']=True


def roots(c,state):
    """Server receipts, fixed audit keys and scheduler bindings are authority."""
    cap=cap_id(state)
    rows=c.execute('''SELECT to_jsonb(d),p.job_id,p.kind,p.document_xmin=d.xmin::text,
      p.document_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex')
      FROM sa_domain.weekly_mail_documents p JOIN sa_domain.documents d ON d.id=p.document_id
      WHERE p.capability_id=%s ORDER BY d.kind''',(cap,)).fetchall()
    # Registration may have rolled back after the checkpoint flush. Unexecuted
    # audited intents remain eligible for the common queued-document cleanup.
    if not rows:
        assert not c.execute('SELECT 1 FROM sa_domain.weekly_mail_rehearsals WHERE id=%s',(cap,)).fetchone()
        assert not c.execute('SELECT 1 FROM sa_domain.weekly_mail_job_receipts WHERE capability_id=%s',(cap,)).fetchone()
        return []
    assert 2<=len(rows)<=3
    manual=manual_documents(c,state)
    result=[]
    for d,job,kind,xmin_ok,hash_ok in rows:
        assert xmin_ok and hash_ok,'Document changed outside recorded rehearsal worker'
        assert d['generation']==state['identity']['generation'] and d['request']['delivery']=='email'
        assert d['actor_id'] in {x['auth_id'] for x in actors(state).values()}
        if kind=='tailor_weekly':
            assert d['actor_id']==actors(state)[0]['auth_id'] and d['request']=={'tailor_id':state['fixture']['weeklyMail']['tailorId'],'week_start':state['fixture']['weeklyMail']['weekStart'],'include_team':False,'delivery':'email'}
            entry=c.execute('''SELECT r.id,r.ceiling_id,r.queued,r.state,count(*) OVER() FROM sa_domain.weekly_tailor_runs r
              JOIN sa_domain.weekly_tailor_entries e ON e.run_id=r.id WHERE r.generation=%s AND r.week_start=%s
              AND e.document_id=%s AND e.tailor_id=%s''',(d['generation'],d['request']['week_start'],d['id'],int(d['request']['tailor_id']))).fetchone()
            assert entry and entry[1:]==(int(d['request']['tailor_id']),1,'queued',1)
            assert c.execute('SELECT count(*) FROM sa_domain.weekly_tailor_entries WHERE run_id=%s',(entry[0],)).fetchone()==(1,)
        else:assert uuid.UUID(d['id']) in manual
        assert d['parts']==[] and d['next_part']==0
        if d['snapshot'] is not None:assert len(d['snapshot']['rows'])<=100
        result.append({'document_id':d['id'],'job_id':str(job),'kind':kind,'generation':d['generation'],'actor_id':d['actor_id'],
            'prefix':f"g{d['generation']}/{d['actor_id']}/{d['id']}/",'document':d})
    assert {uuid.UUID(d['document_id']) for d in result if d['kind']!='tailor_weekly'}==set(manual)
    return result


def jobs(c,state,docs):
    ids={d['document_id'] for d in docs};result=[]
    rows=c.execute('''SELECT p.job_id,p.document_id,to_jsonb(j),
      p.job_xmin=j.xmin::text,p.job_sha256=encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex'),
      p.delivery_xmin IS NOT DISTINCT FROM m.xmin::text,
      p.delivery_sha256 IS NOT DISTINCT FROM CASE WHEN m.job_id IS NOT NULL THEN encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') END
      FROM sa_domain.weekly_mail_job_receipts p JOIN sa_domain.outbox j ON j.id=p.job_id
      LEFT JOIN sa_domain.business_mail_deliveries m ON m.job_id=j.id WHERE p.capability_id=%s''',(cap_id(state),)).fetchall()
    assert len(rows)<=11
    for job,document,data,*checks in rows:
        assert str(document) in ids and all(checks),'Job/delivery changed outside its rehearsal worker'
        assert c.execute('SELECT sa_domain.weekly_mail_job_document(%s)',(job,)).fetchone()==(document,),'Unexpected descendant binding'
        assert data['event_type'] in ['document.requested','document.mail','business.mail_delivery']
        result.append(data)
    actual={str(r[0]) for r in c.execute('SELECT job_id FROM sa_domain.business_mail_deliveries WHERE document_id=ANY(%s::uuid[])', (list(ids),))}
    assert actual=={j['id'] for j in result if j['event_type']=='business.mail_delivery'},'Unreceipted delivery references rehearsal document'
    known={j['id'] for j in result}
    assert not c.execute('SELECT 1 FROM sa_domain.outbox WHERE parent_id=ANY(%s::uuid[]) AND NOT(id=ANY(%s::uuid[]))',(list(known),list(known))).fetchone(),'Unreceipted descendant references rehearsal job'
    return result


def settings_provenance(c,state):
    stored=c.execute('SELECT 1 FROM sa_domain.weekly_mail_settings_receipts WHERE capability_id=%s',(cap_id(state),)).fetchone()
    if not stored:
        for table,before,label in [('weekly_tailor_schedule',state['weekly_mail']['schedule_before'],'mail.schedule'),('business_mail_settings',state['weekly_mail']['settings_before'],'mail.settings')]:
            where="kind='tailor_weekly'" if table=='business_mail_settings' else 'singleton'
            row=c.execute(sql.SQL('SELECT to_jsonb(t),xmin::text FROM sa_domain.{} t WHERE '+where).format(sql.Identifier(table))).fetchone()
            if row[0]==before:continue
            assert c.execute('SELECT 1 FROM sa_domain.audit WHERE command_key=%s AND actor_id=%s AND xmin::text=%s',(uuid.uuid5(uuid.UUID(state['run_id']),label),actors(state)[0]['auth_id'],row[1])).fetchone(),'Unregistered settings have no owned command provenance'
        return
    assert c.execute('''SELECT p.schedule_xmin=s.xmin::text AND p.schedule_sha256=encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex')
      AND p.settings_xmin=m.xmin::text AND p.settings_sha256=encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')
      FROM sa_domain.weekly_mail_settings_receipts p CROSS JOIN sa_domain.weekly_tailor_schedule s
      CROSS JOIN sa_domain.business_mail_settings m WHERE p.capability_id=%s AND m.kind='tailor_weekly' ''',(cap_id(state),)).fetchone()==(True,), 'Settings changed outside owned commands/heartbeat'
    assert not c.execute('''SELECT 1 FROM sa_domain.weekly_mail_settings_receipts p
      LEFT JOIN sa_domain.weekly_tailor_runs r ON r.id=p.run_id LEFT JOIN sa_domain.weekly_tailor_entries e ON e.document_id=p.entry_document_id
      WHERE p.capability_id=%s AND p.run_id IS NOT NULL AND(p.run_xmin IS DISTINCT FROM r.xmin::text
      OR p.run_sha256 IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')
      OR p.entry_xmin IS DISTINCT FROM e.xmin::text OR p.entry_sha256 IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'))''',(cap_id(state),)).fetchone(),'Schedule run or entry changed'
    assert not c.execute('''SELECT 1 FROM sa_domain.weekly_mail_settings_receipts p JOIN sa_domain.weekly_tailor_runs r
      ON r.generation=%s AND r.week_start=%s WHERE p.capability_id=%s AND p.run_id IS NULL''',
      (state['identity']['generation'],state['fixture']['weeklyMail']['weekStart'],cap_id(state))).fetchone(),'Unowned schedule run appeared'



def lock_cleanup(c,state):
    """Lock exact evidence and effects, then callers revalidate before mutation.

    Lock order matches worker jobs → documents. Parent FOR UPDATE locks also
    prevent a new FK child from appearing between child-set checks and deletion.
    """
    assert c.info.transaction_status.name=='INTRANS'
    cap=cap_id(state);manual=manual_documents(c,state,required=False)
    c.execute('''/* weekly-mail cleanup-lock */ SELECT j.id FROM sa_domain.outbox j
      WHERE j.id IN(SELECT job_id FROM sa_domain.weekly_mail_job_receipts WHERE capability_id=%s)
      OR j.id IN(SELECT job_id FROM sa_domain.documents WHERE id=ANY(%s::uuid[])) ORDER BY j.id FOR UPDATE''',(cap,manual)).fetchall()
    c.execute('''SELECT d.id FROM sa_domain.documents d WHERE d.id IN(
      SELECT document_id FROM sa_domain.weekly_mail_documents WHERE capability_id=%s)
      OR d.id=ANY(%s::uuid[]) ORDER BY d.id FOR UPDATE''',(cap,manual)).fetchall()
    c.execute('''SELECT m.job_id FROM sa_domain.business_mail_deliveries m WHERE m.document_id IN(
      SELECT document_id FROM sa_domain.weekly_mail_documents WHERE capability_id=%s)
      OR m.document_id=ANY(%s::uuid[]) ORDER BY m.job_id FOR UPDATE''',(cap,manual)).fetchall()
    c.execute('SELECT id FROM sa_domain.weekly_mail_rehearsals WHERE id=%s FOR UPDATE',(cap,)).fetchall()
    c.execute('SELECT singleton FROM sa_domain.weekly_tailor_schedule FOR UPDATE').fetchall()
    c.execute("SELECT kind FROM sa_domain.business_mail_settings WHERE kind='tailor_weekly' FOR UPDATE").fetchall()
    c.execute('SELECT id FROM sa_domain.weekly_tailor_runs WHERE generation=%s AND week_start=%s ORDER BY id FOR UPDATE',
      (state['identity']['generation'],state['fixture']['weeklyMail']['weekStart'])).fetchall()
    c.execute('''SELECT e.document_id FROM sa_domain.weekly_tailor_entries e JOIN sa_domain.weekly_tailor_runs r ON r.id=e.run_id
      WHERE r.generation=%s AND r.week_start=%s ORDER BY e.document_id FOR UPDATE OF e''',
      (state['identity']['generation'],state['fixture']['weeklyMail']['weekStart'])).fetchall()
    for table in ['weekly_mail_documents','weekly_mail_job_receipts','weekly_mail_settings_receipts','weekly_mail_sends']:
        c.execute(sql.SQL('SELECT 1 FROM sa_domain.{} WHERE capability_id=%s FOR UPDATE').format(sql.Identifier(table)),(cap,)).fetchall()


def quiesce(c,state):
    docs=roots(c,state);rows=jobs(c,state,docs)
    with c.transaction():
        lock_cleanup(c,state)
        docs=roots(c,state);rows=jobs(c,state,docs);settings_provenance(c,state)
        assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
        assert c.execute('SELECT generation FROM sa_domain.runtime_state FOR UPDATE').fetchone()[0]==state['identity']['generation']
        auths={uuid.UUID(x['auth_id']) for x in actors(state).values()}
        current=set(c.execute('SELECT test_actor_ids FROM sa_domain.runtime_state').fetchone()[0]);assert current in(set(),auths)
        c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
        c.execute('DELETE FROM sa_domain.weekly_mail_rehearsals WHERE id=%s',(cap_id(state),))
    docs=roots(c,state);rows=jobs(c,state,docs)
    for initial in rows:
        if initial['status']=='leased':
            with c.transaction():
                lock_cleanup(c,state)
                docs=roots(c,state);current_jobs=jobs(c,state,docs);settings_provenance(c,state)
                job=next(j for j in current_jobs if j['id']==initial['id'])
                if job['status']!='leased':continue
                deadline=datetime.datetime.fromisoformat(job['lease_until'])
                assert deadline+datetime.timedelta(seconds=60)<datetime.datetime.now(datetime.timezone.utc),'Rehearsal worker may still run; preserve checkpoint until lease plus 60 seconds'
                c.execute("UPDATE sa_domain.job_attempts SET state='failed',finished_at=clock_timestamp(),error_code='REHEARSAL_MAIL_ABORT' WHERE job_id=%s AND state='leased'",(job['id'],))
                c.execute("UPDATE sa_domain.outbox SET status='dead',lease_until=NULL,last_error_code='REHEARSAL_MAIL_ABORT',completed_at=clock_timestamp() WHERE id=%s",(job['id'],))
                c.execute("SELECT sa_domain.weekly_mail_record(%s,'cleanup_abort')",(job['id'],))
    return roots(c,state)


def object_rows(c,docs):
    allowed={d['prefix']+'document.pdf' for d in docs}
    rows=[r[0] for r in c.execute("SELECT to_jsonb(o)-'last_accessed_at' FROM storage.objects o WHERE bucket_id='squad-documents' AND EXISTS(SELECT 1 FROM unnest(%s::text[])p WHERE starts_with(o.name,p)) ORDER BY name",([d['prefix'] for d in docs],))]
    assert len(rows)<=3 and all(x['name'] in allowed for x in rows),'Unexpected output or multipart object'
    return rows


def cleanup_storage(c,state,service_key,save,url):
    docs=quiesce(c,state);proof=state['weekly_mail'];current=object_rows(c,docs)
    if proof['storage_deleted']:assert not current;return
    old={r['object']['name']:r for r in proof['storage_receipts']};allowed={d['prefix']+'document.pdf' for d in docs}
    assert len(old)==len(proof['storage_receipts'])<=3 and set(old)<=allowed
    folder=business.PRIVATE/'mail-outputs'/state['run_id'];folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    for obj in current:
        if obj['name'] in old:assert old[obj['name']]['object']==obj,'Output identity changed'
        else:
            req=urllib.request.Request(url+'/storage/v1/object/authenticated/squad-documents/'+obj['name'],headers={'apikey':service_key,'Authorization':'Bearer '+service_key})
            with urllib.request.urlopen(req,timeout=60) as response:assert response.status==200;data=response.read(10485761)
            assert 10<=len(data)<=10485760 and data.startswith(b'%PDF-')
            old[obj['name']]={'object':obj,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            doc=next(d for d in docs if obj['name']==d['prefix']+'document.pdf');target=folder/(doc['kind']+'.pdf');target.write_bytes(data);target.chmod(0o600)
    proof['storage_receipts']=list(old.values());save(state)
    for doc in docs:
        d=doc['document']
        if d['state']=='ready':
            receipt=old.get(doc['prefix']+'document.pdf');assert receipt and(d['bytes'],d['sha256'],d['object_path'])==(receipt['bytes'],receipt['sha256'],receipt['object']['name'])
    if current:
        assert object_rows(c,docs)==current
        req=urllib.request.Request(url+'/storage/v1/object/squad-documents',data=json.dumps({'prefixes':[x['name'] for x in current]}).encode(),method='DELETE',headers={'apikey':service_key,'Authorization':'Bearer '+service_key,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=60) as response:assert response.status==200
    assert not object_rows(c,docs),'Storage deletion unconfirmed'
    proof['storage_deleted']=True;save(state)


def callback(c,state,audit_rows,auths,owned_xids):
    lock_cleanup(c,state)
    docs=roots(c,state);rows=jobs(c,state,docs);proof=state['weekly_mail']
    assert proof['storage_deleted'] and not object_rows(c,docs)
    assert not c.execute('SELECT 1 FROM sa_domain.weekly_mail_rehearsals WHERE id=%s',(cap_id(state),)).fetchone()
    settings_provenance(c,state)
    for j in rows:
        assert j['status'] in ['pending','done','dead'] and j['lease_until'] is None
        assert not c.execute("SELECT 1 FROM sa_domain.job_attempts WHERE job_id=%s AND(state='leased' OR finished_at IS NULL)",(j['id'],)).fetchone(),'Unsettled exact worker attempt'
    ids=[x['document_id'] for x in docs]
    if not docs:
        for doc in manual_documents(c,state,required=False):
            assert c.execute('''SELECT d.state='queued' AND d.snapshot IS NULL AND d.object_path IS NULL AND d.xmin=a.xmin
              AND j.status='pending' AND j.attempts=0 AND j.lease_token IS NULL AND j.lease_until IS NULL
              FROM sa_domain.documents d JOIN sa_domain.outbox j ON j.id=d.job_id JOIN sa_domain.audit a
              ON a.actor_id=j.actor_id AND a.command_key=j.command_key AND a.operation='document.requested' WHERE d.id=%s''',(doc,)).fetchone()==(True,),'Unregistered email intent changed'
            assert not c.execute('SELECT 1 FROM sa_domain.business_mail_deliveries WHERE document_id=%s',(doc,)).fetchone()
            assert not c.execute('SELECT 1 FROM sa_domain.job_attempts WHERE job_id=(SELECT job_id FROM sa_domain.documents WHERE id=%s)',(doc,)).fetchone()
            row=c.execute('SELECT generation,actor_id FROM sa_domain.documents WHERE id=%s',(doc,)).fetchone()
            assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='squad-documents' AND starts_with(name,%s)",(f'g{row[0]}/{row[1]}/{doc}/',)).fetchone()
            ids.append(str(doc))
    # Store complete SMTP evidence before deleting temporary delivery projection.
    sends=c.execute('SELECT to_jsonb(s) FROM sa_domain.weekly_mail_sends s WHERE capability_id=%s',(cap_id(state),)).fetchall()
    assert len(sends)<=5
    for (send,) in sends:
        assert str(send['document_id']) in ids and any(j['id']==send['job_id'] and j['event_type']=='business.mail_delivery' for j in rows)
    runids=[r[0] for r in c.execute('SELECT run_id FROM sa_domain.weekly_tailor_entries WHERE document_id=ANY(%s::uuid[])',(ids,))]
    c.execute('DELETE FROM sa_domain.weekly_tailor_entries WHERE document_id=ANY(%s::uuid[])',(ids,))
    for run in runids:
        assert not c.execute('SELECT 1 FROM sa_domain.weekly_tailor_entries WHERE run_id=%s',(run,)).fetchone()
        c.execute('DELETE FROM sa_domain.weekly_tailor_runs WHERE id=%s',(run,))
    c.execute('DELETE FROM sa_domain.business_mail_deliveries WHERE document_id=ANY(%s::uuid[])',(ids,))
    # Unknown future FK dependants must not disappear through ON DELETE CASCADE.
    children=c.execute('''SELECT n.nspname,t.relname,a.attname,cardinality(f.conkey),cardinality(f.confkey)
      FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=f.conkey[1]
      WHERE f.contype='f' AND f.confrelid='sa_domain.documents'::regclass''').fetchall()
    for schema,table,column,child_count,parent_count in children:
        assert child_count==parent_count==1,'Unknown composite document dependency'
        assert not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE {}=ANY(%s::uuid[]) LIMIT 1').format(
          sql.Identifier(schema),sql.Identifier(table),sql.Identifier(column)),(ids,)).fetchone(),'Document has dependent work'
    assert c.execute("SELECT to_regclass('sa_domain.document_parts')").fetchone()[0] is None
    c.execute('DELETE FROM sa_domain.documents WHERE id=ANY(%s::uuid[])',(ids,))
    for table,key,value in [('weekly_tailor_schedule','singleton',proof['schedule_before']),('business_mail_settings','kind',proof['settings_before'])]:
        columns=[col for col in value if col!=key]
        c.execute(sql.SQL('UPDATE sa_domain.{} SET {} WHERE {}=%s').format(sql.Identifier(table),sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(col)) for col in columns),sql.Identifier(key)),[value[col] for col in columns]+[value[key]])
    remaining=[row for row in audit_rows if not(row[2]=='document.requested' and row[5].get('document_id') in ids)]
    removed=cleanup_documents(c,state,remaining,auths,owned_xids)
    return {'removed_documents':len(ids)+removed,'processed_documents':sum(d['document']['state']!='queued' for d in docs),
      'executed_job_ids':[j['id'] for j in rows],'capability_id':str(cap_id(state)),
      'smtp_accepted':sum(s[0]['state']=='accepted' for s in sends),'smtp_unknown':sum(s[0]['state']!='accepted' for s in sends)}
