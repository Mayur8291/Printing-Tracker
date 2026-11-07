"""Rebuild the CLI-created migration from reviewed SQL and immutable master contracts."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DESTINATION = ROOT.parents[1] / 'supabase/migrations/20261107045242_canto_admin_masters.sql'
def build():
    contracts = json.loads((ROOT / 'master-contracts.json').read_text())
    for resource,spec in contracts.items():
        for target in spec['references'].values():
            assert target in contracts, 'Unknown reference: ' + resource + ' -> ' + target
    rows = ["('%s','%s'::jsonb)" % (name, json.dumps(spec, separators=(',', ':')).replace("'", "''"))
            for name, spec in contracts.items()]
    seed = '\nINSERT INTO sa_admin.master_contracts(resource,spec) VALUES\n' + ',\n'.join(rows)
    seed += '\nON CONFLICT(resource) DO UPDATE SET spec=excluded.spec;\n'
    DESTINATION.write_text((ROOT / 'masters-api.sql').read_text() + seed)
if __name__ == '__main__':
    build()
