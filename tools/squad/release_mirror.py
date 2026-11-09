"""Promote an exact staging-reviewed Squad prefix without publishing source data.

Rollback verification is the default. This separate release path never changes
the legacy staging-only deployer, provider settings, Cron state, or cutover.
An fsynced local receipt is written BEFORE commit; --recover-baselines resolves
an interrupted commit/baseline publication without re-running migrations.
"""
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import psycopg
from psycopg import sql
from pglast import ast, parse_sql

from deploy import ROOT, statements

sys.path.insert(0, str(ROOT / 'tools/canto-sync'))
from database import connect, public_structure, SCHEMA
from delta_sync import catalog, check_catalog
from domain_sync import access_catalog
from management import PROJECTS
from snapshot import require

BASELINES = ROOT / 'tools/canto-sync/baselines'
PRIVATE = ROOT / 'tools/squad/private'
SOURCE_TABLE_COUNT = 86
COMPANION_COLUMNS = frozenset(('dashboard_reservation_id', 'order_source'))
COMPANION_DECLARATIONS = {
    'dashboard_reservation_id': 'dashboard_reservation_id varchar',
    'order_source': "order_source varchar NOT NULL DEFAULT 'unicommerce'",
}
PRIVATE_ROLES = ('sa_guard', 'sa_executor', 'sa_worker', 'sa_media_writer',
                 'sa_account_writer', 'sa_integrator', 'sa_mail_lock', 'sa_dashboard')
NEW_BUCKETS = {
    'squad-documents': (False, 67108864, ['application/pdf', 'application/octet-stream']),
    'squad-transfers': (False, 10485760, ['text/csv', 'application/octet-stream']),
    'squad-uploads': (False, 104857600, None),
}


def canonical(value):
    return json.loads(json.dumps(value, sort_keys=True, default=str))


