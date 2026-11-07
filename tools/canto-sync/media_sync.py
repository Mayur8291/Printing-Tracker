"""Read-only source media capture; immutable verified objects; atomic reference publication.
Only the matching reviewed source origin is fetched. No arbitrary URL fetches or
production fallback. Missing source files are explicit exceptions, never success.
"""
import concurrent.futures,datetime,gzip,hashlib,json,mimetypes,os,re,tempfile,time,threading,urllib.parse,urllib.request,urllib.error
from pathlib import Path
from psycopg.types.json import Jsonb
from management import api,PROJECTS
from snapshot import ROOT,require

CONTRACTS=json.loads((ROOT/'media-contracts.json').read_text())
ORIGINS={'staging':'http://64.227.186.227','production':'https://leaderboard.sagarfab.com'}
BUCKET='canto-media'
LIMIT=1024*1024*1024
CHUNK=6*1024*1024
EXTRA={'promotions':['link'],'rmp_classes':['embeded_video'],'products':['images']}
class MediaError(RuntimeError): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None
OPENER=urllib.request.build_opener(NoRedirect())

def decode_copy(value):
    if value==b'\\N':return None
    return re.sub(rb'\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)',lambda m:bytes([int(m[1],16)]) if m[1].startswith(b'x') else bytes([int(m[1],8)]) if m[1][:1] in b'01234567' else {b'n':b'\n',b'r':b'\r',b't':b'\t',b'b':b'\b',b'f':b'\f',b'v':b'\v'}.get(m[1],m[1]),value).decode('utf-8')

def leaves(value,pointer=''):
    if isinstance(value,dict):
        for k,v in value.items():yield from leaves(v,pointer+'/'+str(k).replace('~','~0').replace('/','~1'))
    elif isinstance(value,list):
        for i,v in enumerate(value):yield from leaves(v,pointer+'/'+str(i))
    elif isinstance(value,str) and value.strip():yield pointer,value

def source_url(environment,resource,record_id,field,value,mounted=False):
    base=ORIGINS[environment]; parsed=urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc:
        # A source's configured IP alias is allowed only in its matching environment.
        aliases={urllib.parse.urlsplit(base).netloc}
        if environment=='production':aliases.add('165.22.210.53')
        if parsed.scheme not in ('http','https') or parsed.netloc not in aliases:return None
        path=urllib.parse.unquote(parsed.path)
    elif value.startswith('/uploads/'):path=urllib.parse.unquote(value.split('?',1)[0])
    elif mounted:
        require('/' not in value and '\\' not in value,'Unsafe media filename')
        path='/uploads/'+CONTRACTS[resource]['model']+'/'+field+'/'+str(record_id)+'/'+value
    else:return None
    require(path.startswith('/uploads/') and not any(p in ('.','..') for p in path.split('/')) and '\\' not in path and not any(ord(c)<32 for c in path),'Unsafe media path')
    return base+urllib.parse.quote(path,safe='/')

def inventory(directory,manifest):
    refs=[]
    for resource,t in manifest['tables'].items():
        columns=t['columns'];known=CONTRACTS.get(resource,{}).get('fields',[])
        for f in known:require(f in columns,'Media contract drift')
        if 'id' not in columns:continue
        with (Path(directory)/(resource+'.copy')).open('rb') as inp:
            for line in inp:
                values=line.rstrip(b'\n').split(b'\t');record_id=int(values[columns.index('id')])
                for index,field in enumerate(columns):
                    raw=values[index]
                    # Scan URL references in other text/JSON fields too, rather than
                    # depending solely on currently known uploader names.
                    if field not in known+EXTRA.get(resource,[]) and b'/uploads/' not in raw and b'http://' not in raw and b'https://' not in raw:continue
                    value=decode_copy(raw)
                    if not value:continue
                    obj=value
                    if value[:1] in '[{':
                        try:obj=json.loads(value)
                        except ValueError:pass
                    for pointer,leaf in leaves(obj):
                        if field in known:
                            candidates=[(pointer,leaf)]
                        else:
                            # Preserve locations of URLs nested inside JSON, HTML or comments.
                            matches=list(re.finditer(r"(?:https?://|/uploads/)[^\s<>\"'`]+",leaf))
                            candidates=[(pointer if match.span()==(0,len(leaf)) else pointer+'#text:'+str(match.start())+':'+str(match.end()),match.group()) for match in matches]
                        for location,reference in candidates:
                            url=source_url(manifest['environment'],resource,record_id,field,reference,field in known)
                            refs.append({'resource':resource,'record_id':record_id,'field':field,'pointer':location,'source_value':reference,'source_url':url,'status':'pending' if url else 'external'})
    return refs

