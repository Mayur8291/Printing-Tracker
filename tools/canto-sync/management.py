"""Management API transport. Credentials stay in memory; never log response secrets."""
import json, os, subprocess, urllib.request

PROJECTS = {'production': 'levwrmvqdntngeasrtnb', 'staging': 'scvojtvgnkmbupvyslmb'}

def token():
    if os.environ.get('SUPABASE_ACCESS_TOKEN'):
        return os.environ['SUPABASE_ACCESS_TOKEN']
    return subprocess.check_output(['security','find-generic-password','-a','kundan9595gmail.com',
        '-s','codex-printing-tracker-supabase','-w'], text=True).strip()

def api(environment, path, body=None, method=None):
    ref = PROJECTS[environment]
    req = urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+path,
        data=None if body is None else json.dumps(body).encode(), method=method,
        headers={'Authorization':'Bearer '+token(),'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=90) as response:
        raw=response.read()
        return json.loads(raw) if raw else None

def query(environment, sql, readonly=True):
    return api(environment, '/database/query'+('/read-only' if readonly else ''), {'query':sql})
