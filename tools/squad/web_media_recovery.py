"""Exact-owned profile upload rehearsal; existing media and audit remain intact.

Only two preplanned unique PNGs on the synthetic Customer's initially empty
profile field are supported. Incomplete verification is not safe to clean until
the reservation expires; a checkpoint survives that refusal.
"""
import hashlib
import json
import struct
import uuid
import urllib.request
import zlib
from pathlib import Path

from release_mirror import row_digest


def png(run_id, index):
    def chunk(kind, value):
        return struct.pack('!I', len(value)) + kind + value + struct.pack('!I', zlib.crc32(kind + value))
    color = (40, 100, 200) if index == 0 else (180, 70, 80)
    pixels = b''.join(b'\x00' + bytes(color) * 16 for _ in range(16))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 16, 16, 8, 2, 0, 0, 0))
            + chunk(b'tEXt', b'Squad fixture\x00' + f'{run_id}:{index}'.encode('ascii'))
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


def snapshot(c):
    return {f'{schema}.{table}': row_digest(c, schema, table, excluded=excluded)
            for schema, table, excluded in [('sa_media', 'objects', ()),
                                           ('sa_media', 'references', ()),
                                           ('sa_admin', 'media', ()),
                                           ('storage', 'objects', ('last_accessed_at',))]}


def plan(c, state, private):
    actor = next(a for a in state['identity']['actors'] if a['role'] == 3)
    files = []
    for index in range(2):
        data = png(state['run_id'], index)
        digest = hashlib.sha256(data).hexdigest()
        filename = f'web-media-{state["run_id"]}-{index}.png'
        canonical = f'sha256/{digest[:2]}/{digest}'
        assert not c.execute('SELECT 1 FROM sa_media.objects WHERE sha256=%s', (digest,)).fetchone()
        assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='canto-media' AND name=%s", (canonical,)).fetchone()
        files.append({'path': str(private / filename), 'filename': filename,
                      'sha256': digest, 'bytes': len(data), 'content_type': 'image/png', 'canonical': canonical})
    state['web_media'] = {'format': 'squad-web-media/v1', 'actor_id': actor['auth_id'],
                          'target': {'resource': 'users', 'record_id': str(actor['id']), 'field': 'profile_image'},
                          'files': files, 'before': snapshot(c), 'storage_receipts': [], 'storage_deleted': False}


def validate(state):
    proof = state['web_media']
    actor = next(a for a in state['identity']['actors'] if a['role'] == 3)
    assert proof['format'] == 'squad-web-media/v1' and proof['actor_id'] == actor['auth_id']
    assert proof['target'] == {'resource': 'users', 'record_id': str(actor['id']), 'field': 'profile_image'}
    assert len(proof['files']) == 2
    private = Path(state['journal']).parent
    for index, item in enumerate(proof['files']):
        data = png(state['run_id'], index); digest = hashlib.sha256(data).hexdigest()
        filename = f'web-media-{state["run_id"]}-{index}.png'
        assert item == {'path': str(private / filename), 'filename': filename, 'sha256': digest,
                        'bytes': len(data), 'content_type': 'image/png', 'canonical': f'sha256/{digest[:2]}/{digest}'}
    return proof


def write_files(state):
    proof = validate(state)
    for index, item in enumerate(proof['files']):
        path = Path(item['path'])
        path.write_bytes(png(state['run_id'], index)); path.chmod(0o600)


