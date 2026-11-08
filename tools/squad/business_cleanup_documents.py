"""Delete only unprocessed rehearsal documents proved by immutable command audits."""
import uuid

from psycopg import sql


def cleanup_documents(c, state, audit_rows, auths, owned_xids):
    expected = {}
    for actor, key, operation, kind, sequence, changes in audit_rows:
        if operation != 'document.requested':
            continue
        assert kind == 'document' and actor in auths
        document = str(uuid.UUID(changes['document_id']))
        assert document not in expected, 'Duplicate document audit'
        expected[document] = (actor, key, sequence)
    assert len(expected) <= 32, 'Unbounded rehearsal documents'
    rows = c.execute('SELECT to_jsonb(d),xmin::text FROM sa_domain.documents d WHERE actor_id=ANY(%s::uuid[]) FOR UPDATE', (auths,)).fetchall()
    assert {d['id'] for d, _ in rows} == set(expected), 'Document ownership differs from immutable audits'
    actors = {a['auth_id']: a for a in state['identity']['actors']}
    for d, xid in rows:
        actor, key, sequence = expected[d['id']]
        owner = actors[str(actor)]
        assert int(xid) in owned_xids, 'Document changed outside an owned command'
        assert (d['actor_id'], d['legacy_user_id'], d['role_id'], d['generation'], d['sequence_id']) == (
            str(actor), int(owner['id']), owner['role'], state['identity']['generation'], sequence), 'Document identity changed'
        assert d['state'] == 'queued' and d['delivery_state'] == 'not_requested' and d['request']['delivery'] == 'download', 'Document is not an unprocessed download'
        assert d['authority_scope'] == {} and d['parts'] == [] and d['next_part'] == 0
        assert all(d[name] is None for name in ('snapshot', 'snapshot_hash', 'object_path', 'bytes', 'sha256', 'page_count', 'error_code', 'captured_at', 'completed_at', 'expires_at', 'parts_cleanup_queued_at', 'output_cleanup_queued_at')), 'Document processing has started'
        job = c.execute('SELECT actor_id,command_key,event_type,aggregate_kind,aggregate_id,generation,payload,status,attempts FROM sa_domain.outbox WHERE id=%s', (d['job_id'],)).fetchone()
        assert job == (actor, key, 'document.requested', 'document', sequence, d['generation'], {'document_id': d['id']}, 'pending', 0), 'Document job differs from its audit'
    if not rows:
        return 0
    ids = [uuid.UUID(d['id']) for d, _ in rows]
    # Discover every FK child, so a new dependency fails closed instead of being
    # implicitly deleted. No dependent row is itself a deletion authority.
    children = c.execute("""SELECT n.nspname,t.relname,a.attname,cardinality(f.conkey),cardinality(f.confkey)
      FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=f.conkey[1]
      WHERE f.contype='f' AND f.confrelid='sa_domain.documents'::regclass""").fetchall()
    for schema, table, column, child_count, parent_count in children:
        assert child_count == parent_count == 1, 'Unexpected composite document dependency'
        assert not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE {}=ANY(%s::uuid[]) LIMIT 1').format(sql.Identifier(schema), sql.Identifier(table), sql.Identifier(column)), (ids,)).fetchone(), 'Document has dependent work'
    # Current parts are inline JSON. Refuse an unreviewed future parts table.
    assert c.execute("SELECT to_regclass('sa_domain.document_parts')").fetchone()[0] is None, 'Review document parts cleanup before proceeding'
    removed = c.execute('DELETE FROM sa_domain.documents WHERE id=ANY(%s::uuid[]) RETURNING id', (ids,)).fetchall()
    assert len(removed) == len(expected)
    return len(removed)