def digest(value):
    return hashlib.sha256(json.dumps(canonical(value), sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def progress(message):
    print('Mirror release: ' + message, file=sys.stderr, flush=True)


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    body: str

    @property
    def filename(self):
        return self.version + '_' + self.name + '.sql'

    @property
    def sha256(self):
        return hashlib.sha256(self.body.encode()).hexdigest()


def migrations(through, directory=None):
    require(isinstance(through, str) and re.fullmatch(r'[0-9]{14}', through),
            'An explicit reviewed 14-digit cutoff is required')
    result = []
    for path in sorted((directory or ROOT / 'supabase/migrations').glob('*_squad_*.sql')):
        version, name = path.stem.split('_', 1)
        require(re.fullmatch(r'[0-9]{14}', version) and name.startswith('squad_'),
                'Unexpected Squad migration filename')
        if version <= through:
            body = path.read_text()
            require(bool(list(statements(body))), 'Empty migration: ' + path.name)
            result.append(Migration(version, name, body))
    require(result and result[-1].version == through, 'Cutoff must name an existing Squad migration')
    require(len({m.version for m in result}) == len(result), 'Duplicate migration version')
    return result


def history(c):
    return {str(v): {'name': n, 'statements': s} for v, n, s in c.execute(
        'SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')}


def verify_history(rows, release, *, complete):
    expected = {m.version: m for m in release}
    for version, row in rows.items():
        is_squad = (row['name'] or '').startswith('squad_')
        if version in expected:
            m = expected[version]
            require(row['name'] == m.name and row['statements'] == [m.body],
                    'Applied migration body/name differs: ' + m.filename)
        elif is_squad:
            raise RuntimeError('Target contains an unreviewed Squad migration: ' + version)
    if complete:
        require(set(expected) <= set(rows), 'Staging has not applied the complete reviewed prefix')


def column_catalog(c, schema=SCHEMA):
    return canonical(c.execute("""SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
      a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,
      CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname=%s AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname,a.attnum""", (schema,)).fetchall())


def source_projection(c):
    columns = column_catalog(c)
    tables = {}
    for row in columns:
        tables.setdefault(row[0], []).append(row[1])
    require(len(tables) == SOURCE_TABLE_COUNT, 'Expected exactly 86 imported source tables')
    return columns, tables


def row_digest(c, schema, table, columns=None, excluded=()):
    if columns is None:
        value = sql.SQL('to_jsonb(t)-{}::text[]').format(sql.Literal(list(excluded)))
    else:
        # Original named projection preserves a byte-exact logical row even if
        # the two explicitly approved nullable companion columns are appended.
        value = sql.SQL('to_jsonb(t)')
    relation = sql.SQL('{}.{}').format(sql.Identifier(schema), sql.Identifier(table))
    source = relation if columns is None else sql.SQL('(SELECT {} FROM {})').format(
        sql.SQL(',').join(map(sql.Identifier, columns)), relation)
    sums = [sql.SQL("coalesce(sum(('x'||substr(h,{},16))::bit(64)::bigint::numeric),0)::text")
            .format(sql.Literal(n)) for n in (1, 17, 33, 49)]
    result = c.execute(sql.SQL("""WITH hashes AS MATERIALIZED (
      SELECT encode(sha256(convert_to(({})::text,'UTF8')),'hex') h FROM {} t)
      SELECT count(*),{} FROM hashes""").format(value, source, sql.SQL(',').join(sums))).fetchone()
    return {'rows': result[0], 'digest': list(result[1:])}


def sequence_states(c):
    names = [r[0] for r in c.execute("""SELECT c.relname FROM pg_class c JOIN pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname=%s AND c.relkind='S' ORDER BY 1""", (SCHEMA,))]
    return {name: list(c.execute(sql.SQL('SELECT last_value,is_called FROM {}.{}').format(
        sql.Identifier(SCHEMA), sql.Identifier(name))).fetchone()) for name in names}


def bucket_state(c, allow_new=()):
    require(set(allow_new) <= set(NEW_BUCKETS), 'Unreviewed bucket addition')
    result = {}
    for name, bucket_name, public, size, mimes, sha in c.execute("""SELECT id,name,public,file_size_limit,
      allowed_mime_types,encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex')
      FROM storage.buckets b ORDER BY id"""):
        if name in allow_new:
            require(bucket_name == name and (public, size, mimes) == NEW_BUCKETS[name],
                    'New private bucket configuration differs')
        else:
            result[name] = sha
    return result


def protected_data(c, projection, allow_new_buckets=()):
    result = {'source': {}, 'source_sequences': sequence_states(c), 'auth': {}, 'identity': {},
              'public': {}, 'media': {}, 'buckets': bucket_state(c, allow_new_buckets)}
    for number, (table, columns) in enumerate(projection.items(), 1):
        result['source'][table] = row_digest(c, SCHEMA, table, columns)
        if number % 20 == 0 or number == len(projection):
            progress('verified source digests ' + str(number) + '/' + str(len(projection)))
    # Session/token rotation has its own tables. Only these two operational
    # timestamps are excluded from identity/credential comparisons.
    for table in ('users', 'identities'):
        if c.execute('SELECT to_regclass(%s)', ('auth.' + table,)).fetchone()[0]:
            result['auth'][table] = row_digest(c, 'auth', table,
                                               excluded=('updated_at', 'last_sign_in_at'))
    for schema, key in (('sa_identity', 'identity'), ('public', 'public'), ('sa_media', 'media')):
        for (table,) in c.execute("""SELECT tablename FROM pg_tables WHERE schemaname=%s ORDER BY 1""", (schema,)):
            result[key][table] = row_digest(c, schema, table)
    if c.execute("SELECT to_regclass('sa_sync.legacy_identity_keys')").fetchone()[0]:
        result['identity']['legacy_identity_keys'] = row_digest(c, 'sa_sync', 'legacy_identity_keys')
    if c.execute("SELECT to_regclass('sa_admin.media')").fetchone()[0]:
        result['media']['sa_admin.media'] = row_digest(c, 'sa_admin', 'media')
    result['storage_objects'] = row_digest(c, 'storage', 'objects')
    return result


def cron_state(c):
    if not c.execute("SELECT to_regclass('cron.job')").fetchone()[0]:
        return []
    # Preserve EVERY existing schedule, not only the Squad jobs. Definitions may
    # contain invocation secrets, so persist only their SHA256, never their text.
    return canonical(c.execute("""SELECT jobid,jobname,active,
      encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex')
      FROM cron.job j ORDER BY jobid""").fetchall())


def environment_state(c, environment):
    state = c.execute('SELECT to_jsonb(s) FROM sa_sync.environment_state s WHERE singleton').fetchone()
    require(state and state[0]['environment'] == environment, 'Wrong destination environment')
    state = state[0]
    require(state['cutover'] is False and state.get('active_job') is None,
            'Release requires an idle mirror with cutover=false')
    if c.execute("SELECT to_regclass('sa_domain.runtime_state')").fetchone()[0]:
        runtime = c.execute('SELECT to_jsonb(s) FROM sa_domain.runtime_state s WHERE singleton').fetchone()[0]
        require(runtime.get('allow_test_writes') is False and not runtime.get('test_actor_ids')
                and runtime.get('test_write_expires_at') is None, 'Rehearsal writes must be disabled')
    for table, predicate in (
        ('outbox', "status='leased' AND lease_until>clock_timestamp()"),
        ('account_flows', "state='processing' AND lease_until>clock_timestamp()"),
        ('warehouse_rehearsals', 'lease_until>clock_timestamp()'),
    ):
        if c.execute('SELECT to_regclass(%s)', ('sa_domain.' + table,)).fetchone()[0]:
            require(not c.execute(sql.SQL('SELECT 1 FROM sa_domain.{} WHERE ' + predicate + ' LIMIT 1')
                                  .format(sql.Identifier(table))).fetchone(), 'An exact worker lease is active')
    require(not any(row[2] and row[1].startswith('squad-') for row in cron_state(c)),
            'Pause existing Squad schedules before release; their state will be preserved')
    return canonical(state)


def artifact_catalog(c):
    """Complete environment-neutral backend definitions and effective authority.

    One canonical extractor is shared with independent parity acceptance. It
    includes column/table/schema/default ACLs, grantors, all execution-role
    powers/memberships, composite order, views and sequence configuration.
    """
    from verify_mirror_parity import schema_rows
    result = schema_rows(c)
    result['auth_triggers'] = c.execute("""SELECT t.tgname,pg_get_triggerdef(t.oid),t.tgenabled
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal
      AND n.nspname IN('sa_domain','sa_identity') ORDER BY 1""").fetchall()
    result['storage_policies'] = c.execute("""SELECT policyname,permissive,roles::text,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND (policyname LIKE 'canto_media_%' OR policyname LIKE 'canto_masters_%'
      OR policyname LIKE 'squad_%') ORDER BY 1""").fetchall()
    return canonical(result)


def security_check(c):
    require(not c.execute("""SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='sa_domain' AND
      ((p.prosecdef AND (r.rolsuper OR r.rolbypassrls) AND
      p.oid NOT IN('sa_domain.auth_context()'::regprocedure,'sa_domain.revoke_account_sessions(bigint)'::regprocedure) AND p.oid IS DISTINCT FROM to_regprocedure('sa_domain.self_closure_password_proof()') AND p.oid IS DISTINCT FROM to_regprocedure('sa_domain.revoke_closed_self_sessions(uuid)')
      AND p.oid IS DISTINCT FROM to_regprocedure('sa_domain.account_rehearsal_snapshot(uuid)')
      AND p.oid IS DISTINCT FROM to_regprocedure('sa_domain.account_rehearsal_record(uuid,text,bigint)')
      AND p.oid IS DISTINCT FROM to_regprocedure('sa_domain.account_rehearsal_publish_auth(uuid,uuid)'))
      OR (has_function_privilege('anon',p.oid,'EXECUTE') AND p.oid<>'sa_domain.v1_app_bootstrap(text,text)'::regprocedure))""").fetchone(),
      'Unsafe domain function privileges')
    # The reviewed self-only Auth bridges are never callable by an API principal.
    # Older prefixes legitimately have neither helper; the exact release artifact
    # comparison still binds any installed function body, owner and ACL.
    require(not c.execute("""SELECT 1 FROM pg_proc p WHERE p.oid IN(
      to_regprocedure('sa_domain.self_closure_password_proof()'),
      to_regprocedure('sa_domain.revoke_closed_self_sessions(uuid)')) AND (
      NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres'
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','sa_app','service_role','sa_executor','sa_guard']) role_name
        WHERE has_function_privilege(role_name,p.oid,'EXECUTE'))
      OR NOT has_function_privilege('sa_account_writer',p.oid,'EXECUTE'))""").fetchone(),
      'Unsafe self-closure Auth bridge authority')
    # Exact synthetic account receipts need Auth/source hashes. Only the
    # private account executor may invoke these reviewed bridges; the hosted
    # artifact comparison also binds their bodies, owners, and ACLs.
    require(not c.execute("""SELECT 1 FROM pg_proc p WHERE p.oid IN(
      to_regprocedure('sa_domain.account_rehearsal_snapshot(uuid)'),
      to_regprocedure('sa_domain.account_rehearsal_record(uuid,text,bigint)'),
      to_regprocedure('sa_domain.account_rehearsal_publish_auth(uuid,uuid)')) AND (
      NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres'
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','sa_app','service_role','sa_executor','sa_guard']) role_name
        WHERE has_function_privilege(role_name,p.oid,'EXECUTE'))
      OR NOT has_function_privilege('sa_account_writer',p.oid,'EXECUTE'))""").fetchone(),
      'Unsafe account rehearsal bridge authority')
    require(not c.execute('SELECT 1 FROM pg_roles WHERE rolname=ANY(%s) AND (rolsuper OR rolinherit OR rolcanlogin OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)',
                          (list(PRIVATE_ROLES) + ['sa_app'],)).fetchone(), 'Unsafe private execution role')
    require(not c.execute("""SELECT 1 FROM pg_auth_members WHERE
      pg_get_userbyid(roleid)=ANY(%s) AND pg_get_userbyid(member) IN('anon','authenticated','sa_app','service_role','authenticator')""",
                          (list(PRIVATE_ROLES),)).fetchone(), 'Private role granted to an API principal')


def bootstrap_spec(path, staging_columns):
    if path is None:
        return None
    path = Path(path).resolve()
    require(path.parent == (ROOT / 'tools/squad/sql').resolve(), 'Bootstrap must be a reviewed tools/squad/sql file')
    body = path.read_text()
    nodes = [r.stmt for r in parse_sql(body)]
    from pglast.stream import RawStream
    names = set()
    for node in nodes:
        require(isinstance(node, ast.AlterTableStmt) and node.relation.schemaname == SCHEMA
                and node.relation.relname == 'sa_orders', 'Bootstrap permits only two order-column additions')
        for command in node.cmds:
            require(command.subtype.name == 'AT_AddColumn' and isinstance(command.def_, ast.ColumnDef),
                    'Bootstrap permits only ADD COLUMN')
            col = command.def_
            require(col.colname in COMPANION_COLUMNS and col.colname not in names,
                    'Unexpected or repeated bootstrap column')
            exact = parse_sql('ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN '
                              + COMPANION_DECLARATIONS[col.colname])[0].stmt.cmds[0].def_
            require(RawStream()(col) == RawStream()(exact), 'Unreviewed bootstrap type/default/constraint')
            names.add(col.colname)
    require(names == COMPANION_COLUMNS, 'Bootstrap must declare exactly the two reviewed companion columns')
    expected = [r for r in staging_columns if r[0] == 'sa_orders' and r[1] in names]
    require(len(expected) == 2 and all(r[2] == 'character varying' and not r[5] and not r[6] for r in expected),
            'Staging companion column types differ')
    by_name = {r[1]: r for r in expected}
    require(by_name['dashboard_reservation_id'][3:5] == [False, None]
            and by_name['order_source'][3:5] == [True, "'unicommerce'::character varying"],
            'Staging companion column nullability/defaults differ')
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(body.encode()).hexdigest(),
            'body': body, 'expected_columns': expected}


def apply_bootstrap(c, spec, before_columns):
    if spec is None:
        return []
    if spec.get('collation'):
        align_collations(c, spec['collation'])
    present = {r[1]: r for r in before_columns if r[0] == 'sa_orders' and r[1] in COMPANION_COLUMNS}
    expected = {r[1]: r for r in spec['expected_columns']}
    require(all(row == expected[name] for name, row in present.items()), 'Existing companion column definition differs')
    # Execute one separately parsed ADD COLUMN at a time, omitting only already
    # present exact definitions. Never use IF NOT EXISTS to hide a type mismatch.
    from pglast.stream import RawStream
    for parsed in parse_sql(spec['body']):
        node = parsed.stmt
        for command in node.cmds:
            if command.def_.colname not in present:
                clone = ast.AlterTableStmt(relation=node.relation,cmds=(command,),objtype=node.objtype,missing_ok=False)
                c.execute(RawStream()(clone))
    after = column_catalog(c)
    expected_all = {tuple(r[:2]): r for r in before_columns}
    for row in collation_source_columns(before_columns, spec):
        expected_all[tuple(row[:2])] = row
    expected_all.update({('sa_orders', name): row for name, row in expected.items()})
    require({tuple(r[:2]): r for r in after} == expected_all, 'Bootstrap changed existing or unexpected source columns')
    added = sorted(COMPANION_COLUMNS - set(present))
    check_added_values(c, added)
    return added


def check_added_values(c, added):
    for name in added:
        expected = None if name == 'dashboard_reservation_id' else 'unicommerce'
        require(not c.execute(sql.SQL('SELECT 1 FROM {}.sa_orders WHERE {} IS DISTINCT FROM %s LIMIT 1')
                              .format(sql.Identifier(SCHEMA), sql.Identifier(name)), (expected,)).fetchone(),
                'Unreviewed companion-column value')


def assert_columns_unchanged(c, before_columns, spec, added):
    current = {tuple(r[:2]): r for r in column_catalog(c)}
    expected = {tuple(r[:2]): r for r in before_columns}
    if spec:
        expected.update({tuple(r[:2]): r for r in collation_source_columns(before_columns, spec)})
        expected.update({tuple(r[:2]): r for r in spec['expected_columns']})
    require(current == expected, 'Release changed imported source column definitions')
    check_added_values(c, added)


def collation_spec(path, staging_columns):
    """Only the exact legacy C.utf8 -> database-default type-preserving change."""
    path = Path(path).resolve()
    require(path == (ROOT / 'tools/squad/sql/production_collation_compatibility.sql').resolve(),
            'Unreviewed collation bootstrap path')
    from pglast.stream import RawStream
    body = path.read_text()
    available = {tuple(r[:3]): r for r in staging_columns}
    rows = []
    for parsed in parse_sql(body):
        node = parsed.stmt
        require(isinstance(node, ast.AlterTableStmt) and len(node.cmds) == 1,
                'Collation bootstrap must contain single-column ALTER TABLE statements')
        key = (node.relation.schemaname, node.relation.relname, node.cmds[0].name)
        require(key in available and key[0] in (SCHEMA, 'sa_identity'), 'Unknown collation column')
        row = available[key]
        require(row[9] == '"default"', 'Staging collation differs from reviewed target')
        expected = 'ALTER TABLE {}.{} ALTER COLUMN {} TYPE {} COLLATE pg_catalog."default"'.format(
            *(('"' + value.replace('"', '""') + '"') for value in key), row[4])
        require(RawStream()(node) == RawStream()(parse_sql(expected)[0].stmt),
                'Collation bootstrap may not cast, rewrite values or change types')
        rows.append(list(key) + [row[4]])
    keys = [tuple(r[:3]) for r in rows]
    require(len(keys) == 155 and len(set(keys)) == 155
            and sum(k[0] == SCHEMA for k in keys) == 151
            and {k[2] for k in keys if k[0] == 'sa_identity'} == {
                'canonical_email', 'confirmation_basis', 'enrollment_state', 'import_disposition'}
            and all(k[1] == 'sa_auth_identities' for k in keys if k[0] == 'sa_identity'),
            'Collation bootstrap must match the reviewed 151 source and 4 identity columns')
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(body.encode()).hexdigest(),
            'columns': rows, 'staging_columns': [available[k] for k in keys]}