def bindings(c, state, entries):
    proof = validate(state)
    keys = set()
    for entry in entries:
        if entry.get('kind') == 'command':
            value = entry['value']; key = uuid.UUID(value['key'])
            assert key == uuid.uuid5(uuid.UUID(state['run_id']), value['label'])
            keys.add(key)
    rows = c.execute('SELECT to_jsonb(u) FROM sa_domain.media_uploads u WHERE actor_id=%s ORDER BY created_at,id',
                     (proof['actor_id'],)).fetchall()
    assert len(rows) <= 2, 'Unexpected profile upload count'
    files = {f['filename']: f for f in proof['files']}; result = []
    assert len({row[0]['filename'] for row in rows}) == len(rows), 'Repeated upload reservation'
    for (upload,) in rows:
        item = files.get(upload['filename'])
        assert item and upload['resource'] == 'users' and str(upload['record_id']) == proof['target']['record_id']
        assert upload['field'] == 'profile_image' and upload['generation'] == state['identity']['generation']
        assert upload['bytes'] == item['bytes'] and upload['content_type'] == 'image/png'
        commands = c.execute("SELECT key,result FROM sa_domain.commands WHERE actor_id=%s AND operation='media.reserved' AND result->>'upload_id'=%s AND generation=%s",
                             (proof['actor_id'], upload['id'], state['identity']['generation'])).fetchall()
        assert len(commands) == 1 and commands[0][0] in keys, 'Upload lacks owned reservation command'
        receipt = commands[0][1]
        assert receipt['filename'] == item['filename'] and receipt['bytes'] == str(item['bytes'])
        assert receipt['bucket'] == 'squad-uploads' and receipt['path'] == 'pending/' + upload['id']
        if upload['state'] == 'attached':
            attached = c.execute("""SELECT a.xmin::text=u.xmin::text,c.result=u.result
                FROM sa_domain.audit a JOIN sa_domain.commands c ON c.actor_id=a.actor_id AND c.key=a.command_key
                JOIN sa_domain.media_uploads u ON u.id=(a.changes->>'upload_id')::uuid
                WHERE a.actor_id=%s AND a.operation='media.attached' AND a.generation=%s
                  AND a.changes->>'upload_id'=%s AND a.command_key=ANY(%s::uuid[])
                  AND a.entity_id=u.record_id AND u.actor_id=a.actor_id
                  AND c.operation=a.operation AND c.generation=a.generation
                  AND a.changes->>'resource'='users'
                  AND a.changes->>'field'='profile_image'""",
                (proof['actor_id'], state['identity']['generation'], upload['id'], list(keys))).fetchall()
            assert attached == [(True, True)], 'Attached upload lacks exact immutable audit provenance'
        else:
            expired = c.execute("SELECT expires_at+interval '2 hours 10 minutes'<clock_timestamp() FROM sa_domain.media_uploads WHERE id=%s", (upload['id'],)).fetchone()
            assert expired == (True,), 'Incomplete upload may still be executing or hold a signed PUT; retain checkpoint until expiry plus2h10m'
        assert upload['sha256'] in (None, item['sha256']), 'Upload hash differs from planned bytes'
        result.append((upload, item))
    hashes = [item['sha256'] for item in proof['files']]
    assert not c.execute('SELECT 1 FROM sa_domain.media_uploads WHERE sha256=ANY(%s::text[]) AND NOT(id=ANY(%s::uuid[])) LIMIT 1',
                         (hashes, [upload['id'] for upload, _ in result])).fetchone(), 'Other upload references test media'
    assert not c.execute("SELECT 1 FROM sa_media.references WHERE sha256=ANY(%s::text[]) AND NOT(resource='users' AND record_id=%s AND field='profile_image') LIMIT 1", (hashes, int(proof['target']['record_id']))).fetchone(), 'Other record references test media'
    assert not c.execute("SELECT 1 FROM sa_admin.media m WHERE EXISTS(SELECT 1 FROM unnest(%s::text[]) h WHERE position(h IN m.url)>0) LIMIT 1", (hashes,)).fetchone(), 'An override references test media'
    refs = c.execute("SELECT sha256,xmin::text,pointer FROM sa_media.references WHERE resource='users' AND record_id=%s AND field='profile_image'", (int(proof['target']['record_id']),)).fetchall()
    audit_xids = {row[0] for row in c.execute("SELECT xmin::text FROM sa_domain.audit WHERE actor_id=%s AND operation='media.attached' AND id>%s AND command_key=ANY(%s::uuid[])", (proof['actor_id'], state['audit_start'], list(keys)))}
    assert all(digest in hashes and xid in audit_xids and pointer == '' for digest, xid, pointer in refs), 'Unowned media reference provenance'
    for item in proof['files']:
        stored = c.execute('SELECT object_path,bytes,content_type FROM sa_media.objects WHERE sha256=%s', (item['sha256'],)).fetchone()
        assert stored in (None, (item['canonical'], item['bytes'], 'image/png')), 'Canonical media metadata differs from manifest'
    if c.execute("SELECT to_regclass('sa_domain.document_attachments')").fetchone()[0]:
        assert not c.execute('SELECT 1 FROM sa_domain.document_attachments WHERE sha256=ANY(%s::text[]) LIMIT 1', (hashes,)).fetchone(), 'Document attachment references test media'
    return result


def storage_rows(c, owned):
    result = []
    for upload, item in owned:
        for bucket, name in [('squad-uploads', 'pending/' + upload['id']), ('canto-media', item['canonical'])]:
            row = c.execute("SELECT to_jsonb(o)-'last_accessed_at' FROM storage.objects o WHERE bucket_id=%s AND name=%s", (bucket, name)).fetchone()
            if row: result.append((row[0], item))
    return result


