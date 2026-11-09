"""One exact commercial Worker graph, component plans, unconditional SQL rollback.

No HTTP, GoTrue, provider, Cron or worker invocation. Normal command sequence
increments can leave gaps; no sequence reset or claim of zero physical effects.
The release integrator alone runs --execute after reviewing local evidence.
"""
import argparse
import datetime
import hashlib
import json
import re
import uuid
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

import test_hosted_business_journeys as business
from test_business_journey_composition import dispatch
from me_sql_diagnostic import safe_plan
from profile_hosted_business_journeys import context_functions

FUNCTIONS = ('sa_domain.v1_order_get(bigint,text,integer)',
             'sa_domain.v1_order_get(bigint,text,integer,text)',
             'sa_domain.actor()', 'sa_domain.auth_context()',
             'sa_domain.scope_order_ids()', 'sa_domain.can_item(bigint)',
             'sa_domain.order_dispatch_destination(bigint)',
             'sa_domain.worker_order_context(bigint,bigint,integer)')
GUARD_TABLES = ('auth.users', 'auth.identities', 'auth.sessions',
                'sa_domain.runtime_state', 'sa_domain.commands', 'sa_domain.audit',
                'sa_domain.outbox', 'sa_domain.entity_versions',
                'sa_identity.sa_auth_identities', 'sa_sync.environment_state')


def guards(c):
    result = {'source': business.source_state(c),
              'public': business.identities.public_structure(c),
              'staff': business.identities.staff_auth(c), 'tables': {}}
    for name in GUARD_TABLES:
        relation = sql.Identifier(*name.split('.'))
        result['tables'][name] = c.execute(sql.SQL(
            "SELECT count(*),md5(coalesce(string_agg(h,'' ORDER BY h),'')) "
            "FROM(SELECT md5(to_jsonb(t)::text) h FROM {} t)x").format(relation)).fetchone()
    return result


def component_queries(definition, order_id, generation):
    """Extract the deployed statement verbatim, replacing PL/pgSQL variables only.

    Query text/parameters never enter the public report. Fail on shape drift;
    do not silently substitute an older copy of the RPC's statement.
    """
    assert isinstance(order_id, int) and order_id > 0
    header = re.search(r" SELECT sa_domain.order_projection[\s\S]+?deleted_at IS NULL;", definition)
    items = re.search(r" WITH scan AS MATERIALIZED[\s\S]+?v.entity_id=p.id;", definition)
    assert header and items, 'Order detail statement shape changed'
    def bind(query):
        query = re.sub(r'\bINTO (?:result|items_)\b', '', query)
        values = {'p_id': str(order_id), 'after_': '9223372036854775807',
                  'n': '25', 'ctx': "jsonb_build_object('generation',"+str(int(generation))+")",
                  'a': '(SELECT actor_value FROM diagnostic_constants)'}
        for name, value in values.items():
            query = re.sub(r'\b'+name+r'\b', value, query)
        # The actual PL/pgSQL declaration resolves its actor once. Do not add
        # one Auth lookup per projected item while extracting that statement.
        constants = 'diagnostic_constants AS MATERIALIZED(SELECT sa_domain.actor() actor_value)'
        query = re.sub(r'^\s*WITH\s+', 'WITH '+constants+', ', query) if re.match(r'^\s*WITH\s+', query) else 'WITH '+constants+' '+query
        return query.rstrip(';')
    return [('header', 'sa_executor', bind(header.group())),
            ('item_quantity_page', 'sa_executor', bind(items.group())),
            ('dispatch_destination', 'sa_executor', f'SELECT sa_domain.order_dispatch_destination({order_id})'),
            ('pending_request', 'sa_executor', "SELECT jsonb_build_object('id',id,'kind',kind,'state',state,'created_at',created_at) FROM sa_domain.order_requests WHERE order_id="+str(order_id)+" AND state IN('queued','running') AND generation=(SELECT generation FROM sa_domain.runtime_state) LIMIT 1"),
            ('worker_history', 'sa_app', f"SELECT canto_api.v1_order_get({order_id},NULL,25,'worker_history')")]