def align_collations(c, spec):
    for schema, table, column, typename in spec['columns']:
        row = c.execute("""SELECT format_type(a.atttypid,a.atttypmod),a.attcollation::regcollation::text
          FROM pg_attribute a WHERE a.attrelid=%s::regclass AND a.attname=%s AND NOT a.attisdropped""",
                        (schema + '.' + table, column)).fetchone()
        require(row in ((typename, '"C.utf8"'), (typename, '"default"')), 'Unreviewed original collation/type')
        if row[1] == '"C.utf8"':
            c.execute(sql.SQL('ALTER TABLE {}.{} ALTER COLUMN {} TYPE {} COLLATE pg_catalog."default"')
                      .format(sql.Identifier(schema), sql.Identifier(table), sql.Identifier(column), sql.SQL(typename)))


def collation_source_columns(before, spec):
    keys = {(r[1], r[2]) for r in (spec or {}).get('collation', {}).get('columns', []) if r[0] == SCHEMA}
    return [row[:7] + ['"default"'] for row in before if tuple(row[:2]) in keys]


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if tmp.exists(): tmp.unlink()


def checkpoint_path(environment):
    return PRIVATE / ('release-mirror-' + environment + '.json')


def baseline_publish(environment, receipt, baseline_dir=BASELINES):
    for suffix in ('catalog', 'domain-access'):
        atomic_json(baseline_dir / (environment + '-' + suffix + '.json'), receipt['after'][suffix])