def cleanup_storage(c, state, entries, service_key, save, url):
    assert url == 'https://scvojtvgnkmbupvyslmb.supabase.co'
    proof = validate(state)
    with c.transaction():
        assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone() == ('staging', False, None)
        assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0] == state['identity']['generation'], 'Media generation changed'
        allowed = c.execute('SELECT test_actor_ids FROM sa_domain.runtime_state').fetchone()[0]
        assert set(allowed) in (set(), {uuid.UUID(a['auth_id']) for a in state['identity']['actors']})
        c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
    owned = bindings(c, state, entries)
    current = storage_rows(c, owned)
    allowed = {(bucket, name): item for upload, item in owned
               for bucket, name in [('squad-uploads', 'pending/' + upload['id']), ('canto-media', item['canonical'])]}
    receipts = {(r['object']['bucket_id'], r['object']['name']): r for r in proof['storage_receipts']}
    assert len(receipts) == len(proof['storage_receipts']) <= 4 and set(receipts) <= set(allowed), 'Invalid media Storage receipt inventory'
    for key, receipt in receipts.items():
        assert str(uuid.UUID(receipt['object']['id'])) == receipt['object']['id']
        assert receipt['sha256'] == allowed[key]['sha256'] and receipt['bytes'] == allowed[key]['bytes'], 'Receipt differs from manifest'
    for obj, item in current:
        key = (obj['bucket_id'], obj['name'])
        if key in receipts: assert receipts[key]['object'] == obj, 'Owned Storage object changed'
        request = urllib.request.Request(url + '/storage/v1/object/authenticated/' + '/'.join(key),
                   headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key})
        with urllib.request.urlopen(request, timeout=30) as response: data = response.read(item['bytes'] + 1)
        assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], 'Storage bytes differ from fixture manifest'
        receipts[key] = {'object': obj, 'sha256': item['sha256'], 'bytes': item['bytes']}
    proof['storage_receipts'] = list(receipts.values()); save(state)
    for bucket in ('squad-uploads', 'canto-media'):
        paths = [obj['name'] for obj, _ in current if obj['bucket_id'] == bucket]
        if not paths: continue
        latest = storage_rows(c, bindings(c, state, entries))
        for obj, _ in latest:
            assert receipts[(obj['bucket_id'], obj['name'])]['object'] == obj, 'Storage changed before deletion'
        assert {(obj['bucket_id'], obj['name']) for obj, _ in latest if obj['bucket_id'] == bucket} == {(bucket, name) for name in paths}, 'Storage inventory changed before deletion'
        request = urllib.request.Request(url + '/storage/v1/object/' + bucket, method='DELETE', data=json.dumps({'prefixes': paths}).encode(),
                   headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=30) as response: assert response.status == 200
    assert not storage_rows(c, owned), 'Owned upload Storage remains'
    proof['storage_deleted'] = True; save(state)


def cleanup_database(c, state, entries):
    proof = validate(state); owned = bindings(c, state, entries)
    assert proof['storage_deleted'] and not storage_rows(c, owned), 'Storage cleanup must finish first'
    hashes = [item['sha256'] for item in proof['files']]
    refs = c.execute("SELECT sha256,xmin::text FROM sa_media.references WHERE resource='users' AND record_id=%s AND field='profile_image'", (int(proof['target']['record_id']),)).fetchall()
    audit_xids = {row[0] for row in c.execute("SELECT xmin::text FROM sa_domain.audit WHERE actor_id=%s AND operation IN('media.attached','media.detached') AND id>%s", (proof['actor_id'], state['audit_start']))}
    assert all(digest in hashes and xid in audit_xids for digest, xid in refs), 'Unowned media reference'
    c.execute("DELETE FROM sa_media.references WHERE resource='users' AND record_id=%s AND field='profile_image'", (int(proof['target']['record_id']),))
    assert not c.execute('SELECT 1 FROM sa_media.references WHERE sha256=ANY(%s::text[])', (hashes,)).fetchone()
    c.execute('DELETE FROM sa_media.objects WHERE sha256=ANY(%s::text[])', (hashes,))
    assert snapshot(c) == proof['before'], 'Existing media/Storage differs from baseline'
    return {'owned_uploads': len(owned), 'existing_media_preserved': True, 'storage_removed': True,
            'upload_history_and_audits_retained': True}
