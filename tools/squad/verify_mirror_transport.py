"""Exercise pg_net -> each environment's paused worker, without provider work."""
import datetime
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/canto-sync'))
from database import connect
from management import PROJECTS
from snapshot import require


def run():
    results = {}
    for env, ref in PROJECTS.items():
        with connect(env) as c:
            require(c.execute('SELECT pg_try_advisory_lock_shared(20261107,1)').fetchone()[0], 'Release or refresh active')
            try:
                require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone() == (env, False, None), 'Not an idle mirror')
                require(c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone() == (False, [], None), 'Rehearsal active')
                require(c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0] == 0, 'Pending queue')
                version = c.execute("SELECT extversion FROM pg_extension WHERE extname='pg_net'").fetchone()[0]
                started = time.monotonic()
                request_id = c.execute("""SELECT net.http_post(
                  url := %s,
                  headers := jsonb_build_object('Content-Type','application/json','Authorization',
                    'Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret')),
                  body := '{"limit":1}'::jsonb, timeout_milliseconds := 15000)""",
                    ('https://' + ref + '.supabase.co/functions/v1/squad-jobs/run',)).fetchone()[0]
                response = None
                for _ in range(25):
                    response = c.execute('SELECT status_code,content FROM net._http_response WHERE id=%s', (request_id,)).fetchone()
                    if response:
                        break
                    time.sleep(1)
                require(response is not None and response[0] == 200, 'pg_net worker transport did not succeed')
                require(json.loads(response[1]) == {'paused': True, 'results': []}, 'Worker was not paused')
                require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone() == (env, False, None), 'Mirror ownership changed')
                require(c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0] == 0, 'Queue changed')
                results[env] = {'pg_net_version': version, 'status': response[0], 'paused': True,
                                'provider_effects': False, 'elapsed_ms': round((time.monotonic()-started)*1000, 1)}
            finally:
                c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
    report = {'measured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'checks': results, 'scope': 'One real pg_net HTTP request to each paused worker; no refresh, login fixtures or provider work'}
    (ROOT / 'docs/squad-one-audit/implementation-evidence/backend-mirror-transport.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    run()