def reference(release):
    with connect('staging', readonly=True) as c, c.transaction():
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        require(c.execute('SELECT environment FROM sa_sync.environment_state WHERE singleton').fetchone() == ('staging',),
                'Wrong staging reference')
        check_catalog(c, 'staging')
        verify_history(history(c), release, complete=True)
        return {'artifacts': artifact_catalog(c), 'columns': column_catalog(c)}


def locked(c, environment):
    c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    require(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0], 'Refresh or writes are active')
    c.execute('LOCK TABLE sa_sync.environment_state IN ACCESS EXCLUSIVE MODE')
    state = environment_state(c, environment)
    columns, projection = source_projection(c)
    c.execute(sql.SQL('LOCK TABLE {} IN SHARE MODE').format(sql.SQL(',').join(
        sql.Identifier(SCHEMA, table) for table in projection)))
    return state, columns, projection


def execute_release(c, environment, release, expected, spec, *, check=True, receipt_path=None):
    """Caller supplies an autocommit connection. Every DB mutation is atomic."""
    result = None
    with c.transaction():
        if not check:
            require(receipt_path is not None and not receipt_path.exists(), 'Unresolved release receipt; recover first')
        progress('acquiring mirror/refresh locks and validating target catalog')
        state, columns, projection = locked(c, environment)
        check_catalog(c, environment)
        old_history = history(c)
        verify_history(old_history, release, complete=False)
        progress('capturing original source, Auth, public data and sequence digests')
        before = {'public_structure': public_structure(c), 'data': protected_data(c, projection),
                  'columns': columns, 'schedules': cron_state(c), 'environment': state,
                  'catalog': canonical(catalog(c))}
        applied, added = [], apply_bootstrap(c, spec, columns)
        progress('executing reviewed migration prefix')
        for number, migration in enumerate(release, 1):
            if migration.version in old_history:
                continue
            # pglast handles function-body semicolons; only top-level BEGIN and
            # COMMIT are removed. One ordered batch avoids thousands of network
            # round trips while retaining the same outer atomic transaction.
            batch = ';\n'.join(statements(migration.body)) + ';'
            try:
                c.execute(batch)
            except psycopg.Error as error:
                # Do not print SQL/value/error detail, which may contain data.
                raise RuntimeError('Migration failed: ' + migration.filename + ' SQLSTATE=' + str(error.sqlstate)) from None
            c.execute('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(%s,%s,%s)',
                      (migration.version, migration.name, [migration.body]))
            applied.append(migration.filename)
            if number % 20 == 0 or number == len(release):
                progress('applied migrations ' + str(number) + '/' + str(len(release)))
        progress('checking protected data, mirror state, permissions and staging artifact parity')
        assert_columns_unchanged(c, columns, spec, added)
        require(public_structure(c) == before['public_structure'], 'Public structure changed')
        allowed_buckets = set(NEW_BUCKETS) - set(before['data']['buckets'])
        require(protected_data(c, projection, allowed_buckets) == before['data'], 'Protected source/Auth/public/media data or sequences changed')
        require(cron_state(c) == before['schedules'], 'Existing schedules changed')
        require(environment_state(c, environment) == state, 'Mirror ownership/revision state changed')
        security_check(c)
        actual_artifacts = artifact_catalog(c)
        if actual_artifacts != expected:
            differences = {}
            for key in sorted(set(expected) | set(actual_artifacts)):
                wanted = {json.dumps(row, sort_keys=True) for row in expected.get(key, [])}
                found = {json.dumps(row, sort_keys=True) for row in actual_artifacts.get(key, [])}
                if wanted != found:
                    differences[key] = {
                        'staging_only': [json.loads(row) for row in sorted(wanted - found)],
                        'target_only': [json.loads(row) for row in sorted(found - wanted)],
                    }
            atomic_json(PRIVATE / ('release-mirror-' + environment + '-differences.json'), differences)
        require(actual_artifacts == expected, 'New Squad artifacts differ from the reviewed staging catalog')
        after = {'catalog': canonical(catalog(c)), 'domain-access': access_catalog(c),
                 'artifacts_sha256': digest(actual_artifacts)}
        result = {'format': 1, 'environment': environment, 'project_ref': PROJECTS[environment],
                  'through': release[-1].version, 'created_at': datetime.now(timezone.utc).isoformat(),
                  'migrations': [{'version': m.version, 'name': m.name, 'sha256': m.sha256} for m in release],
                  'previous_squad_versions': [m.version for m in release if m.version in old_history],
                  'bootstrap': None if spec is None else {k: v for k, v in spec.items() if k != 'body'},
                  'added_columns': added, 'projection': projection, 'before': before, 'after': after,
                  'applied': applied, 'mode': 'rollback verification' if check else 'commit prepared'}
        if check:
            progress('all release checks passed; rolling back verification transaction')
            raise psycopg.Rollback()
        require(receipt_path is not None, 'A durable recovery receipt is required before commit')
        atomic_json(receipt_path, result)
        progress('durable recovery receipt written; committing verified transaction')
    return result


