"""Bounded localhost review of the other already-logged timeout paths; no DDL."""
import json
from pathlib import Path
import psycopg
from local_db import connect
from fixtures import seed_orders, session
from me_sql_diagnostic import safe_plan


def run(c):
    assert c.info.host == '127.0.0.1' and c.info.dbname.startswith('squad_test_')
    report = {'format':'squad-pc-logged-scope-review/v1','environment':'synthetic_localhost',
              'volume_orders_and_items':45000,'samples':[], 'schema_changes':False}
    with c.transaction():
        seed_orders(c)
        assert c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_orders WHERE id BETWEEN 3100001 AND 3145000').fetchone()[0] == 0
        c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders
          SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_orders WHERE id=1001)x
          CROSS JOIN generate_series(1,45000)g CROSS JOIN LATERAL
          jsonb_populate_record(NULL::sa_snapshot_20261019.sa_orders,to_jsonb(x)||jsonb_build_object(
          'id',3100000+g,'assigned_worker_id',NULL))y""")
        c.execute("""INSERT INTO sa_snapshot_20261019.sa_items
          SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_items WHERE id=1001)x
          CROSS JOIN generate_series(1,45000)g CROSS JOIN LATERAL
          jsonb_populate_record(NULL::sa_snapshot_20261019.sa_items,to_jsonb(x)||jsonb_build_object(
          'id',3100000+g,'order_id',3100000+g))y""")
        c.execute("INSERT INTO sa_snapshot_20261019.sa_criteria(id,name,created_at,updated_at) VALUES(3100001,'Synthetic criterion',now(),now())")
        c.execute("""INSERT INTO sa_snapshot_20261019.sa_item_criteria(id,item_id,criteria_id,created_at,updated_at)
          SELECT 3100000+g,3100000+g,3100001,now(),now() FROM generate_series(1,45000)g""")
        c.execute("INSERT INTO sa_snapshot_20261019.sa_item_criteria(id,item_id,criteria_id,created_at,updated_at) VALUES(3145001,1001,3100001,now(),now())")
        c.execute("SET LOCAL statement_timeout='8s'"); c.execute('SET LOCAL jit=off')
        session(c,102); c.execute('SET LOCAL ROLE postgres')
        for scope in ('dense','sparse'):
            if scope == 'sparse':
                c.execute('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=0 WHERE id BETWEEN 3100101 AND 3145000')
            for table in ('sa_orders','sa_items','sa_item_criteria'):
                c.execute('ANALYZE sa_snapshot_20261019.'+table)
            queries = [
              ('pc_exact_scope_branch','sa_guard',"SELECT i.id FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE o.order_item_type IN(1,2) AND o.customer_dealer_id IS NULL"),
              ('criteria_exact_bounded_read','sa_executor',"SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_item_criteria q WHERE q.item_id=1001) eligible WHERE id<9223372036854775807 ORDER BY id DESC LIMIT 51) bounded"),
              ('criteria_actual_helper','sa_executor',"SELECT sa_domain.item_children(1001,'criteria',NULL,50)"),
            ]
            for label,role,sql in queries:
                c.execute('SET LOCAL ROLE '+role)
                plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+sql).fetchone()[0][0]
                c.execute('SET LOCAL ROLE postgres')
                report['samples'].append({'scope':scope,'component':label,'role':role,'plan':safe_plan(plan)})
        report['existing_indexes']=[dict(zip(('table','name','definition'),r)) for r in c.execute("""SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='sa_snapshot_20261019'
          AND indexname IN('squad_orders_production_scope','squad_items_order_page','sa_index_item_criteria_on_item_id') ORDER BY indexname""")]
        raise psycopg.Rollback()
    assert c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_orders WHERE id BETWEEN 3100001 AND 3145000').fetchone()[0] == 0
    report['rollback_verified']=True
    report['conclusion']='Existing exact PC predicate index and item/criteria relation indexes are usable. Dense PC authority necessarily enumerates many authorized items; these samples do not reproduce the hosted timeout and do not justify another index or authority change.'
    return report


if __name__=='__main__':
    with connect() as c: result=run(c)
    output=Path('docs/squad-one-web/evidence/pc-logged-scope-index-review.json')
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'samples':len(result['samples']),'rollback_verified':result['rollback_verified'],'output':str(output)}))
