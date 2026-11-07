"""Exercise every master against staging inside a transaction that always rolls back."""
import json, uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
from database import connect

def main():
    contracts = json.loads((Path(__file__).parent / 'master-contracts.json').read_text())
    results = []
    with connect('staging') as conn:
        with conn.transaction():
            actor = conn.execute("SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.role='admin' AND u.role='authenticated' LIMIT 1").fetchone()
            assert actor, 'An existing staging administrator is required.'
            session = uuid.uuid4()
            conn.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())', (session, actor[0]))
            claims = {'sub': str(actor[0]), 'role': 'authenticated', 'session_id': str(session)}
            conn.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps(claims),))
            conn.execute('SET LOCAL ROLE authenticated')
            def call(resource, action, payload):
                return conn.execute('SELECT canto_api.masters(%s,%s,%s)', (resource, action, Jsonb(payload))).fetchone()[0]
            for resource, spec in contracts.items():
                try:
                    with conn.transaction():
                        listing = call(resource, 'list', {'items': 2})
                        assert len(listing['data']) <= 2
                        if spec.get('readOnly'):
                            results.append({'resource': resource, 'reads': True}); continue
                        raw = listing['data'][0] if listing['data'] else {}
                        values = {k: raw[k] for k in spec['fields'] if k in raw and k not in spec['media']}
                        for field in spec['required']:
                            if values.get(field) is None or values.get(field) == '':
                                if field in spec['references']:
                                    target = spec['references'][field]
                                    candidate = call(target, 'list', {'items': 1})['data']
                                    assert candidate, 'Missing reference fixture: ' + target
                                    values[field] = candidate[0]['id']
                                else:
                                    values[field] = spec.get('enums', {}).get(field, [1 if spec['columns'][field]['type'] not in ('text','character varying') else 'Fixture'])[0]
                        for field in ['name','title','add_on']:
                            if field in spec['fields']: values[field] = 'Canto acceptance ' + uuid.uuid4().hex[:14]
                        values['is_deleted'] = False
                        created = call(resource, 'create', {'values': values})
                        rid = created['id']
                        assert call(resource, 'get', {'id': rid})['id'] == rid
                        updated = call(resource, 'update', {'id': rid, 'values': {'is_deleted': False}, 'expectedUpdatedAt': created['updated_at']})
                        assert updated['id'] == rid
                        deleted = call(resource, 'delete', {'id': rid})
                        assert deleted['is_deleted'] is True
                        restored = call(resource, 'update', {'id': rid, 'values': {'is_deleted': False}})
                        assert restored['is_deleted'] is False
                        result = call(resource, 'bulk_delete', {'ids': [rid]})
                        assert result['deleted'] == 1
                        results.append({'resource': resource, 'crud': True})
                except Exception as error:
                    results.append({'resource': resource, 'error': getattr(getattr(error,'diag',None),'message_primary',None) or str(error)})
            # Exercise authorization as a real non-owner DB role, not just UI hiding.
            conn.execute('SET LOCAL ROLE authenticated')
            conn.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':str(uuid.uuid4()),'role':'authenticated','session_id':str(session)}),))
            try:
                with conn.transaction(): call('colors','list',{})
            except psycopg.errors.InsufficientPrivilege:
                results.append({'unauthorized_rejected': True})
            else: results.append({'error':'Unauthorized request was accepted'})
            conn.execute('SET LOCAL ROLE postgres')
            print(json.dumps(results, indent=2))
            raise psycopg.Rollback()
    if any('error' in r for r in results): raise SystemExit(1)

if __name__ == '__main__': main()
