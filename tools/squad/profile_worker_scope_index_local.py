"""Synthetic localhost-only Worker index comparison; every change rolls back."""
import json
import hashlib
from pathlib import Path
import psycopg
from local_db import connect
from fixtures import seed_orders, session
from me_sql_diagnostic import safe_plan
from deploy import statements

MIGRATION = Path(__file__).resolve().parents[2] / "supabase/migrations/20261109043010_squad_worker_scope_index.sql"
INDEX = "sa_snapshot_20261019.squad_orders_worker_scope"

def security_metadata(c):
    return {
        "functions": c.execute("SELECT p.oid,pg_get_functiondef(p.oid),p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' ORDER BY p.oid").fetchall(),
        "policies": c.execute("SELECT schemaname,tablename,policyname,roles,qual,with_check FROM pg_policies ORDER BY 1,2,3").fetchall(),
        "tables": c.execute("SELECT c.oid,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('sa_domain','sa_snapshot_20261019') AND c.relkind IN('r','p') ORDER BY c.oid").fetchall(),
    }


def run(c):
    assert c.info.host == '127.0.0.1' and c.info.dbname.startswith('squad_test_')
    report = {'format': 'squad-local-worker-scope-index/v1', 'environment': 'synthetic_localhost',
              'samples': [], 'volume_orders': 45000, 'historical_visibility_preserved': False,
              'migration': str(MIGRATION.relative_to(Path(__file__).resolve().parents[2])),
              'migration_sha256': hashlib.sha256(MIGRATION.read_bytes()).hexdigest()}
    with c.transaction():
        assert c.execute("SELECT to_regclass(%s)",(INDEX,)).fetchone()[0] is None
        before_security = security_metadata(c)
        seed_orders(c)
        assert c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_orders WHERE id BETWEEN 3000001 AND 3045001').fetchone()[0] == 0
        c.execute("""INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,role,approved,onboarded,created_at,updated_at)
          SELECT 3000+g,'scope-local-'||g||'@squad.invalid','Synthetic Worker '||g,11,true,true,now(),now()
          FROM generate_series(0,19)g""")
        c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders
          SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_orders WHERE id=1001)x
          CROSS JOIN generate_series(1,45000)g CROSS JOIN LATERAL
          jsonb_populate_record(NULL::sa_snapshot_20261019.sa_orders,to_jsonb(x)||jsonb_build_object(
          'id',3000000+g,'assigned_to_id',NULL,'assigned_worker_id',3000+(g%20)))y""")
        c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders
          SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_orders WHERE id=1001)x
          CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_orders,to_jsonb(x)||jsonb_build_object(
          'id',3045001,'assigned_to_id',NULL,'assigned_worker_id',111,'is_deleted',true,'deleted_at',now()))y""")
        c.execute('ANALYZE sa_snapshot_20261019.sa_orders')
        c.execute("SET LOCAL statement_timeout='8s'")
        c.execute('SET LOCAL jit=off')
        session(c,111);c.execute('SET LOCAL ROLE postgres')
        c.execute('PREPARE squad_local_worker_branch(bigint) AS SELECT id FROM sa_snapshot_20261019.sa_orders WHERE assigned_worker_id=$1')
        try:
            for candidate in (False, True):
                if candidate:
                    for statement in statements(MIGRATION.read_text()):
                        c.execute(statement)
                    index = c.execute("SELECT indisvalid,indisready,indpred IS NULL,pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid=%s::regclass",(INDEX,)).fetchone()
                    assert index[:3] == (True,True,True) and '(assigned_worker_id, id)' in index[3]
                    report['index_valid_unfiltered_exact_columns'] = True
                    assert security_metadata(c) == before_security, 'Index migration changed functions, policies, or privileges'
                    c.execute('ANALYZE sa_snapshot_20261019.sa_orders')
                for mode in ('force_custom_plan', 'force_generic_plan'):
                    c.execute("SELECT set_config('plan_cache_mode',%s,true)", (mode,))
                    c.execute('SET LOCAL ROLE sa_guard')
                    p = c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE squad_local_worker_branch(111)').fetchone()[0][0]
                    ids = [row[0] for row in c.execute('EXECUTE squad_local_worker_branch(111)')]
                    assert 3045001 in ids and len(ids) == 7, 'Historical scope or owned row count changed'
                    c.execute('SET LOCAL ROLE sa_executor')
                    scoped = [row[0] for row in c.execute('SELECT sa_domain.scope_order_ids()')]
                    assert sorted(scoped) == sorted(ids)
                    c.execute('SET LOCAL ROLE postgres')
                    report['samples'].append({'candidate_full_index': candidate, 'plan_cache_mode': mode,
                        'scope_rows': len(ids), 'historical_row_retained': True, 'plan': safe_plan(p)})
        finally:
            c.execute('SET LOCAL ROLE postgres')
            c.execute('DEALLOCATE squad_local_worker_branch')
        report['historical_visibility_preserved'] = True
        report['security_metadata_unchanged'] = True
        # Real RLS still excludes every other Worker's row after the index.
        session(c,111)
        c.execute('SET LOCAL ROLE sa_executor')
        visible = [row[0] for row in c.execute('SELECT id FROM sa_snapshot_20261019.sa_orders ORDER BY id')]
        assert len(visible) == 7 and 3045001 in visible and not any(3000001 <= x <= 3045000 for x in visible)
        c.execute('SET LOCAL ROLE postgres')
        report['foreign_worker_orders_denied'] = True
        raise psycopg.Rollback()
    assert c.execute("SELECT to_regclass(%s)",(INDEX,)).fetchone()[0] is None
    assert c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_orders WHERE id BETWEEN 3000001 AND 3045001').fetchone()[0] == 0
    report['rollback_verified'] = True
    return report


if __name__ == '__main__':
    with connect() as connection:
        result = run(connection)
    path = Path('docs/squad-one-web/evidence/worker-scope-index-local.json')
    path.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'samples': len(result['samples']), 'rollback_verified': result['rollback_verified'], 'output': str(path)}))
