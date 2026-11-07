"""Management API transport. Credentials stay in memory; never log response secrets."""
import http.client,json,os,subprocess,time,urllib.error,urllib.request

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
    # Read operations and temporary connection-credential provisioning can retry.
    # Never blindly replay arbitrary SQL writes or other management mutations.
    retryable=req.get_method()=='GET' or path in ('/database/query/read-only','/cli/login-role')
    attempts=3 if retryable else 1
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                raw=response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            if error.code not in (408,429,500,502,503,504) or attempt==attempts-1:raise
        except (OSError,http.client.IncompleteRead):
            if attempt==attempts-1:raise
        time.sleep(2**attempt)

def query(environment, sql, readonly=True):
    return api(environment, '/database/query'+('/read-only' if readonly else ''), {'query':sql})
