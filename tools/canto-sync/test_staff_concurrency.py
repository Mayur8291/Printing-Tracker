"""Staging regression: real staff sign-in is allowed, our own staff mutation is detected."""
import json, urllib.request
from pathlib import Path
import psycopg
from database import connect, staff_auth

fixture=json.loads((Path(__file__).parent/'private/admin-test.json').read_text())
assert fixture['url']=='https://scvojtvgnkmbupvyslmb.supabase.co'

def login():
    req=urllib.request.Request(fixture['url']+'/auth/v1/token?grant_type=password',
        data=json.dumps({'email':fixture['email'],'password':fixture['password']}).encode(),
        headers={'apikey':fixture['anon'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=45) as response:
        assert json.load(response)['user']['id']==fixture['id']

with connect('staging') as conn:
    with conn.transaction():
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        before=staff_auth(conn)
        login()
        assert staff_auth(conn)==before,'Concurrent sign-in caused a false migration failure'
    with conn.transaction():
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        before=staff_auth(conn)
        conn.execute("UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{\"canto_regression\":true}'::jsonb WHERE id=%s",(fixture['id'],))
        assert staff_auth(conn)!=before,'Our own staff mutation was not detected'
        raise psycopg.Rollback()
    assert staff_auth(conn)==before,'The regression fixture did not roll back'
print(json.dumps({'concurrent_staff_login_allowed':True,'own_staff_mutation_detected':True,'fixture_mutation_rolled_back':True}))