def compare_scope_plans(c, order_id, worker_id, report):
    """Exact branch parameter and existing helper, no predicates or grants added."""
    statement = 'squad_worker_scope_' + uuid.uuid4().hex
    prepared = False
    try:
        c.execute(sql.SQL('PREPARE {}(bigint) AS SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.assigned_worker_id=$1').format(sql.Identifier(statement)))
        prepared = True
        queries = [('outer_order', 'sa_app', f'SELECT canto_api.v1_order_get({int(order_id)},NULL,25)'),
                   ('scope_order_ids', 'sa_executor', 'SELECT sa_domain.scope_order_ids()'),
                   ('worker_scope_branch', 'sa_guard', sql.SQL('EXECUTE {}({})').format(sql.Identifier(statement), sql.Literal(int(worker_id))).as_string(c))]
        for mode in ('force_custom_plan', 'force_generic_plan'):
            c.execute("SELECT set_config('plan_cache_mode',%s,true)", (mode,))
            for label, role, query in queries:
                c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                try:
                    with c.transaction():
                        plan = c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query).fetchone()[0][0]
                        report['samples'].append({'phase': 'after_due', 'plan_cache_mode': mode,
                            'component': label, 'role': role, 'outcome': 'completed', 'plan': safe_plan(plan)})
                except psycopg.Error as error:
                    report['samples'].append({'phase': 'after_due', 'plan_cache_mode': mode,
                        'component': label, 'role': role, 'outcome': 'failed', 'sqlstate': error.sqlstate,
                        'context_functions': context_functions(error.diag.context)})
                finally:
                    c.execute('SET LOCAL ROLE postgres')
    finally:
        # PREPARE is session state, not covered by rollback. Close it explicitly.
        if prepared:
            c.execute('SET LOCAL ROLE postgres')
            c.execute(sql.SQL('DEALLOCATE {}').format(sql.Identifier(statement)))


