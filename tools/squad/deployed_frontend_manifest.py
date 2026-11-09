"""Explicit reviewed cloud build receipt; never infer a release from current HTML.

This binds entry bytes to a separately reviewed Git/Vercel release receipt. It
is not independent proof of Vercel's source provenance or all lazy chunk hashes.
"""
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

FORMAT='squad-reviewed-deployed-frontend/v1'
def deployed_base(value):
    u=urlsplit(value)
    assert u.scheme=='https' and not u.username and not u.password and not u.query and not u.fragment and u.path in ('','/') and u.port is None,'Exact HTTPS deployment origin required'
    assert u.hostname=='scottdashboard.vercel.app' or re.fullmatch(r'scottdashboard-[a-z0-9-]+-mayur8291s-projects\.vercel\.app',u.hostname or ''),'Deployment host is not allowlisted'
    return 'https://'+u.hostname

def validate_release(value):
    assert isinstance(value,dict) and set(value)=={'format','base','entry_path','entry_sha256','git_commit','deployment_id'},'Invalid reviewed deployment receipt'
    assert value['format']==FORMAT
    assert deployed_base(value['base'])==value['base'],'Canonical deployment origin required'
    assert re.fullmatch(r'/assets/index-[A-Za-z0-9_-]+\.js',value['entry_path']),'Built deployment entry required'
    assert re.fullmatch(r'[0-9a-f]{64}',value['entry_sha256'])
    assert re.fullmatch(r'[0-9a-f]{40}',value['git_commit']),'Full reviewed Git commit required'
    assert re.fullmatch(r'dpl_[A-Za-z0-9]{8,100}',value['deployment_id']),'Reviewed Vercel deployment ID required'
    return value

def load_release(filename,base):
    raw=Path(filename).read_bytes();assert len(raw)<=8192,'Deployment receipt exceeds bound'
    value=validate_release(json.loads(raw));assert deployed_base(base)==value['base'],'Receipt targets another origin'
    return value

def release_frontend(value):
    validate_release(value)
    return {k:value[k] for k in ('base','entry_path','entry_sha256')}
