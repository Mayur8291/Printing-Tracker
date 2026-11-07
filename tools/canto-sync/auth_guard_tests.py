"""Staging negative tests; every attempted mutation is rolled back."""
import json
from pathlib import Path
from database import connect
import psycopg
P=Path(__file__).resolve().parent
x=json.loads((P/'private/auth-test.json').read_text())
with connect('staging') as c:
    assert c.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0]
    assert c.execute('SELECT email FROM sa_snapshot_20261019.sa_users WHERE id=7692').fetchone()[0]==x['email']
    uid=c.execute('SELECT auth_user_id FROM sa_identity.sa_auth_identities WHERE legacy_user_id=7692').fetchone()[0]
    tests=[]
    for name,statement,params in [
      ('execution_role_escalation_rejected',"UPDATE auth.users SET role='authenticated' WHERE id=%s",(uid,)),
      ('unmapped_sa_app_rejected',"INSERT INTO auth.users(id,aud,role,email) VALUES(gen_random_uuid(),'authenticated','sa_app','canto-guard-unmapped@invalid')",()),
    ]:
        try:
            with c.transaction():
                c.execute(statement,params);c.execute('SET CONSTRAINTS ALL IMMEDIATE')
                raise AssertionError('Guard accepted '+name)
        except psycopg.Error as exc:
            assert exc.sqlstate=='P0001' and ('Canto identity' in str(exc)),str(exc)
            tests.append(name)
    # An ineligible source state must not leave an unbanned Auth account.
    try:
        with c.transaction():
            c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=7692')
            c.execute('UPDATE auth.users SET banned_until=NULL WHERE id=%s',(uid,))
            c.execute('SET CONSTRAINTS ALL IMMEDIATE')
            raise AssertionError('Guard allowed ineligible account')
    except psycopg.Error as exc:
        assert exc.sqlstate=='P0001' and 'Canto identity is blocked' in str(exc),str(exc)
        tests.append('ineligible_unbanned_account_rejected')
    print(json.dumps(tests));(P/'auth-guard-verification.json').write_text(json.dumps({'passed':tests},indent=2)+'\n')