def run_probe(c, *, inject_failure=False, compare_scope=False):
    """Caller holds the publication lock; only this nested transaction mutates."""
    assert c.execute('SELECT current_user').fetchone()[0] == 'postgres', 'Requires the existing privileged connection role'
    # Fail before preparing any rows if the connection cannot assume an
    # existing measured role. This verifies membership; it never grants it.
    with c.transaction():
        for role in (('sa_app', 'sa_executor', 'sa_guard', 'postgres') if compare_scope else ('sa_app', 'sa_executor', 'postgres')):
            c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
            assert c.execute('SELECT current_user').fetchone()[0] == role
        raise psycopg.Rollback()
    before = guards(c)
    report = {'format': 'squad-worker-rollback-profile/v1', 'environment': 'staging',
              'samples': [], 'setup_steps': [], 'external_calls': 0, 'committed_fixture_rows': 0,
              'sequence_policy': 'Ordinary nextval gaps may remain; sequences are never reset.',
              'measurement': 'One SQL connection, actual command-created custom order before/after Worker commitment. Component plans preserve original role/RLS; no HTTP or concurrent-load claim.'}
    if compare_scope:
        report['measurement'] = 'One SQL connection after actual Worker due change: forced custom versus generic plans for existing order RPC, scope helper, and exact parameterized Worker branch under its original guard role. No historical/live predicate changes. No HTTP/concurrent-load claim.'
    failure = None
    state = None
    try:
        with c.transaction():
            state = business.plan(c)
            state['created_at'] = c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat()
            business.prepare(c, state)  # SQL-only; credentials are discarded.
            actors = {}
            for actor in state['identity']['actors']:
                if actor['role'] in (2, 3, 11):
                    session_id = uuid.uuid4()
                    c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)', (session_id, actor['auth_id']))
                    actors[actor['role']] = {**actor, 'session_id': str(session_id)}
            c.execute("SET LOCAL statement_timeout='8s'")
            c.execute("SET LOCAL lock_timeout='2s'")
            c.execute("SET LOCAL idle_in_transaction_session_timeout='30s'")
            report['settings'] = {name: c.execute('SELECT current_setting(%s)', (name,)).fetchone()[0]
                for name in ('statement_timeout', 'lock_timeout', 'jit', 'plan_cache_mode', 'work_mem')}
            f = state['fixture']; run = uuid.UUID(state['run_id'])
            def call(role, name, args):
                def observe(value):
                    error = value['error']
                    report['setup_steps'].append({'role': role, 'contract': name,
                        'elapsed_ms': value['elapsed_ms'], 'outcome': 'failed' if error else 'completed',
                        'sqlstate': getattr(error, 'sqlstate', None),
                        'context_functions': context_functions(getattr(getattr(error, 'diag', None), 'context', None))})
                result = dispatch(c, {'role': role, 'name': name, 'args': args}, actors=actors, observer=observe, privileged_role='postgres')
                assert result['error'] is None, 'Diagnostic setup command failed: '+name+' '+str((result['error'] or {}).get('code', ''))
                return result['data']
            def command(label, version=None):
                return {'p_idempotency_key': str(uuid.uuid5(run, label)), 'p_expected_version': version}
            product = call(3, 'v1_product_configure', {'p_configuration': f['customConfig'], 'p_name': f['label']+' profile preset', 'p_comment': '', 'p_idempotency_key': str(uuid.uuid5(run, 'preset'))})
            quote = call(3, 'v1_quote', {'p_request': {'customer_id': actors[3]['id'], 'address_id': str(f['ids']['customerAddressId']), 'lines': [{'kind': 'custom', 'configuration': f['customConfig'], 'quantities': [{'size_id': str(f['ids']['sizeId']), 'quantity': 2}]}]}})
            placed = call(3, 'v1_order_place', {'p_quote_id': quote['quote_id'], 'p_details': {'due_at': f['dueAt'], 'comment': f['label']+' profile order', 'line_settings': {'1': {'product_id': product['id']}}}, **command('place', quote['version'])})['orders'][0]
            order_id = int(placed['id']); item_id = int(placed['items'][0]['item_id'])
            current = call(2, 'v1_order_get', {'p_id': order_id, 'p_item_cursor': None, 'p_item_limit': 25})
            call(2, 'v1_order_assign_worker', {'p_id': order_id, 'p_worker_id': actors[11]['id'], 'p_due_at': f['dueAt'], 'p_reason': f['label']+' assign', **command('assign', current['version'])})
            item = call(2, 'v1_order_item_get', {'p_id': item_id, 'p_section': 'quantities', 'p_cursor': None, 'p_limit': 25})
            call(2, 'v1_worker_cost_save', {'p_id': item_id, 'p_unit_cost': '12.345', 'p_reason': f['label']+' cost', **command('cost', item['version'])})
            if inject_failure:
                raise RuntimeError('Injected rollback interruption')
            definitions = {name: c.execute('SELECT pg_get_functiondef(%s::regprocedure)', (name,)).fetchone()[0] for name in FUNCTIONS}
            report['function_sha256'] = {name: hashlib.sha256(text.encode()).hexdigest() for name, text in definitions.items()}
            if compare_scope:
                branch = 'ELSIF a.role_id=11 THEN RETURN QUERY SELECT o.id FROM sa_snapshot_20261019.sa_orders o WHERE o.assigned_worker_id=a.user_id;'
                assert definitions['sa_domain.scope_order_ids()'].count(branch) == 1, 'Worker scope definition changed; review the exact comparison branch'
            generation = c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]
            queries = [('outer_order', 'sa_app', f'SELECT canto_api.v1_order_get({order_id},NULL,25)')] + component_queries(definitions[FUNCTIONS[0]], order_id, generation)
            actor = actors[11]
            claims = json.dumps({'sub': actor['auth_id'], 'session_id': actor['session_id'], 'role': 'sa_app'})
            for phase in ('before_due', 'after_due'):
                if phase == 'after_due':
                    current = call(11, 'v1_order_get', {'p_id': order_id, 'p_item_cursor': None, 'p_item_limit': 25})
                    due = (datetime.datetime.fromisoformat(f['dueAt'])+datetime.timedelta(days=1)).isoformat()
                    call(11, 'v1_worker_due_save', {'p_id': order_id, 'p_due_at': due, 'p_reason': f['label']+' due commitment', **command('due', current['version'])})
                c.execute("SELECT set_config('request.jwt.claims',%s,true)", (claims,))
                if compare_scope:
                    if phase == 'after_due':
                        compare_scope_plans(c, order_id, actor['id'], report)
                    continue
                for label, role, query in queries:
                    c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                    try:
                        with c.transaction():
                            plan = c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query).fetchone()[0][0]
                            report['samples'].append({'phase': phase, 'component': label, 'role': role, 'outcome': 'completed', 'plan': safe_plan(plan)})
                    except psycopg.Error as error:
                        report['samples'].append({'phase': phase, 'component': label, 'role': role, 'outcome': 'failed', 'sqlstate': error.sqlstate, 'context_functions': context_functions(error.diag.context)})
                    finally:
                        # Hosted CLI credentials log in as a temporary role and
                        # explicitly assume postgres; RESET ROLE loses that role.
                        c.execute('SET LOCAL ROLE postgres')
            raise psycopg.Rollback()
    except Exception as error:
        failure = error
    # Fresh statements after rollback, including Auth/session values and flags.
    assert guards(c) == before, 'Post-rollback fingerprints changed; investigate without restoring foreign data'
    report['rollback_verified'] = True
    report['all_components_completed'] = bool(report['samples']) and all(x['outcome'] == 'completed' for x in report['samples'])
    if failure:
        if inject_failure:
            raise failure
        report['setup_failed'] = True
        report['all_components_completed'] = False
        report['failure_type'] = type(failure).__name__
        report['failure_sqlstate'] = getattr(failure, 'sqlstate', None)
        report['failure_context_functions'] = context_functions(getattr(getattr(failure, 'diag', None), 'context', None))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--compare-scope-plans', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    args.output = args.output or Path('docs/squad-one-web/evidence/worker-scope-plan-comparison.json' if args.compare_scope_plans else 'docs/squad-one-web/evidence/worker-order-rollback-profile.json')
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0], 'Another rehearsal or release is active'
        try:
            assert not business.CHECKPOINT.exists(), 'Existing business checkpoint requires recovery'
            if not args.execute:
                business.plan(c)
                print(json.dumps({'ready': True, 'executed': False, 'environment': 'staging'}))
                return
            result = run_probe(c, compare_scope=args.compare_scope_plans)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2)+'\n')
            print(json.dumps({'rollback_verified': result['rollback_verified'], 'all_components_completed': result['all_components_completed'], 'samples': len(result['samples']), 'output': str(args.output)}))
            if not result['all_components_completed']:
                raise SystemExit(1)
        finally:
            c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__ == '__main__':
    main()