def open_source(url):
    for attempt in range(3):
        try:return OPENER.open(urllib.request.Request(url,headers={'User-Agent':'Canto-media-sync/1.0','Accept-Encoding':'identity'}),timeout=60)
        except urllib.error.HTTPError as e:
            if e.code in (404,410):return None
            if e.code not in (429,500,502,503,504):raise MediaError('Source media access failed') from None
        except (OSError,TimeoutError):pass
        if attempt<2:time.sleep(2**attempt)
    raise MediaError('Source media transfer failed')

class Storage:
    def __init__(self,environment):
        self.base='https://'+PROJECTS[environment]+'.supabase.co/storage/v1'
        self.tus='https://'+PROJECTS[environment]+'.storage.supabase.co/storage/v1/upload/resumable'
        self.key=next(k['api_key'] for k in api(environment,'/api-keys') if k['name']=='service_role')
    def request(self,url,method='GET',data=None,headers=None):
        return OPENER.open(urllib.request.Request(url,data=data,method=method,headers={'Authorization':'Bearer '+self.key,'apikey':self.key,**(headers or {})}),timeout=120)
    def object_url(self,path):return self.base+'/object/authenticated/'+BUCKET+'/'+urllib.parse.quote(path,safe='/')
    def verify(self,path,expected,size):
        digest=hashlib.sha256();length=0
        with self.request(self.object_url(path)) as r:
            for block in iter(lambda:r.read(1024*1024),b''):digest.update(block);length+=len(block)
        require(length==size and digest.hexdigest()==expected,'Media object read-back verification failed')
    def exists(self,path,size):
        try:
            with self.request(self.object_url(path),'HEAD') as r:return int(r.headers.get('Content-Length','-1'))==size
        except urllib.error.HTTPError as e:
            if e.code in (400,404):return False
            raise
    def upload(self,path,file,size,mime):
        if size<=CHUNK:
            # Small assets use one bounded request; larger files use resumable TUS.
            with open(file,'rb') as inp:data=inp.read()
            for attempt in range(3):
                try:
                    with self.request(self.base+'/object/'+BUCKET+'/'+path,'POST',data,{'Content-Type':mime,'x-upsert':'false','cache-control':'max-age=31536000'}) as r:r.read()
                    return
                except urllib.error.HTTPError as e:
                    if e.code in (400,409) and self.exists(path,size):return
                    if e.code not in (429,500,502,503,504) or attempt==2:raise
                except (OSError,TimeoutError):
                    if attempt==2:raise
                time.sleep(2**attempt)
        import base64
        meta=','.join(k+' '+base64.b64encode(v.encode()).decode() for k,v in {'bucketName':BUCKET,'objectName':path,'contentType':mime,'cacheControl':'31536000'}.items())
        with self.request(self.tus,'POST',b'',{'Tus-Resumable':'1.0.0','Upload-Length':str(size),'Upload-Metadata':meta}) as r:location=urllib.parse.urljoin(self.tus,r.headers['Location'])
        require(urllib.parse.urlsplit(location).netloc==urllib.parse.urlsplit(self.tus).netloc,'Unexpected media upload destination')
        offset=0
        with open(file,'rb') as inp:
            while offset<size:
                inp.seek(offset);block=inp.read(CHUNK)
                for attempt in range(4):
                    try:
                        with self.request(location,'PATCH',block,{'Tus-Resumable':'1.0.0','Upload-Offset':str(offset),'Content-Type':'application/offset+octet-stream'}) as r:new_offset=int(r.headers['Upload-Offset'])
                        require(offset<new_offset<=offset+len(block),'Invalid media upload progress')
                        offset=new_offset
                        break
                    except (urllib.error.URLError,OSError):
                        if attempt==3:raise MediaError('Media upload interrupted') from None
                        time.sleep(2**attempt)
                        with self.request(location,'HEAD',headers={'Tus-Resumable':'1.0.0'}) as r:resumed=int(r.headers['Upload-Offset'])
                        require(offset<=resumed<=offset+len(block),'Invalid media upload offset')
                        if resumed!=offset:offset=resumed;break