def recovery_data_check(actual, expected, allow_presence_heartbeat=False):
    if actual == expected:
        return []
    # The live Printing Tracker publishes presence independently of this release.
    # This is an explicit post-commit recovery exception, never a relaxation of
    # the transaction's before/after preservation guard or of Auth/business data.
    candidate = canonical(actual)
    old = expected.get('public', {}).get('hr_user_presence')
    new = actual.get('public', {}).get('hr_user_presence')
    require(allow_presence_heartbeat and old is not None and new is not None
            and old['rows'] == new['rows'], 'Protected data changed since release')
    candidate['public']['hr_user_presence'] = old
    require(candidate == expected, 'Protected data changed beyond the reviewed presence heartbeat')
    return ['public.hr_user_presence']


def recover(environment, through, release, expected, receipt_path=None, *, allow_presence_heartbeat=False):
    path = receipt_path or checkpoint_path(environment)
    require(path.is_file(), 'No release recovery receipt exists')
    saved = json.loads(path.read_text())
    require(saved.get('format') == 1 and saved.get('environment') == environment
            and saved.get('project_ref') == PROJECTS[environment] and saved.get('through') == through,
            'Recovery receipt target differs')
    require(saved['migrations'] == [{'version': m.version, 'name': m.name, 'sha256': m.sha256} for m in release],
            'Local reviewed migration set changed; explicit review required')
    spec = None
    if saved['bootstrap']:
        spec = bootstrap_spec(ROOT / saved['bootstrap']['path'], saved['bootstrap']['expected_columns'])
        require(spec['sha256'] == saved['bootstrap']['sha256'], 'Bootstrap changed after prepared commit')
        if saved['bootstrap'].get('collation'):
            old = saved['bootstrap']['collation']
            spec['collation'] = collation_spec(ROOT / old['path'], old['staging_columns'])
            require(spec['collation'] == old, 'Collation bootstrap changed after prepared commit')
    with connect(environment) as c, c.transaction():
        progress('checking exact durable before/after state for baseline recovery')
        state, columns, _ = locked(c, environment)
        rows = history(c)
        verify_history(rows, release, complete=False)
        current = [m.version for m in release if m.version in rows]
        require(state == saved['before']['environment'], 'Environment changed after interrupted release')
        require(public_structure(c) == saved['before']['public_structure'], 'Public structure changed since release')
        allowed_buckets = set(NEW_BUCKETS) - set(saved['before']['data']['buckets'])
        live_data = protected_data(c, saved['projection'], allowed_buckets)
        operational_changes = recovery_data_check(live_data, saved['before']['data'], allow_presence_heartbeat)
        require(cron_state(c) == saved['before']['schedules'], 'Schedules changed since release')
        if current == [m.version for m in release] and canonical(catalog(c)) == saved['after']['catalog']:
            assert_columns_unchanged(c, saved['before']['columns'], spec, saved['added_columns'])
            security_check(c)
            actual = artifact_catalog(c)
            require((expected is None or actual == expected) and digest(actual) == saved['after']['artifacts_sha256'],
                    'Committed artifacts differ; cannot publish a baseline')
            require(access_catalog(c) == saved['after']['domain-access'], 'Committed access catalog changed')
            baseline_publish(environment, saved)
            check_catalog(c, environment)
            outcome = 'committed release baselines recovered'
        elif current == saved['previous_squad_versions'] and canonical(catalog(c)) == saved['before']['catalog']:
            require(not operational_changes, 'Presence exception requires an exact committed release')
            require(columns == saved['before']['columns'], 'Rolled-back source columns differ')
            check_catalog(c, environment)
            outcome = 'transaction did not commit; existing baselines retained'
        else:
            raise RuntimeError('Release outcome is not an exact before/after state; explicit review required')
    report = {'environment': environment, 'through': through, 'mode': outcome,
              'reviewed_post_commit_operational_changes': operational_changes}
    atomic_json(PRIVATE / ('release-mirror-' + environment + '-verified-' + through + '.json'), saved)
    atomic_json(PRIVATE / ('release-mirror-' + environment + '-recovery.json'), report)
    path.unlink()
    return report


