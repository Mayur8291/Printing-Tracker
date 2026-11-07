"""Validated offline extraction. No archive SQL is executed directly."""
import copy, hashlib, json, re, subprocess, os, shutil
from pathlib import Path
from pglast import ast, parse_sql, parser
from pglast.stream import RawStream
import legacy_remap as legacy

legacy.ast, legacy.parse_sql, legacy.parser, legacy.RawStream = ast, parse_sql, parser, RawStream
RESTORE = os.environ.get('PG_RESTORE') or shutil.which('pg_restore') or '/opt/homebrew/opt/postgresql@17/bin/pg_restore'
ROOT = Path(__file__).resolve().parent

def require(value, message):
    if not value: raise RuntimeError(message)

def file_hash(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def fingerprint(lines):
    hashes=sorted(hashlib.sha256(line).digest() for line in lines)
    return {'rows':len(hashes),'sha256':hashlib.sha256(b''.join(hashes)).hexdigest()}

def read_schema(path, environment):
    raw=[r.stmt for r in parse_sql(legacy.strip_psql_envelope(path.read_text()))]
    statements=[]
    for s in raw:
        if isinstance(s,ast.CreateSchemaStmt):
            require(s.schemaname=='public' and not s.authrole and not s.schemaElts,'Unexpected schema declaration')
        elif isinstance(s,ast.CommentStmt):
            require(legacy.normalized(s)==legacy.normalized(parse_sql("COMMENT ON SCHEMA public IS 'standard public schema'")[0].stmt),'Unexpected comment target')
        else: statements.append(s)
    model=legacy.Remapper(statements, expected_columns=850 if environment=='staging' else 848,
        expected_literal_defaults=207 if environment=='staging' else 206)
    # Full structural baseline includes defaults, indexes, types and FK behavior.
    canonical=json.dumps(legacy.normalized(statements),sort_keys=True,separators=(',',':'))
    sha=hashlib.sha256(canonical.encode()).hexdigest()
    return model,sha

def render_schema(model, namespace):
    require(re.fullmatch(r'sa_(?:import_[a-z0-9_]+|snapshot_20261019)',namespace),'Invalid import namespace')
    legacy.TARGET_SCHEMA=namespace
    result=[]
    for original in model.source:
        s=model.transform(copy.deepcopy(original))
        if isinstance(s,(ast.VariableSetStmt,ast.SelectStmt)):continue
        rendered=RawStream()(s)
        parsed=parse_sql(rendered)[0].stmt
        require(legacy.normalized(s)==legacy.normalized(parsed),'Schema render roundtrip mismatch')
        inverse=model.transform(copy.deepcopy(parsed),inverse=True)
        require(legacy.normalized(inverse)==legacy.normalized(original),'Inverse schema roundtrip mismatch')
        result.append(rendered)
    return result

def extract(directory, environment, approve_baseline=False):
    directory=Path(directory)
    archive=directory/'source.dump'
    require(subprocess.check_output([RESTORE,'--version'],text=True).startswith('pg_restore (PostgreSQL) 17.11'),'Unexpected restore version')
    for kind in ['schema','data']:
        with (directory/('restore-'+kind+'.log')).open('wb') as err:
            subprocess.run([RESTORE,'--'+kind+'-only','--no-owner','--no-privileges','--no-tablespaces',
                '--no-publications','--no-subscriptions','-f',str(directory/('source-'+kind+'.sql')),str(archive)],stderr=err,check=True)
    model,sha=read_schema(directory/'source-schema.sql',environment)
    baseline=ROOT/'baselines'/ (environment+'.json')
    if approve_baseline:
        require(not baseline.exists(),'Baseline already exists; review changes explicitly')
        baseline.parent.mkdir(exist_ok=True)
        baseline.write_text(json.dumps({'schema_sha256':sha,'tables':model.tables},indent=2)+'\n')
    require(baseline.exists() and json.loads(baseline.read_text())['schema_sha256']==sha,'Unreviewed source schema drift')
    tables={};sequences={};active=None;out=None;envelope=None;closed=False;buf=[];hashes=[]
    with (directory/'source-data.sql').open('rb') as stream:
        for line in stream:
            if active is not None:
                if line==b'\\.\n':
                    out.close(); hashes.sort()
                    tables[active]['sha256']=hashlib.sha256(b''.join(hashes)).hexdigest()
                    tables[active]['rows']=len(hashes)
                    active=None;hashes=[]
                else:
                    out.write(line);hashes.append(hashlib.sha256(line).digest())
                continue
            if line.startswith(b'\\'):
                m=re.fullmatch(rb'\\(restrict|unrestrict) ([A-Za-z0-9]+)\n',line)
                require(m is not None,'Unexpected psql command')
                if m[1]==b'restrict':require(envelope is None,'Repeated envelope');envelope=m[2]
                else:require(envelope==m[2] and not closed,'Mismatched envelope');closed=True
                continue
            if not line.strip() or line.startswith(b'--'):continue
            require(envelope is not None and not closed,'SQL outside dump envelope')
            buf.append(line)
            if not line.rstrip().endswith(b';'):continue
            parsed=parse_sql(b''.join(buf).decode());buf=[]
            require(len(parsed)==1,'Unexpected multi-statement data SQL')
            stmt=parsed[0].stmt
            if isinstance(stmt,ast.CopyStmt):
                active=legacy.transform_copy(stmt,model)
                require(active not in tables,'Repeated table payload')
                tables[active]={'columns':model.tables[active],'target':model.relation_map[active]}
                out=(directory/(active+'.copy')).open('wb')
            elif isinstance(stmt,ast.SelectStmt) and 'setval' in RawStream()(stmt):
                name=legacy.transform_setval(stmt,model)
                require(name not in sequences,'Repeated sequence')
                args=stmt.targetList[0].val.args
                sequences[name]={'value':args[1].val.ival,'called':args[2].val.boolval,'target':model.relation_map[name]}
            else:
                require(isinstance(stmt,(ast.VariableSetStmt,ast.SelectStmt)),'Unexpected data statement')
                # Accept only a session statement present in the validated schema, never execute it.
                require(any(legacy.normalized(stmt)==legacy.normalized(x) for x in model.source),'Unknown data session statement')
    require(active is None and not buf and closed,'Truncated data stream')
    require(set(tables)==set(model.tables) and set(sequences)==set(model.sequences),'Incomplete archive coverage')
    manifest={'environment':environment,'archive_sha256':file_hash(archive),'schema_sha256':sha,'tables':tables,'sequences':sequences}
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
    return manifest,model
