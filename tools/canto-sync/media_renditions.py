"""Bounded immutable raster rendition worker. Uses existing reviewed storage credentials.
Run once per minute: python3 media_renditions.py --environment staging --limit 30
No legacy/external URLs are fetched. Output is verified before DB publication.
"""
import argparse,hashlib,io,json,tempfile,warnings
from pathlib import Path
from PIL import Image,ImageOps
from management import query

SIZES={'thumb':320,'card':768,'detail':1536}
Image.MAX_IMAGE_PIXELS=12_000_000

def render(data):
    if not 0<len(data)<=10*1024*1024:raise ValueError('Invalid raster size')
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as original:
            if original.format not in ('PNG','JPEG') or original.width>4096 or original.height>4096 or original.width*original.height>12_000_000:raise ValueError('Unsupported raster')
            image=ImageOps.exif_transpose(original)
            alpha='A' in image.getbands() or 'transparency' in image.info
            image=image.convert('RGBA' if alpha else 'RGB')
            for variant,edge in SIZES.items():
                resized=image.copy();resized.thumbnail((edge,edge),Image.Resampling.LANCZOS);resized.info.clear()
                output=io.BytesIO();resized.save(output,format='PNG' if alpha else 'JPEG',**({'optimize':True} if alpha else {'quality':82,'optimize':True,'progressive':True}))
                yield variant,output.getvalue(),'image/png' if alpha else 'image/jpeg'

def run(environment,limit):
    from media_sync import Storage
    storage=Storage(environment);completed=0;failed=0
    for _ in range(limit):
        rows=query(environment,'select sa_media.claim_rendition_job() as job',readonly=False)
        job=rows[0]['job'] if rows else None
        if not job:break
        source=job['sha256']
        if job['path']!='sha256/'+source[:2]+'/'+source or len(source)!=64 or any(c not in '0123456789abcdef' for c in source):raise ValueError('Invalid source object')
        try:
            with storage.request(storage.object_url(job['path'])) as response:data=response.read(10*1024*1024+1)
            if len(data)!=int(job['bytes']) or hashlib.sha256(data).hexdigest()!=source:raise ValueError('Source integrity failure')
            for variant,payload,mime in render(data):
                sha=hashlib.sha256(payload).hexdigest();path='sha256/'+sha[:2]+'/'+sha
                with tempfile.TemporaryDirectory() as directory:
                    file=Path(directory)/'rendition';file.write_bytes(payload)
                    if not storage.exists(path,len(payload)):storage.upload(path,file,len(payload),mime)
                storage.verify(path,sha,len(payload))
                # Values are all generated constants, bounded integers, or validated hex digests.
                query(environment,f"select sa_media.record_rendition('{source}','{variant}','{sha}',{len(payload)},'{mime}')",readonly=False)
            completed+=1
        except Exception:
            # The durable lease expires and retries are capped at five. Never log URLs/keys.
            failed+=1
            print(json.dumps({'state':'retry_pending','source':source}))
    print(json.dumps({'completed':completed,'failed':failed,'environment':environment}))
    return failed

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--environment',choices=['staging','production'],required=True);parser.add_argument('--limit',type=int,default=30)
    args=parser.parse_args()
    if not 1<=args.limit<=100:parser.error('limit must be 1..100')
    raise SystemExit(1 if run(args.environment,args.limit) else 0)
