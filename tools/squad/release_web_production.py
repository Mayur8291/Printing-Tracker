"""Exact production schedule envelope for the reviewed mirror SQL release.

Rollback verification is the default; --apply is explicit. No Edge deployment,
provider configuration, data refresh or ownership change is performed here.
A schedule checkpoint precedes pausing. If SQL commit/baseline recovery remains
unresolved, schedules stay paused: recover that exact receipt before restoring
its recorded schedule state. The existing staging release path is unchanged.
"""
import argparse
import json
import re
import time

import release_mirror as mirror
from database import connect
from snapshot import require

CHECKPOINT = mirror.ROOT / 'tools/squad/private/web-release-production-schedules.json'
FORMAT = 'squad-production-schedule-release/v1'
NAMES = ('squad-jobs-minute', 'squad-documents-pump', 'squad-media-cleanup')


def release_identity(through):
    return [{'version': m.version, 'sha256': m.sha256} for m in mirror.migrations(through)]


def validate(state, through, identity):
    require(set(state) == {'format', 'environment', 'through', 'migrations', 'all_schedules'},
            'Unexpected production schedule checkpoint fields')
    require(state['format'] == FORMAT and state['environment'] == 'production'
            and state['through'] == through and state['migrations'] == identity,
            'Schedule checkpoint does not match the exact production release')
    rows = state['all_schedules']
    require(isinstance(rows, list) and all(
        isinstance(r, list) and len(r) == 4 and type(r[0]) is int and r[0] > 0
        and isinstance(r[1], str) and type(r[2]) is bool
        and isinstance(r[3], str) and re.fullmatch(r'[a-f0-9]{64}', r[3])
        for r in rows), 'Invalid schedule receipt')
    require(len({r[0] for r in rows}) == len(rows) and rows == sorted(rows, key=lambda r: r[0]),
            'Duplicate or unordered schedule receipt')
    owned = [r for r in rows if r[1] in NAMES]
    require(len(owned) == len(NAMES) and {r[1] for r in owned} == set(NAMES),
            'Expected exactly three owned schedules')
    return state


def assert_environment(c):
    require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state WHERE singleton').fetchone()
            == ('production', False, None), 'Requires idle production mirror')
    require(c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state WHERE singleton').fetchone()
            == (False, [], None), 'Rehearsal writes must be disabled')


def restore(through, identity):
    require(not mirror.checkpoint_path('production').exists(),
            'Resolve the production SQL release receipt before restoring schedules')
    state = validate(json.loads(CHECKPOINT.read_text()), through, identity)
    with connect('production') as c, c.transaction():
        require(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],
                'Refresh/release active; schedule checkpoint retained')
        require(not mirror.checkpoint_path('production').exists(),
                'SQL release receipt appeared; resolve it before restoring schedules')
        assert_environment(c)
        current = mirror.cron_state(c)
        require([(r[0], r[1]) for r in current] == [(r[0], r[1]) for r in state['all_schedules']],
                'Schedule identities changed; no restoration performed')
        for job_id, name, active, digest in state['all_schedules']:
            # Normalize only the active flag before comparing the full saved
            # row, exactly as the existing staging wrapper does.
            original = c.execute("SELECT encode(sha256(convert_to(((to_jsonb(j)-'active')||jsonb_build_object('active',%s::boolean))::text,'UTF8')),'hex') FROM cron.job j WHERE jobid=%s AND jobname=%s",
                                 (active, job_id, name)).fetchone()
            require(original == (digest,), 'Schedule definitions changed; checkpoint retained')
        for job_id, name, active, _ in state['all_schedules']:
            if name in NAMES:
                c.execute('SELECT cron.alter_job(%s,active:=%s)', (job_id, active))
        require(mirror.cron_state(c) == state['all_schedules'], 'Exact schedule restoration failed')
    # A commit-response failure leaves this file for a repeatable exact restore.
    CHECKPOINT.unlink()
    return {'environment': 'production', 'through': through, 'exact_schedules_restored': True}


def run(environment, through, *, apply=False, recover=False):
    require(environment == 'production', 'Explicit production environment required')
    require(not (apply and recover), 'Recovery cannot apply migrations')
    identity = release_identity(through)  # Validate cutoff before any connection.
    sql_receipt = mirror.checkpoint_path('production')
    if recover:
        require(CHECKPOINT.exists(), 'No production schedule checkpoint to recover')
        validate(json.loads(CHECKPOINT.read_text()), through, identity)
        if sql_receipt.exists():
            mirror.run('production', through, recover_baselines=True)
        return restore(through, identity)
    require(not CHECKPOINT.exists(), 'Recover outstanding production schedules first')
    require(not sql_receipt.exists(), 'Recover outstanding production SQL receipt first')
    saved = False
    try:
        with connect('production') as c, c.transaction():
            require(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],
                    'Refresh/release active')
            require(not CHECKPOINT.exists() and not sql_receipt.exists(),
                    'Release checkpoint appeared while acquiring the lock')
            assert_environment(c)
            state = {'format': FORMAT, 'environment': 'production', 'through': through,
                     'migrations': identity, 'all_schedules': mirror.cron_state(c)}
            validate(state, through, identity)
            mirror.atomic_json(CHECKPOINT, state)
            saved = True
            for job_id, name, _, _ in state['all_schedules']:
                if name in NAMES:
                    c.execute('SELECT cron.alter_job(%s,active:=false)', (job_id,))
        print('Paused three production Squad schedules; allowing in-flight calls to drain', flush=True)
        time.sleep(15)
        result = mirror.run('production', through, apply=apply)
        require(not sql_receipt.exists(), 'Release returned with an unresolved SQL receipt')
        return {'release': result, 'exact_schedules_restored': True}
    finally:
        if saved:
            if sql_receipt.exists():
                # Never erase the recovery state or restore before the SQL
                # receipt resolves. The guarded release checks active leases.
                print('SQL release recovery is unresolved; production schedules remain paused and both checkpoints are retained', flush=True)
            else:
                restore(through, identity)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=['production'])
    parser.add_argument('--through', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(args.environment, args.through, apply=args.apply, recover=args.recover)))
