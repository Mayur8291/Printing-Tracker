#!/usr/bin/env python3
"""Show recorded outcomes; optional hosted commit journal for ambiguous outcomes."""
import argparse,json
from snapshot import ROOT
from management import query
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--remote',action='store_true');args=p.parse_args()
for environment in ['staging','production']:
    if args.remote:
        rows=query(environment,"""select run_id,environment,committed_at,
          report->>'operation' operation,report->>'rows' rows,report->>'users' users,
          report->'capture'->>'started_at' source_capture,
          report->>'public_schema_unchanged' public_schema_unchanged,
          report->>'staff_auth_unchanged' staff_auth_unchanged,
          report->'auth_enrollment' auth_enrollment
          from sa_sync.refresh_runs order by committed_at desc limit 3""")
        print(json.dumps({'environment':environment,'recent_commits':rows}));continue
    reports=[]
    for path in (ROOT/'private').glob(environment+'_*/report_*.json'):
        record=json.loads(path.read_text())
        if record.get('environment')==environment:reports.append((record.get('run_id',''),path,record))
    good=sorted(x for x in reports if x[2]['status']=='success')
    if good:
        _,path,r=good[-1]
        print(json.dumps({'environment':environment,'last_success':r['finished_at'],
            'source_capture':r['capture']['started_at'],'tables':r['tables'],'rows':r['rows'],
            'users':r['users'],'report':str(path),'auth_enrollment':r.get('auth_enrollment')}))
    else:print(json.dumps({'environment':environment,'last_success':None}))
