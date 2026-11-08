"""Synthetic actors and relationships. No production data or usable passwords."""
import uuid,json
from psycopg.types.json import Jsonb
from psycopg import sql

def uid(n): return uuid.uuid5(uuid.NAMESPACE_URL, f'https://squad.invalid/test/user/{n}')
def sid(n): return uuid.uuid5(uuid.NAMESPACE_URL, f'https://squad.invalid/test/session/{n}')
def claims(n, role='sa_app'):
    return {'sub':str(uid(n)), 'session_id':str(sid(n)), 'role':role}

def seed(c):
    if c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=100').fetchone(): return
    with c.transaction():
        c.execute("INSERT INTO sa_snapshot_20261019.sa_factories(id,name,created_at,updated_at) VALUES (1,'Test factory',now(),now()),(2,'Other factory',now(),now())")
        for group in [100,200]:
            for role in range(13):
                n=group+role
                email=f'persona-{n}@squad.invalid'
                c.execute("""INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,role,created_at,updated_at,factory_id,created_by_id,approved,onboarded)
                  VALUES(%s,%s,%s,%s,now(),now(),%s,%s,true,true)""",
                  (n,email,f'Persona {n}',role,1 if group==100 else 2, group+1 if role in [3,10] else None))
                c.execute('INSERT INTO sa_sync.legacy_identity_keys VALUES(%s)',(n,))
                c.execute("""INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis)
                  VALUES(%s,%s,%s,'candidate','ready',true,'source_confirmed')""",(uid(n),n,email))
                c.execute("INSERT INTO auth.users(id,role,email) VALUES(%s,'sa_app',%s)",(uid(n),email))
                c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid(n),uid(n)))
            c.execute('INSERT INTO sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(group+3,group+10))
            c.execute('UPDATE sa_snapshot_20261019.sa_users SET factory_id=NULL,factory_manager_id=%s WHERE id=ANY(%s)',(group+4,[group+r for r in [5,7,8,9]]))
            c.execute('UPDATE sa_snapshot_20261019.sa_users SET factory_id=NULL,parent_tailor_id=%s WHERE id=%s',(group+5,group+6))
        c.execute("INSERT INTO auth.users(id,role,email) VALUES(%s,'authenticated','staff@squad.invalid')",(uid(999),))
        c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid(999),uid(999)))
        c.execute("INSERT INTO public.profiles VALUES(%s,'admin')",(uid(999),))
        c.execute("SELECT setval('sa_snapshot_20261019.sa_users_id_seq',1000)")

def session(c,n,role='sa_app'):
    c.execute('SELECT set_config(\'request.jwt.claims\',%s,true)',(json.dumps(claims(n,role)),))
    c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))

def rpc(c,name,args=()):
    assert name.startswith('v1_') and name.replace('_','').isalnum()
    params=sql.SQL(',').join(sql.Placeholder() for _ in args)
    return c.execute(sql.SQL('SELECT canto_api.{}({})').format(sql.Identifier(name),params),args).fetchone()[0]

def advance_fixture_sequences(c):
    """Explicit synthetic seed IDs need the same high-water rule as a refresh.

    Only advance; fixture cleanup must never make later IDs collide. Called
    when the catalogue seed is first created, not before each tested command.
    """
    rows=c.execute("""SELECT seq.relname,t.relname,a.attname FROM pg_class seq
      JOIN pg_namespace n ON n.oid=seq.relnamespace
      JOIN pg_depend d ON d.objid=seq.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN('a','i')
      JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
      WHERE n.nspname='sa_snapshot_20261019' AND seq.relkind='S'""").fetchall()
    for name,table,column in rows:
        top=c.execute(sql.SQL('SELECT max({}) FROM sa_snapshot_20261019.{}').format(sql.Identifier(column),sql.Identifier(table))).fetchone()[0]
        value,called=c.execute(sql.SQL('SELECT last_value,is_called FROM sa_snapshot_20261019.{}').format(sql.Identifier(name))).fetchone()
        if top is not None and (value<top or (value==top and not called)):
            c.execute('SELECT setval(%s::regclass,%s,true)',('sa_snapshot_20261019.'+name,top))

def seed_orders(c):
    seed(c)
    if c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_orders WHERE id=1001').fetchone():return
    with c.transaction():
        c.execute("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(1,'M',now(),now())")
        for group in [100,200]:
            c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,address,created_at,updated_at) VALUES(%s,%s,'Synthetic address',now(),now())",(group,group+3))
            for offset in range(1,7):
                n=group*10+offset
                c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,assigned_to_id,assigned_worker_id,customer_sc_id,
                  customer_dealer_id,order_item_type,status,uc_status,created_at,updated_at,created_on,due_on,total_quantity,total_amount)
                  VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now(),now(),now()+interval '10 days',10,1000)""",
                  (n,group+3,group,group+4,group+11,group+1,group+10 if offset==4 else None,
                   {1:1,2:0,3:2,4:1,5:1,6:1}[offset],1 if offset==5 else 0,'CANCELLED' if offset==6 else ''))
                c.execute("""INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,cutting_master_id,total_quantity,per_piece_amount,total_amount,
                  worker_per_piece_amount,worker_total_amount,created_at,updated_at) VALUES(%s,%s,%s,10,100,1000,40,400,now(),now())""",(n,n,group+9))
                c.execute("INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(%s,1,10,now(),now())",(n,))


def claim_test_workers(c,handler):
    """Simulate consecutive consumers; production leases slow work one at a time."""
    result=[]
    for _ in range(100):
        batch=c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs']
        if not batch:return result
        result.extend(j for j in batch if j['handler']==handler)
    raise AssertionError('Synthetic queue exceeded bounded consumer rounds')
