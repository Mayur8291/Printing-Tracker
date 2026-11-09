"""Prove the one extra Auth fence revision made by an owned self-closure.

No generic revision allowance: the ban, source closure, blocked identity and
immutable command/audit must all come from the same transaction. A retry does
not create another audit or ban revision. Other credential writes remain fatal.
"""
import uuid


def independent_staff_changes(c, baseline, current, fixture_auths, owned_xids):
    """Recognize existing staff changes that this fixture did not perform.

    Whole Auth rows contain live provider timestamps. Never restore an unrelated
    account to satisfy an old checksum. We make no claim about which fields an
    independent transaction changed; the caller must preserve its current full
    row checksum throughout cleanup and report the baseline divergence.
    """
    assert set(current) == set(baseline), 'Staff identity inventory changed'
    changed = {key for key in baseline if baseline[key] != current[key]}
    assert not changed.intersection(map(str, fixture_auths)), 'Fixture overlaps staff identities'
    if changed:
        rows = c.execute('SELECT id,xmin::text,md5(row_to_json(u)::text) FROM auth.users u WHERE id=ANY(%s::uuid[])',
                         (list(changed),)).fetchall()
        assert {str(row[0]) for row in rows} == changed, 'Changed staff identity unavailable'
        assert all(row[2] == current[str(row[0])] for row in rows), 'Staff changed during attribution'
        assert all(int(row[1]) not in owned_xids for row in rows), 'Fixture modified a staff identity'
    return len(changed)


def owned_closure_auth_revisions(c, state, raw_rows):
    closures = [row for row in raw_rows if row[2] == 'account.closed']
    actors = {uuid.UUID(a['auth_id']): a for a in state['identity']['actors']}
    assert len({row[0] for row in closures}) == len(closures), 'Duplicate self-closure audit'
    for actor, key, operation, kind, entity, changes, xid in closures:
        fixture = actors.get(actor)
        assert fixture and fixture['role'] == 3 and kind == 'person', 'Closure is not the owned Customer'
        assert int(entity) == state['base'] + 3, 'Closure source identity differs'
        assert changes == {'self_service': True, 'historical_records_preserved': True,
                           'canonical_email_reserved': True}, 'Closure audit contract changed'
        proof = c.execute("""
          SELECT u.role='sa_app',u.banned_until='9999-12-31 23:59:59+00'::timestamptz,
            u.xmin::text=%s,m.xmin::text=%s,p.xmin::text=%s,d.xmin::text=%s,
            m.enrollment_state='blocked',m.legacy_user_id=%s,
            lower(btrim(u.email))=m.canonical_email,
            p.role=3,p.disabled IS TRUE,p.deleted_at IS NOT NULL,
            d.operation='account.closed',d.generation=%s,
            d.result->>'state'='closed',d.result->>'id'=%s,
            d.result->'sessions_revoked'='true'::jsonb,
            NOT EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=u.id),
            NOT EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE user_id=u.id::text),
            EXISTS(SELECT 1 FROM sa_domain.audit a WHERE a.actor_id=u.id
              AND a.command_key=d.key AND a.operation='account.closed'
              AND a.generation=d.generation AND a.xmin::text=%s)
          FROM auth.users u
          JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=u.id
          JOIN sa_snapshot_20261019.sa_users p ON p.id=m.legacy_user_id
          JOIN sa_domain.commands d ON d.actor_id=u.id AND d.key=%s
          WHERE u.id=%s
        """, (xid, xid, xid, xid, entity, state['identity']['generation'],
              str(entity), xid, key, actor)).fetchone()
        assert proof and all(value is True for value in proof), 'Unproven self-closure Auth revision'
    return len(closures)