def run(environment, through, *, apply=False, bootstrap=None, collation_bootstrap=None, recover_baselines=False, accept_presence_heartbeat=False):
    require(environment in PROJECTS, 'Explicit staging or production environment required')
    release = migrations(through)
    path = checkpoint_path(environment)
    if recover_baselines:
        require(not apply and bootstrap is None and collation_bootstrap is None, 'Recovery cannot execute migrations or new bootstrap SQL')
        # The prepared receipt binds the already-reviewed staging artifact hash.
        # A later independent staging release must not prevent recovery of this
        # exact committed target. Local immutable migration bodies still match.
        return recover(environment, through, release, None, path, allow_presence_heartbeat=accept_presence_heartbeat)
    require(not accept_presence_heartbeat or apply, 'Presence exception is only allowed after an explicit committed release')
    progress('verifying exact staging migration bodies and reference catalog')
    reviewed = reference(release)
    require(not path.exists(), 'Unresolved release receipt: use --recover-baselines, never bypass or blanket rerun')
    spec = bootstrap_spec(bootstrap, reviewed['columns'])
    if collation_bootstrap:
        require(environment == 'production' and spec is not None, 'Collation bootstrap requires explicit production compatibility bootstrap')
        spec['collation'] = collation_spec(collation_bootstrap, reviewed['artifacts']['columns'])
    with connect(environment) as c:
        result = execute_release(c, environment, release, reviewed['artifacts'], spec, check=not apply, receipt_path=path)
    operational_changes = []
    if apply:
        # Re-enter the exact recovery verifier even on the normal success path.
        # A filesystem or commit-response failure leaves the same durable path.
        recovered = recover(environment, through, release, reviewed['artifacts'], path,
                            allow_presence_heartbeat=accept_presence_heartbeat)
        operational_changes = recovered['reviewed_post_commit_operational_changes']
    return {'environment': environment, 'through': through, 'mode': 'applied' if apply else 'rollback verification',
            'migrations': result['applied'], 'added_companion_columns': result['added_columns'],
            'source_tables_verified': len(result['projection']), 'protected_data_unchanged': True,
            'aligned_legacy_collations': len((spec or {}).get('collation', {}).get('columns', [])),
            'reviewed_post_commit_operational_changes': operational_changes,
            'public_structure_unchanged': True, 'cutover': False,
            'staging_artifacts_sha256': result['after']['artifacts_sha256']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=tuple(PROJECTS))
    parser.add_argument('--through', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--bootstrap', help='Explicit reviewed two-column bootstrap SQL under tools/squad/sql')
    parser.add_argument('--collation-bootstrap', help='Explicit reviewed production pre-domain collation alignment')
    parser.add_argument('--recover-baselines', action='store_true')
    parser.add_argument('--accept-presence-heartbeat', action='store_true', help='Accept reviewed same-count public.hr_user_presence activity only in post-commit baseline recovery')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.environment, args.through, apply=args.apply,
                             bootstrap=args.bootstrap, collation_bootstrap=args.collation_bootstrap,
                             recover_baselines=args.recover_baselines,
                             accept_presence_heartbeat=args.accept_presence_heartbeat)))
    except Exception as error:
        # Exception detail from an SQL command may contain row values or secrets.
        if isinstance(error, RuntimeError): print(str(error), file=sys.stderr)
        else: print('Release failed (' + type(error).__name__ + '); inspect the private recovery receipt', file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
