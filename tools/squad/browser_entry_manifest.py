"""Bound an exact local application entry before any hosted fixture is created."""
import hashlib
import re
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit
from deployed_frontend_manifest import deployed_base, validate_release, release_frontend


def loopback_base(value):
    assert isinstance(value,str),'Frontend must be a URL string'
    u=urlsplit(value)
    assert u.scheme=='http' and u.hostname in ('localhost','127.0.0.1'),'Frontend must be loopback HTTP'
    assert not u.username and not u.password and not u.query and not u.fragment and u.path in ('','/'),'Frontend must have no credentials, query or path'
    assert u.port is not None and 0<u.port<=65535,'Explicit frontend port required'
    return f'http://{u.hostname}:{u.port}'


def validate_frontend(value,release=None):
    assert isinstance(value,dict) and set(value)=={'base','entry_path','entry_sha256'},'Invalid frontend binding'
    if release is None:assert loopback_base(value['base'])==value['base']
    else:assert value==release_frontend(release),'Frontend differs from reviewed release'
    assert re.fullmatch(r'/(?:assets/index-[A-Za-z0-9_-]+\.js|src/main\.jsx(?:\?t=\d{10,16})?)',value['entry_path']),'Unsupported application entry'
    assert re.fullmatch(r'[0-9a-f]{64}',value['entry_sha256']),'Invalid entry digest'
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise AssertionError('Frontend redirects are not allowed')


def frontend_preflight(base,release=None):
    base=loopback_base(base) if release is None else deployed_base(base)
    if release is not None:assert release_frontend(release)['base']==base
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    def read(path,limit):
        with opener.open(base+path,timeout=15) as response:
            assert response.status==200 and response.geturl()==base+path,'Frontend response changed origin or path'
            data=response.read(limit+1);assert len(data)<=limit,'Frontend response exceeds bound';return data
    class Modules(HTMLParser):
        def __init__(self):super().__init__();self.entries=[]
        def handle_starttag(self,tag,attrs):
            a=dict(attrs)
            if tag=='script' and a.get('type')=='module' and a.get('src') and a['src']!='/@vite/client':self.entries.append(a['src'])
    parser=Modules();parser.feed(read('/',2_000_000).decode('utf8'));assert len(parser.entries)==1,'Exactly one application entry required'
    entry=parser.entries[0]
    # Validate path before issuing the second request; never resolve an external URL.
    binding={'base':base,'entry_path':entry,'entry_sha256':'0'*64}
    if release is not None:
        assert entry==release['entry_path'],'Served entry differs from reviewed release'
        binding['entry_sha256']=release['entry_sha256']
    validate_frontend(binding,release)
    binding['entry_sha256']=hashlib.sha256(read(entry,10_000_000)).hexdigest()
    if release is not None:assert binding==release_frontend(release),'Served entry bytes differ from reviewed release'
    return binding
