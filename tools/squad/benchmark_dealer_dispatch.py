"""Rollback-only shared-SDK FIFO dispatch against a larger synthetic source.

Uses the existing composed journey and its invariants. No provider/HTTP transport,
hosted connection, ownership change, or committed business fixture is involved.
"""
import argparse
import datetime
import json
import selectors
import subprocess
import time
from pathlib import Path

from psycopg import sql

from local_db import connect
from test_business_journey_composition import ROOT, ROLES, dispatch, prepare_local

NOISE_BASE = 1700000000


def seed_background(c, fixture, request, scale=1):
    """Structurally valid foreign rows matching the observed table cardinalities."""
    c.execute('RESET ROLE')
    counts = {'orders': 46231 * scale, 'items': 93544 * scale,
              'stocks': 43497 * scale, 'dispatches': 3051 * scale}
    owner = NOISE_BASE - 1
    size = int(fixture['ids']['sizeId'])
    product = c.execute('SELECT product_id FROM sa_snapshot_20261019.sa_items WHERE id=%s',
                        (int(request['args']['p_id']),)).fetchone()[0]
    assert product is not None
    assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=%s', (owner,)).fetchone()
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_users(id,name,role,approved,disabled,created_at,updated_at)
      VALUES(%s,'Synthetic background dealer',10,true,false,now(),now())""", (owner,))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,address,created_at,updated_at)
      VALUES(%s,%s,'Synthetic background address',now(),now())""", (owner, owner))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders
      (id,customer_id,address_id,status,order_item_type,created_at,updated_at)
      SELECT %s+n,%s,%s,1,0,now(),now() FROM generate_series(1,%s) n""",
      (NOISE_BASE, owner, owner, counts['orders']))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_items
      (id,order_id,product_id,item_type,total_quantity,created_at,updated_at)
      SELECT %s+n,%s+1+(n-1)%%%s,%s,0,1,now(),now() FROM generate_series(1,%s) n""",
      (NOISE_BASE, NOISE_BASE, counts['orders'], product, counts['items']))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_quantities(id,item_id,size_id,quantity,created_at,updated_at)
      SELECT %s+n,%s+n,%s,1,now(),now() FROM generate_series(1,%s) n""",
      (NOISE_BASE, NOISE_BASE, size, counts['items']))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_stocks
      (id,user_id,order_id,item_id,size_id,stock_type,product_id,quantity,dispatched_quantity,created_at,updated_at)
      SELECT i.id,%s,i.order_id,i.id,%s,1,%s,1,0,now(),now()
      FROM sa_snapshot_20261019.sa_items i WHERE i.id>%s AND i.id<=%s""",
      (owner, size, product, NOISE_BASE, NOISE_BASE + counts['stocks']))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_job_sheet_dispatched_dates
      (id,item_id,dispatched_at,created_at,updated_at)
      SELECT %s+n,%s+n,now(),now(),now() FROM generate_series(1,%s) n""",
      (NOISE_BASE, NOISE_BASE, counts['dispatches']))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_dispatched_quantities
      (id,quantity_id,job_sheet_dispatched_date_id,dispatched_quantity,qty,created_at,updated_at)
      SELECT %s+n,%s+n,%s+n,1,1,now(),now() FROM generate_series(1,%s) n""",
      (NOISE_BASE, NOISE_BASE, NOISE_BASE, counts['dispatches']))
    for table in ['users', 'orders', 'items', 'quantities', 'stocks', 'job_sheet_dispatched_dates', 'dispatched_quantities', 'stock_useds']:
        c.execute(sql.SQL('ANALYZE sa_snapshot_20261019.{}').format(sql.Identifier('sa_' + table)))
    return counts


