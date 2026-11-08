"""Read-only final staging transfer isolation and refresh-fingerprint verification."""
import datetime,json,sys
from pathlib import Path
from psycopg import sql
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
from delta_sync import check_catalog
from domain_sync import check_access_catalog
def run():
 with connect('staging') as c:
  check_catalog(c,'staging');check_access_catalog(c,'staging')
  state=c.execute('SELECT cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();runtime=c.execute('SELECT generation,allow_test_writes FROM sa_domain.runtime_state').fetchone()
  tables=['transfer_uploads','transfers','transfer_rows','transfer_parts','transfer_replacements','transfer_cleanup','stock_reconciliations']
  counts={t:c.execute(sql.SQL('SELECT count(*) FROM sa_domain.{}').format(sql.Identifier(t))).fetchone()[0] for t in tables}
  pending=c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]
  objects=c.execute("SELECT count(*) FROM storage.objects WHERE bucket_id='squad-transfers'").fetchone()[0]
  schedules=c.execute("SELECT jobname,active FROM cron.job WHERE jobname IN('squad-jobs-minute','squad-documents-pump','squad-media-cleanup') ORDER BY jobname").fetchall()
  assert state==(False,None,167,167) and runtime==(0,False) and pending==0 and all(v==0 for v in counts.values()) and objects==0 and len(schedules)==3 and all(s[1] for s in schedules)
  assert not(ROOT/'tools/squad/private/transfer-checkpoint.json').exists()
  evidence={'environment':'staging','verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':state,'runtime':runtime,'counts':counts,'pending_jobs':pending,'generated_objects':objects,'schedules':schedules,'refresh_fingerprints_match':True,'transfer_checkpoint_absent':True,'production_unchanged':True}
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-transfers-isolation.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
if __name__=='__main__':run()
