"""Claim exactly one authorized dashboard job; journal every stage without exposing data."""
import datetime, json, os, shutil, threading, time, uuid
from pathlib import Path
from psycopg.types.json import Jsonb
from database import connect, CONFIG
from delta_sync import run
from encrypted_backup import upload
from snapshot import ROOT, require

os.umask(0o077)

def configure():
    CONFIG.mkdir(parents=True,exist_ok=True,mode=0o700)
    for name in ['known_hosts','prod-supabase.cer']:
        if not (CONFIG/name).exists(): shutil.copyfile(ROOT/'config'/name,CONFIG/name)
    if os.environ.get('CANTO_EXPORT_SSH_KEY'):
        (CONFIG/'source_ed25519').write_text(os.environ['CANTO_EXPORT_SSH_KEY'].rstrip()+'\n')
        (CONFIG/'source_ed25519').chmod(0o600)

def main():
    environment=os.environ['CANTO_ENVIRONMENT']; job_id=str(uuid.UUID(os.environ['CANTO_JOB_ID']))
    require(environment in ['staging','production'],'Invalid environment');configure()
    stopped=threading.Event()
    with connect(environment) as status:
        with status.transaction():
            job=status.execute("SELECT requested_by,discard_revision FROM sa_sync.jobs WHERE id=%s AND environment=%s AND status='queued' FOR UPDATE",(job_id,environment)).fetchone()
            if not job:
                print('Job already claimed or no longer authorized.',flush=True);return
            actor=status.execute("SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=%s AND u.role='authenticated' AND (u.banned_until IS NULL OR u.banned_until<now()) AND (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id AND p.role='admin') OR EXISTS(SELECT 1 FROM public.admin_emails a WHERE lower(a.email)=lower(u.email))))",(job[0],)).fetchone()[0]
            require(actor,'Requesting administrator no longer has access')
            status.execute("UPDATE sa_sync.jobs SET status='running',stage='starting',started_at=now(),heartbeat_at=now(),github_run_id=%s WHERE id=%s",(os.environ.get('CANTO_GITHUB_RUN_ID'),job_id))
        def progress(stage, detail):
            # Only aggregate counts and the run identifier go into the public-to-admin status.
            status.execute('UPDATE sa_sync.jobs SET stage=%s,heartbeat_at=now(),run_id=coalesce(%s,run_id),summary=coalesce(summary,\'{}\'::jsonb)||%s WHERE id=%s',
                (stage,detail.get('run_id'),Jsonb(detail),job_id))
            print('Refresh stage: '+stage,flush=True)
        def heartbeat():
            while not stopped.wait(30):
                try:
                    with connect(environment) as conn: conn.execute("UPDATE sa_sync.jobs SET heartbeat_at=now() WHERE id=%s AND status='running'",(job_id,))
                except Exception: pass # Stage writes and final reconciliation remain authoritative.
        thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
        try:
            def backup(conn,directory,report):
                result=upload(environment,job_id,directory)
                status.execute('UPDATE sa_sync.jobs SET backup_prefix=%s,heartbeat_at=now() WHERE id=%s',(result['prefix'],job_id))
                return result
            report=run(environment,progress=progress,backup=backup,discard_revision=job[1],job_id=job_id)
            summary={k:report[k] for k in ['changes','tables','rows','users','auth_enrollment','public_schema_unchanged','staff_auth_unchanged']}
            with status.transaction():
                status.execute("UPDATE sa_sync.jobs SET status='succeeded',stage='verified',finished_at=now(),heartbeat_at=now(),summary=%s,message=NULL WHERE id=%s",(Jsonb(summary),job_id))
                status.execute('UPDATE sa_sync.environment_state SET active_job=NULL,updated_at=now() WHERE active_job=%s',(job_id,))
            print('Refresh verified and committed.',flush=True)
        except Exception as error:
            # A network failure after COMMIT is resolved from the transaction's own journal.
            with connect(environment) as conn:
                committed=conn.execute("SELECT report FROM sa_sync.refresh_runs WHERE report->>'job_id'=%s",(job_id,)).fetchone()
                with conn.transaction():
                    conn.execute("UPDATE sa_sync.jobs SET status=%s,stage=%s,finished_at=now(),message=%s WHERE id=%s",
                        ('succeeded' if committed else 'failed','verified' if committed else 'failed',None if committed else 'Refresh stopped before verified publication ('+type(error).__name__+'). The previous data remains available.',job_id))
                    conn.execute('UPDATE sa_sync.environment_state SET active_job=NULL,updated_at=now() WHERE active_job=%s',(job_id,))
            if not committed: raise RuntimeError('Refresh failed; consult the admin job status.') from None
        finally: stopped.set();thread.join(timeout=2)

if __name__=='__main__': main()