def run(mode='auto', scale=1, timeout_ms=5000):
    calls = []
    output = {'plan_cache_mode': mode, 'scale': scale, 'statement_timeout_ms': timeout_ms,
              'scope': 'local synthetic shared SDK to real SQL; rollback; no HTTP/provider writes'}
    with connect() as c:
        assert c.info.host == '127.0.0.1' and c.info.dbname.startswith('squad_test_')
        mirror = c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
        runtime = c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()
        assert not mirror[0]
        c.execute('BEGIN')
        process = None
        selector = selectors.DefaultSelector()
        try:
            fixture = prepare_local(c)
            c.execute("SELECT set_config('plan_cache_mode',%s,true)", (mode,))
            process = subprocess.Popen(['node', 'tools/squad/business_journeys_local_bridge.mjs'], cwd=ROOT,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            process.stdin.write(json.dumps({'roles': ROLES, 'fixture': fixture}) + '\n'); process.stdin.flush()
            selector.register(process.stdout, selectors.EVENT_READ)
            seeded = False
            deadline = time.monotonic() + 180
            while True:
                assert time.monotonic() < deadline, 'Benchmark exceeded 180 seconds'
                assert selector.select(timeout=10), 'Shared SDK runner stopped responding'
                line = process.stdout.readline(); assert line, process.stderr.read()
                message = json.loads(line)
                if message['kind'] == 'result':
                    output['checks'] = {name: len(value['checks']) for name, value in message['report'].items()}
                    output['state'] = 'passed'
                    break
                if message['kind'] == 'failed':
                    output['state'] = 'failed'; output['error'] = message['error']; break
                assert message['kind'] == 'rpc'
                if not seeded and message['name'] == 'v1_dispatch_record' and message['role'] == 10:
                    started = time.perf_counter()
                    output['background_rows'] = seed_background(c, fixture, message, scale)
                    output['seed_ms'] = round((time.perf_counter() - started) * 1000, 3)
                    output['policy_fingerprint'] = c.execute("""SELECT md5(string_agg(
                      polname||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),
                      E'\\n' ORDER BY polname)) FROM pg_policy WHERE polrelid='sa_snapshot_20261019.sa_stock_useds'::regclass""").fetchone()[0]
                    c.execute("SELECT set_config('statement_timeout',%s,true)", (str(timeout_ms),))
                    seeded = True
                started = time.perf_counter()
                response = dispatch(c, message)
                elapsed = round((time.perf_counter() - started) * 1000, 3)
                if seeded:
                    call = {'name': message['name'], 'role': message['role'], 'ms': elapsed,
                            'error_code': response['error']['code'] if response['error'] else None}
                    if message['name'] == 'v1_dispatch_record':
                        call['requested_quantity'] = sum(x['quantity'] for x in message['args']['p_quantities'])
                        call['allocations'] = [x['quantity'] for x in (response['data'] or {}).get('stock_allocations', [])]
                    calls.append(call)
                process.stdin.write(json.dumps(response) + '\n'); process.stdin.flush()
        finally:
            selector.close()
            if process:
                if process.poll() is None: process.kill(); process.wait(timeout=5)
                for stream in [process.stdin, process.stdout, process.stderr]:
                    if stream and not stream.closed: stream.close()
            c.execute('ROLLBACK')
        assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=%s', (NOISE_BASE - 1,)).fetchone()
        assert c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone() == mirror
        assert c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone() == runtime
    output['calls'] = calls
    output['measured_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return output


def validate_result(result, budget_ms=500):
    assert result['state'] == 'passed', result.get('error')
    assert result['checks'] == {'commercial': 8, 'factory': 3, 'collaboration': 7}
    successes = [row for row in result['calls'] if row['name'] == 'v1_dispatch_record'
                 and row['role'] == 10 and row['error_code'] is None]
    assert any(row['allocations'] == [4, 3] for row in successes), 'Missing actual two-receipt FIFO success'
    assert all(row['ms'] < budget_ms for row in successes), successes


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['auto', 'force_custom_plan', 'force_generic_plan'], default='auto')
    parser.add_argument('--scale', type=int, choices=[1, 2], default=1)
    parser.add_argument('--timeout-ms', type=int, default=5000)
    parser.add_argument('--max-dispatch-ms', type=int, default=500)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = run(args.mode, args.scale, args.timeout_ms)
    if args.output: args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    validate_result(result, args.max_dispatch_ms)
