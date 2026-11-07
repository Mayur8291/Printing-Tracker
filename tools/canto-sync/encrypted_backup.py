"""Authenticated, encrypted rollback archives in private, environment-specific Storage."""
import base64, hashlib, json, os, shutil, tarfile, urllib.request, uuid
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from management import api, PROJECTS
from snapshot import require

CHUNK = 4 * 1024 * 1024

def key():
    raw = os.environ.get('CANTO_BACKUP_KEY') or (Path.home()/'.config/canto-sync/backup.key').read_text().strip()
    result = base64.b64decode(raw, validate=True)
    require(len(result)==32, 'Backup key must contain 32 bytes')
    return result

def storage(environment, path, data=None):
    secret = next(k['api_key'] for k in api(environment,'/api-keys') if k['name']=='service_role')
    request = urllib.request.Request('https://'+PROJECTS[environment]+'.supabase.co/storage/v1/object/'+path,
        data=data, method='GET' if data is None else 'POST', headers={
            'Authorization':'Bearer '+secret,'apikey':secret,'Content-Type':'application/octet-stream','x-upsert':'false'})
    with urllib.request.urlopen(request,timeout=120) as response: return response.read()

def upload(environment, job_id, directory):
    uuid.UUID(str(job_id))
    archive = directory/'rollback.tar'
    with tarfile.open(archive,'w') as out:
        out.add(directory/'before',arcname='before')
    prefix=environment+'/'+str(job_id)
    cipher=AESGCM(key()); parts=[]
    with archive.open('rb') as inp:
        for index, block in enumerate(iter(lambda: inp.read(CHUNK),b'')):
            name=prefix+'/'+str(index).zfill(5)+'.aesgcm'
            nonce=os.urandom(12); sealed=nonce+cipher.encrypt(nonce,block,name.encode())
            path='canto-sync-backups/'+name
            storage(environment,path,sealed)
            require(storage(environment,path)==sealed,'Encrypted backup read-back failed')
            parts.append({'name':name,'sha256':hashlib.sha256(sealed).hexdigest(),'bytes':len(block)})
    manifest={'version':1,'environment':environment,'job_id':str(job_id),'parts':parts,
              'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
    name=prefix+'/manifest.aesgcm';nonce=os.urandom(12)
    sealed=nonce+cipher.encrypt(nonce,json.dumps(manifest).encode(),name.encode())
    storage(environment,'canto-sync-backups/'+name,sealed)
    require(storage(environment,'canto-sync-backups/'+name)==sealed,'Backup manifest read-back failed')
    archive.unlink()
    return {'prefix':prefix,'chunks':len(parts),'encrypted':True,'read_back_verified':True}

def download(environment, job_id, destination):
    uuid.UUID(str(job_id)); destination=Path(destination)
    destination.mkdir(parents=True,exist_ok=False,mode=0o700)
    cipher=AESGCM(key());name=environment+'/'+str(job_id)+'/manifest.aesgcm'
    sealed=storage(environment,'canto-sync-backups/'+name)
    manifest=json.loads(cipher.decrypt(sealed[:12],sealed[12:],name.encode()))
    require(manifest['environment']==environment and manifest['job_id']==str(job_id),'Backup environment mismatch')
    archive=destination/'rollback.tar'
    with archive.open('wb') as out:
        for part in manifest['parts']:
            require(part['name'].startswith(environment+'/'+str(job_id)+'/'),'Backup path mismatch')
            sealed=storage(environment,'canto-sync-backups/'+part['name'])
            require(hashlib.sha256(sealed).hexdigest()==part['sha256'],'Backup checksum mismatch')
            block=cipher.decrypt(sealed[:12],sealed[12:],part['name'].encode())
            require(len(block)==part['bytes'],'Backup chunk length mismatch');out.write(block)
    require(hashlib.sha256(archive.read_bytes()).hexdigest()==manifest['sha256'],'Archive checksum mismatch')
    with tarfile.open(archive) as inp:
        for member in inp.getmembers():
            p=Path(member.name)
            require(not p.is_absolute() and '..' not in p.parts and p.parts[0]=='before' and (member.isfile() or member.isdir()),'Unsafe archive member')
        for member in inp.getmembers():
            target=destination/member.name
            if member.isdir(): target.mkdir(parents=True,exist_ok=True,mode=0o700)
            else:
                target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                with inp.extractfile(member) as source,target.open('xb') as out: shutil.copyfileobj(source,out)
    archive.unlink()
    return destination/'before'

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser(description='Decrypt a private rollback archive for the existing rollback.py command.')
    p.add_argument('environment',choices=PROJECTS);p.add_argument('job_id');p.add_argument('destination',type=Path)
    a=p.parse_args();print(download(a.environment,a.job_id,a.destination))