def prepare(conn,environment,directory,manifest,progress=None):
    refs=inventory(directory,manifest);storage=Storage(environment)
    objects={r[0]:{'path':r[1],'bytes':r[2]} for r in conn.execute('SELECT sha256,object_path,bytes FROM sa_media.objects')}
    urls=sorted({r['source_url'] for r in refs if r['source_url']})
    counts={'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'references':len(refs),'files':len(urls),'checked':0,'copied':0,'unchanged':0,'missing':0,'external':sum(r['status']=='external' for r in refs),'bytes':0}
    results={};errors=0;cache_rows=[]
    object_lock=threading.Lock();object_locks={}
    def transfer_once(url):
        response=open_source(url)
        if response is None:return {'status':'missing'}
        with response as inp,tempfile.NamedTemporaryFile(dir=directory,prefix='media-',delete=True) as out:
            size=0;digest=hashlib.sha256()
            if inp.headers.get('Content-Length'):require(int(inp.headers['Content-Length'])<=LIMIT,'Media file exceeds 1 GiB transfer limit')
            for block in iter(lambda:inp.read(1024*1024),b''):
                size+=len(block);require(size<=LIMIT,'Media file exceeds 1 GiB transfer limit');digest.update(block);out.write(block)
            if inp.headers.get('Content-Length'):require(size==int(inp.headers['Content-Length']),'Incomplete source media')
            require(size>0,'Empty source media');out.flush();sha=digest.hexdigest()
            guessed=mimetypes.guess_type(urllib.parse.urlsplit(url).path)[0]
            require(inp.headers.get('Content-Type','').split(';')[0]!='text/html' or guessed=='text/html','Source returned HTML instead of a media file')
            mime=guessed or inp.headers.get('Content-Type','application/octet-stream').split(';')[0]
            # Immutable hashes prevent same-name changes and stale CDN content.
            path='sha256/'+sha[:2]+'/'+sha
            with object_lock:lock=object_locks.setdefault(sha,threading.Lock())
            with lock:
                return store_verified(sha,path,out.name,size,mime)
    def transfer(url):
        for attempt in range(3):
            try:return transfer_once(url)
            except urllib.error.HTTPError as e:
                if e.code not in (408,429,500,502,503,504) or attempt==2:raise
            except (urllib.error.URLError,OSError,TimeoutError):
                if attempt==2:raise
            time.sleep(2**attempt)
    def store_verified(sha,path,filename,size,mime):
            cached=objects.get(sha);copied=False
            verified=False
            if cached:
                try:storage.verify(path,sha,size);verified=True
                except urllib.error.HTTPError as e:
                    if e.code not in (400,404):raise
            if not verified:
                try:
                    storage.upload(path,filename,size,mime);copied=True
                except urllib.error.HTTPError as e:
                    if e.code!=409:raise
                storage.verify(path,sha,size)
            with object_lock:objects[sha]={'path':path,'bytes':size}
            return {'status':'ready','sha256':sha,'object_path':path,'bytes':size,'content_type':mime,'copied':copied}
    # Deduplicate equal source URLs. Eight bounded streams keep source traffic and disk usage controlled.
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending={pool.submit(transfer,url):url for url in urls}
        for future in concurrent.futures.as_completed(pending):
            url=pending[future]
            try:
                result=future.result();results[url]=result
                if result['status']=='missing':counts['missing']+=1
                else:
                    counts['copied' if result['copied'] else 'unchanged']+=1;counts['bytes']+=result['bytes']
                    # Durable verified object cache permits retries even if publication fails.
                    cache_rows.append((result['sha256'],result['object_path'],result['bytes'],result['content_type']))
            except Exception as e:
                errors+=1;results[url]={'status':'failed','error_type':type(e).__name__,'diagnostic':str(e)}
                if isinstance(e,urllib.error.HTTPError):results[url]['http_status']=e.code
            counts['checked']+=1
            if counts['checked']%50==0 or counts['checked']==len(urls):
                if cache_rows:
                    with conn.cursor() as c:c.executemany('INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,%s,%s) ON CONFLICT(sha256) DO NOTHING',cache_rows)
                    cache_rows=[]
                detail={'media':{**counts,'failed':errors}}
                if progress:progress('copying_media',detail)
                else:print('Media '+json.dumps(detail['media']),flush=True)
    for ref in refs:ref.update(results.get(ref['source_url'],{}))
    counts['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    counts['failed']=errors;counts['complete']=not(errors or counts['missing'] or counts['external'])
    if errors:
        # Keep actionable identifiers after an ephemeral cloud worker is cleaned up.
        # Raw errors and source URLs remain private; only safe metadata reaches the UI.
        counts['failure_samples']=[{k:r[k] for k in ['resource','record_id','field','error_type','http_status'] if k in r} for r in refs if r['status']=='failed'][:25]
        if progress:progress('copying_media',{'media':counts})
    Path(directory,'media-manifest.json').write_text(json.dumps({'environment':environment,'summary':counts,'references':refs}))
    require(errors==0,'Media transfer failed; previous publication preserved')
    return {'environment':environment,'summary':counts,'references':refs}

def publish(conn,prepared):
    require(prepared['environment']==conn.execute('SELECT environment FROM sa_sync.environment_state').fetchone()[0],'Media environment mismatch')
    conn.execute('DELETE FROM sa_media.references')
    with conn.cursor().copy('COPY sa_media.references(resource,record_id,field,pointer,source_value,source_url,status,sha256) FROM STDIN') as stream:
        for r in prepared['references']:stream.write_row(tuple(r.get(k) for k in ['resource','record_id','field','pointer','source_value','source_url','status','sha256']))
    conn.execute('UPDATE sa_media.state SET summary=%s,updated_at=now() WHERE singleton',(Jsonb(prepared['summary']),))

def backup_state(conn,directory):
    if not conn.execute("select to_regclass('sa_media.references')").fetchone()[0]:return
    refs=conn.execute("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM sa_media.references r").fetchone()[0]
    summary=conn.execute('SELECT summary FROM sa_media.state').fetchone()[0]
    objects=conn.execute("SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') FROM sa_media.objects o WHERE EXISTS(SELECT 1 FROM sa_media.references r WHERE r.sha256=o.sha256)").fetchone()[0]
    Path(directory,'media-state.json').write_text(json.dumps({'references':refs,'summary':summary,'objects':objects},default=str))

def prepare_restore(conn,directory,environment):
    path=Path(directory,'media-state.json');require(path.exists(),'Backup predates media migration; explicit media recovery required')
    saved=json.loads(path.read_text());storage=Storage(environment)
    conn.execute('INSERT INTO sa_media.objects SELECT * FROM jsonb_populate_recordset(NULL::sa_media.objects,%s) ON CONFLICT(sha256) DO NOTHING',(Jsonb(saved.get('objects',[])),))
    hashes={r['sha256'] for r in saved['references'] if r['status']=='ready'}
    for sha in hashes:
        o=conn.execute('SELECT object_path,bytes FROM sa_media.objects WHERE sha256=%s',(sha,)).fetchone();require(o,'Recovery media object metadata missing')
        storage.verify(o[0],sha,o[1])
    return {'environment':environment,'references':saved['references'],'summary':saved['summary']}
