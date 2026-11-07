#!/usr/bin/env python3
"""Bounded offline PostgreSQL-AST remap for one reviewed Scott snapshot.

No database connection, SQL execution, network call, credential access or upload.
COPY payloads are streamed byte-for-byte, never parsed as SQL or printed.
"""
import argparse
import collections
import copy
import hashlib
import json
import importlib.metadata
import platform
import os
from pathlib import Path
import re
import subprocess
import sys

os.umask(0o077)
PACKAGE = Path(__file__).resolve().parent
BASE = ARCHIVE = RESTORE = DEPENDENCIES = None
pglast = ast = parse_sql = parser = RawStream = None
RESTORE_VERSION = PACKAGE_VERSION = None
EXPECTED_BYTES = 37716888
EXPECTED_RESTORE_VERSION = (17, 11)
SOURCE_SCHEMA = "public"
TARGET_SCHEMA = "sa_snapshot_20261019"
EXPECTED = "c7342087f3cfc6a512d2904c858a418ac86dad8d672f25f173ae3aeb4bd4a963"
EXPECTED_STATEMENTS = dict(VariableSetStmt=11, SelectStmt=1, CreateStmt=86,
    CreateSeqStmt=84, AlterSeqStmt=84, AlterTableStmt=320, IndexStmt=164)
EXPECTED_BASELINE_SHA256 = "296a440e0749fd1d7c63be6ac70c8e1f9f5306d35c63aca0a383f7458db75f6f"
LOCATION_FIELDS = {"location", "stmt_location", "stmt_len", "arg_location"}
def RENDER(node):
    return RawStream()(node)

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def configure():
    global BASE, ARCHIVE, RESTORE, DEPENDENCIES, RESTORE_VERSION, PACKAGE_VERSION
    global pglast, ast, parse_sql, parser, RawStream
    args = argparse.ArgumentParser(
        description="Prepare and verify this exact snapshot locally; never connects to a database.")
    args.add_argument("--archive", required=True, type=Path, help="Path to the existing local snapshot.dump")
    args.add_argument("--pg-restore", required=True, type=Path, help="Explicit path to pg_restore 17.11")
    args.add_argument("--output-dir", required=True, type=Path, help="New private output directory; must not exist")
    args.add_argument("--dependency-dir", required=True, type=Path, help="Directory containing installed pglast 7.21")
    options = args.parse_args()
    require(sys.version_info >= (3, 9), "Python 3.9 or newer is required")
    ARCHIVE = options.archive.expanduser().resolve(strict=True)
    RESTORE = options.pg_restore.expanduser().resolve(strict=True)
    DEPENDENCIES = options.dependency_dir.expanduser().resolve(strict=True)
    BASE = options.output_dir.expanduser().resolve()
    require(ARCHIVE.is_file(), "Archive is not a regular file")
    require(ARCHIVE.stat().st_size == EXPECTED_BYTES, "Archive size mismatch")
    require(digest(ARCHIVE) == EXPECTED, "Archive checksum mismatch")
    require(RESTORE.is_file() and os.access(str(RESTORE), os.X_OK), "pg_restore is not executable")
    require(DEPENDENCIES.is_dir(), "Dependency directory is not a directory")
    require(not BASE.exists() and not BASE.is_symlink(), "Output directory already exists; use a new directory")
    require(PACKAGE not in BASE.parents and BASE != PACKAGE,
            "Private output must be outside the portable code-only package")
    require(BASE.parent.is_dir(), "Output parent directory must already exist")
    require(digest(PACKAGE / "baseline-counts.json") == EXPECTED_BASELINE_SHA256,
            "Count-only baseline checksum mismatch")
    version = subprocess.run([str(RESTORE), "--version"], check=False,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    require(version.returncode == 0, "Could not read pg_restore version")
    match = re.fullmatch(rb"pg_restore \(PostgreSQL\) (\d+)\.(\d+)(?:[^\n]*)\n?", version.stdout)
    require(match is not None, "Unrecognized pg_restore version")
    require(tuple(map(int, match.group(1, 2))) == EXPECTED_RESTORE_VERSION,
            "This handoff requires the reviewed pg_restore 17.11 executable")
    RESTORE_VERSION = "17.11"
    sys.path.insert(0, str(DEPENDENCIES))
    import pglast as parser_package
    from pglast import ast as parser_ast, parse_sql as parse_function, parser as parser_module
    from pglast.stream import RawStream as raw_stream
    pglast, ast, parse_sql, parser, RawStream = (
        parser_package, parser_ast, parse_function, parser_module, raw_stream)
    require(DEPENDENCIES in Path(pglast.__file__).resolve().parents,
            "pglast was loaded outside the selected dependency directory")
    distributions = [d for d in importlib.metadata.distributions(path=[str(DEPENDENCIES)])
                     if d.metadata.get("Name", "").lower() == "pglast"]
    require(len(distributions) == 1 and distributions[0].version == "7.21",
            "Installed pglast distribution version mismatch")
    PACKAGE_VERSION = distributions[0].version
    require(pglast.__version__ == "v7.21" and parser.get_postgresql_version()[0] == 17,
            "Pinned parser version mismatch")
    # Never create or overwrite private outputs until inputs and tools pass preflight.
    BASE.mkdir(mode=0o700)

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1048576), b""):
            h.update(part)
    return h.hexdigest()

def save(name, value):
    (BASE / name).write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")

def normalized(value):
    if isinstance(value, ast.Node):
        value = value()
    if isinstance(value, dict):
        return {k: normalized(v) for k, v in value.items() if k not in LOCATION_FIELDS}
    if isinstance(value, (list, tuple)):
        return [normalized(v) for v in value]
    return value

def nodes(value):
    if isinstance(value, ast.Node):
        yield value
        for field in value:
            yield from nodes(getattr(value, field))
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from nodes(item)

def strings(values):
    require(all(isinstance(v, ast.String) for v in values), "Expected identifier strings")
    return [v.sval for v in values]

def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'

def qualified(schema, name):
    return quote_identifier(schema) + "." + quote_identifier(name)

def prefixed(name):
    candidate = "sa_" + name
    if len(candidate.encode()) <= 63:
        return candidate
    suffix = "_" + hashlib.sha256(candidate.encode()).hexdigest()[:12]
    return candidate.encode()[:63-len(suffix)].decode("utf-8", "ignore") + suffix

def render_statements(statements):
    return "\n\n".join(RENDER(stmt) + ";" for stmt in statements) + "\n"

def extract(kind, path):
    args = [str(RESTORE), "--" + kind + "-only", "--no-owner", "--no-privileges",
            "--no-tablespaces", "--no-publications", "--no-subscriptions",
            "--file=" + str(path), str(ARCHIVE)]
    with (BASE / ("extract-" + kind + ".private.log")).open("wb") as log:
        result = subprocess.run(args, stdout=log, stderr=log)
    require(result.returncode == 0, kind + " extraction failed; private diagnostics retained")

def strip_psql_envelope(text):
    lines = text.splitlines()
    commands = [line for line in lines if line.startswith("\\")]
    require(len(commands) == 2, "Unexpected psql envelope count")
    start = re.fullmatch(r"\\restrict ([A-Za-z0-9]+)", commands[0])
    end = re.fullmatch(r"\\unrestrict ([A-Za-z0-9]+)", commands[1])
    require(start and end and start[1] == end[1], "Unexpected psql envelope")
    return "\n".join(line for line in lines if not line.startswith("\\"))

def get_relation(rv, schema, allowed):
    require(isinstance(rv, ast.RangeVar), "Expected a RangeVar")
    require(rv.catalogname is None and rv.alias is None and rv.schemaname == schema,
            "Unexpected relation namespace or alias")
    require(rv.relname in allowed, "Unknown relation reference")
    return rv.relname

def parse_regclass_name(value, schema, allowed):
    # regclass arguments are SQL strings. Parse their identifier grammar separately.
    tree = parse_sql("SELECT * FROM " + value)
    require(len(tree) == 1 and isinstance(tree[0].stmt, ast.SelectStmt),
            "Unexpected regclass identifier grammar")
    stmt = tree[0].stmt
    require(stmt.fromClause and len(stmt.fromClause) == 1, "Unexpected regclass reference")
    rv = stmt.fromClause[0]
    name = get_relation(rv, schema, allowed)
    reference = parse_sql("SELECT * FROM " + qualified(schema, name))[0].stmt
    require(normalized(stmt) == normalized(reference), "Unexpected regclass SQL suffix")
    return name

class Remapper:
    def __init__(self, source, expected_columns=848, expected_literal_defaults=206):
        self.source = source
        require(dict(collections.Counter(type(s).__name__ for s in source)) ==
                EXPECTED_STATEMENTS, "Unexpected source statement inventory")
        self.tables = {}
        self.sequences = {}
        self.indexes = {}
        self.constraints = {}
        self.defaults = []
        self.owned_by = []
        self.foreign_keys = []
        self.literal_defaults = 0
        for stmt in source:
            if isinstance(stmt, ast.CreateStmt):
                name = stmt.relation.relname
                require(name not in self.tables, "Duplicate source table")
                require(all(isinstance(c, ast.ColumnDef) for c in stmt.tableElts),
                        "Unexpected table element")
                self.tables[name] = [c.colname for c in stmt.tableElts]
                self.literal_defaults += sum(
                    c.contype.name == "CONSTR_DEFAULT"
                    for col in stmt.tableElts for c in (col.constraints or ()))
            elif isinstance(stmt, ast.CreateSeqStmt):
                name = stmt.sequence.relname
                require(name not in self.sequences, "Duplicate source sequence")
                self.sequences[name] = normalized(stmt.options)
            elif isinstance(stmt, ast.IndexStmt):
                require(stmt.idxname not in self.indexes, "Duplicate source index")
                self.indexes[stmt.idxname] = stmt.relation.relname
            elif isinstance(stmt, ast.AlterTableStmt):
                for cmd in stmt.cmds:
                    if cmd.subtype.name == "AT_AddConstraint":
                        con = cmd.def_
                        require(isinstance(con, ast.Constraint) and con.conname,
                                "Unexpected constraint")
                        require(con.contype.name in ("CONSTR_PRIMARY", "CONSTR_FOREIGN"),
                                "Unexpected constraint type")
                        key = (stmt.relation.relname, con.conname)
                        require(key not in self.constraints, "Duplicate constraint")
                        self.constraints[key] = con.contype.name
                        if con.contype.name == "CONSTR_PRIMARY":
                            require(con.conname not in self.indexes, "Index collision")
                            self.indexes[con.conname] = stmt.relation.relname
                    else:
                        require(cmd.subtype.name == "AT_ColumnDefault",
                                "Unexpected ALTER TABLE command")
        require(len(self.tables)==86 and sum(map(len,self.tables.values()))==expected_columns,
                "Table/column inventory mismatch")
        require(len(self.sequences)==84 and len(self.indexes)==250 and
                len(self.constraints)==236 and self.literal_defaults==expected_literal_defaults,
                "Dependency inventory mismatch")
        require({"ar_internal_metadata","schema_migrations","sync_airtables"} <= self.tables.keys(),
                "Source history table omitted")
        relation_names = list(self.tables) + list(self.sequences) + list(self.indexes)
        require(len(set(relation_names))==len(relation_names), "Source namespace collision")
        self.relation_map = {name: prefixed(name) for name in relation_names}
        require(len(set(self.relation_map.values()))==len(self.relation_map),
                "Renamed namespace collision")
        self.constraint_map = {key: prefixed(key[1]) for key in self.constraints}
        require(len({(t,n) for (t,_),n in self.constraint_map.items()})==
                len(self.constraint_map), "Renamed constraint collision")
        self.inverse_relations = {v:k for k,v in self.relation_map.items()}
        self.inverse_constraints = {(self.relation_map[t],new):old
            for (t,old),new in self.constraint_map.items()}
        for stmt in source:
            self.transform(copy.deepcopy(stmt), record=True)
        require(len(self.defaults)==84 and len(self.owned_by)==84 and
                len(self.foreign_keys)==150, "Explicit dependency coverage mismatch")
        require({x["sequence"] for x in self.defaults}==set(self.sequences),
                "Sequence defaults coverage mismatch")
        require({x["sequence"] for x in self.owned_by}==set(self.sequences),
                "Sequence ownership coverage mismatch")
        owner_map={x["sequence"]:(x["table"],x["column"]) for x in self.owned_by}
        require(all(owner_map[x["sequence"]]==(x["table"],x["column"]) for x in self.defaults),
                "Default/ownership binding mismatch")
        calls=collections.Counter(tuple(strings(n.funcname)) for s in source
             for n in nodes(s) if isinstance(n,ast.FuncCall))
        require(calls=={("nextval",):84,("pg_catalog","set_config"):1},
                "Unexpected schema function invocation")
        require(all(len(x.encode())<=63 and x.startswith("sa_")
                    for x in list(self.relation_map.values())+list(self.constraint_map.values())),
                "Invalid target name")

    def transform(self, stmt, inverse=False, record=False):
        src = TARGET_SCHEMA if inverse else SOURCE_SCHEMA
        dst = SOURCE_SCHEMA if inverse else TARGET_SCHEMA
        relmap = self.inverse_relations if inverse else self.relation_map
        conmap = self.inverse_constraints if inverse else self.constraint_map
        table_names = {self.relation_map[x] for x in self.tables} if inverse else set(self.tables)
        seq_names = {self.relation_map[x] for x in self.sequences} if inverse else set(self.sequences)
        def rv(node, allowed):
            old=get_relation(node,src,allowed)
            node.schemaname=dst
            node.relname=relmap[old]
            return old
        if isinstance(stmt,ast.CreateStmt):
            rv(stmt.relation,table_names)
        elif isinstance(stmt,ast.CreateSeqStmt):
            rv(stmt.sequence,seq_names)
        elif isinstance(stmt,ast.AlterSeqStmt):
            seq=rv(stmt.sequence,seq_names)
            require(len(stmt.options)==1 and stmt.options[0].defname=="owned_by",
                    "Unexpected sequence alteration")
            option=stmt.options[0]
            parts=strings(option.arg)
            require(len(parts)==3 and parts[0]==src and parts[1] in table_names,
                    "Unexpected sequence ownership reference")
            table=parts[1]
            original_table=relmap[table] if inverse else table
            require(parts[2] in self.tables[original_table], "Unknown ownership column")
            if record:
                self.owned_by.append(dict(sequence=seq,table=table,column=parts[2]))
            option.arg=(ast.String(sval=dst),ast.String(sval=relmap[table]),
                        ast.String(sval=parts[2]))
        elif isinstance(stmt,ast.AlterTableStmt):
            table=rv(stmt.relation,table_names)
            for cmd in stmt.cmds:
                if cmd.subtype.name=="AT_ColumnDefault":
                    function=cmd.def_
                    require(isinstance(function,ast.FuncCall) and
                        strings(function.funcname)==["nextval"] and len(function.args)==1,
                        "Unexpected sequence default function")
                    cast=function.args[0]
                    require(isinstance(cast,ast.TypeCast) and
                        strings(cast.typeName.names)==["regclass"] and
                        isinstance(cast.arg,ast.A_Const) and isinstance(cast.arg.val,ast.String),
                        "Unexpected sequence regclass expression")
                    seq=parse_regclass_name(cast.arg.val.sval,src,seq_names)
                    if record:
                        self.defaults.append(dict(table=table,column=cmd.name,sequence=seq))
                    # String changes here are constrained by the parsed regclass grammar.
                    cast.arg.val.sval=(dst+"."+relmap[seq])
                elif cmd.subtype.name=="AT_AddConstraint":
                    con=cmd.def_
                    require((table,con.conname) in conmap,"Unknown named constraint")
                    con.conname=conmap[(table,con.conname)]
                    if con.contype.name=="CONSTR_FOREIGN":
                        target=rv(con.pktable,table_names)
                        original_table=relmap[table] if inverse else table
                        original_target=relmap[target] if inverse else target
                        require(set(strings(con.fk_attrs))<=set(self.tables[original_table]) and
                            set(strings(con.pk_attrs))<=set(self.tables[original_target]),
                            "Unknown foreign key columns")
                        if record:
                            self.foreign_keys.append(dict(table=table,target=target,
                                columns=strings(con.fk_attrs),target_columns=strings(con.pk_attrs)))
                    else:
                        require(con.contype.name=="CONSTR_PRIMARY","Unexpected constraint type")
                else:
                    raise RuntimeError("Unexpected ALTER TABLE command")
        elif isinstance(stmt,ast.IndexStmt):
            rv(stmt.relation,table_names)
            require(stmt.idxname in relmap,"Unknown index")
            stmt.idxname=relmap[stmt.idxname]
        elif isinstance(stmt,ast.VariableSetStmt):
            require(stmt.name in {"statement_timeout","lock_timeout","idle_in_transaction_session_timeout",
                "transaction_timeout","client_encoding","standard_conforming_strings","check_function_bodies",
                "xmloption","client_min_messages","row_security","default_table_access_method"},
                "Unexpected source session setting")
        elif isinstance(stmt,ast.SelectStmt):
            expected=parse_sql("SELECT pg_catalog.set_config('search_path', '', false)")[0].stmt
            require(normalized(stmt)==normalized(expected),"Unexpected source SELECT")
        else:
            raise RuntimeError("Unexpected schema statement")
        return stmt

    def manifest(self):
        return dict(
            source_schema=SOURCE_SCHEMA,target_schema=TARGET_SCHEMA,
            tables=[dict(source=t,target=self.relation_map[t],columns=cols)
                    for t,cols in sorted(self.tables.items())],
            sequences=[dict(source=s,target=self.relation_map[s],options=opts)
                       for s,opts in sorted(self.sequences.items())],
            indexes=[dict(source=i,target=self.relation_map[i],table=t,
                          target_table=self.relation_map[t]) for i,t in sorted(self.indexes.items())],
            constraints=[dict(table=t,source=c,target=self.constraint_map[(t,c)],
                         target_table=self.relation_map[t],type=typ)
                         for (t,c),typ in sorted(self.constraints.items())],
            sequence_defaults=self.defaults,sequence_ownership=self.owned_by,
            foreign_keys=self.foreign_keys,
            shortened_names={s:t for s,t in self.relation_map.items() if t!="sa_"+s},
            naming_rule="sa_ prefix, max 63 UTF-8 bytes; truncate with underscore and first 12 SHA-256 hex characters",
            historical_tables_preserved=True,active_airtable_integration=False,
        )

def ast_roundtrip(remapper):
    transformed=[remapper.transform(copy.deepcopy(s)) for s in remapper.source]
    text=render_statements(transformed)
    parsed=[r.stmt for r in parse_sql(text)]
    require(normalized(parsed)==normalized(transformed),"Rendered AST differs from transformed AST")
    inverse=[remapper.transform(copy.deepcopy(s),inverse=True) for s in parsed]
    require(normalized(inverse)==normalized(remapper.source),
            "Inverse-normalized schema AST differs from source")
    require(all(n.schemaname==TARGET_SCHEMA for s in parsed for n in nodes(s)
                if isinstance(n,ast.RangeVar)), "Old schema relation reference remains")
    pre=[];post=[]
    for stmt in parsed:
        if isinstance(stmt,ast.IndexStmt) or (isinstance(stmt,ast.AlterTableStmt)
              and stmt.cmds[0].subtype.name=="AT_AddConstraint"):
            post.append(stmt)
        else:
            pre.append(stmt)
    header=("-- PRIVATE LOCAL PREPARATION ONLY. No SQL has been executed.\n"
            "-- Requires a reviewed empty sa_snapshot_20261019 namespace and secure import wrapper.\n"
            "-- No source owners or ACLs are replayed. Existing public/Auth must remain untouched.\n")
    (BASE/"sa-schema.private.sql").write_text(header+text)
    (BASE/"sa-pre-data.private.sql").write_text(header+render_statements(pre))
    (BASE/"sa-post-data.private.sql").write_text(header+render_statements(post))
    return parsed,pre,post

def negative_tests(remapper):
    tests=[]
    require(prefixed("x"*70)==prefixed("x"*70) and len(prefixed("x"*70).encode())==63,
            "Long-name determinism failed")
    require(prefixed("x"*69+"a")!=prefixed("x"*69+"b"),"Long-name collision test failed")
    tests.extend(["deterministic_63_byte_shortening","distinct_long_name_suffixes"])
    cases=[
       parse_sql("CREATE TABLE unexpected.users(id bigint)")[0].stmt,
       parse_sql("CREATE TABLE public.not_in_snapshot(id bigint)")[0].stmt,
       parse_sql("DROP TABLE public.users")[0].stmt,
       parse_sql("ALTER TABLE public.users ALTER COLUMN id SET DEFAULT nextval('public.unknown'::regclass)")[0].stmt,
    ]
    for n,stmt in enumerate(cases):
        try:
            remapper.transform(stmt)
        except RuntimeError:
            tests.append("reject_case_"+str(n+1))
        else:
            raise RuntimeError("Negative schema test unexpectedly accepted")
    for value in ["public.users_id_seq; SELECT 1", "public.users_id_seq WHERE true"]:
        try:
            parse_regclass_name(value,SOURCE_SCHEMA,set(remapper.sequences))
        except RuntimeError:
            tests.append("reject_regclass_suffix")
        else:
            raise RuntimeError("Regclass suffix test unexpectedly accepted")
    return tests

def transform_copy(stmt, remapper, inverse=False):
    src=TARGET_SCHEMA if inverse else SOURCE_SCHEMA
    allowed={remapper.relation_map[t] for t in remapper.tables} if inverse else set(remapper.tables)
    table=get_relation(stmt.relation,src,allowed)
    original=remapper.inverse_relations[table] if inverse else table
    require(stmt.is_from and not stmt.is_program and stmt.filename is None and
            stmt.query is None and not stmt.options and stmt.whereClause is None,
            "Unexpected COPY operation")
    require(strings(stmt.attlist)==remapper.tables[original],"COPY column order mismatch")
    stmt.relation.schemaname=SOURCE_SCHEMA if inverse else TARGET_SCHEMA
    stmt.relation.relname=original if inverse else remapper.relation_map[table]
    return original

def transform_setval(stmt,remapper,inverse=False):
    require(isinstance(stmt,ast.SelectStmt) and stmt.targetList and len(stmt.targetList)==1,
            "Unexpected sequence state statement")
    call=stmt.targetList[0].val
    require(isinstance(call,ast.FuncCall) and strings(call.funcname)==["pg_catalog","setval"]
            and len(call.args)==3,"Unexpected sequence state function")
    arg,num,called=call.args
    require(isinstance(arg,ast.A_Const) and isinstance(arg.val,ast.String),
            "Unexpected sequence state identifier")
    src=TARGET_SCHEMA if inverse else SOURCE_SCHEMA
    names={remapper.relation_map[s] for s in remapper.sequences} if inverse else set(remapper.sequences)
    seq=parse_regclass_name(arg.val.sval,src,names)
    original=remapper.inverse_relations[seq] if inverse else seq
    # Exact AST-shape comparison excludes expressions, extra clauses and executable arguments.
    require(isinstance(num,ast.A_Const) and isinstance(num.val,ast.Integer)
            and isinstance(called,ast.A_Const) and isinstance(called.val,ast.Boolean),
            "Unexpected sequence state value expression")
    expected=parse_sql("SELECT pg_catalog.setval('"+arg.val.sval.replace("'","''")+"', "+
        str(num.val.ival)+", "+("true" if called.val.boolval else "false")+")")[0].stmt
    require(normalized(stmt)==normalized(expected),"Unexpected setval clause")
    arg.val.sval=(SOURCE_SCHEMA+"."+original if inverse else
                 TARGET_SCHEMA+"."+remapper.relation_map[seq])
    return original

def data_companion(remapper):
    source=BASE/"source-data.private.sql"
    target=BASE/"sa-data.private.sql"
    extract("data",source)
    records=[];states={};seen=set();active=None;key=None;meta=0
    sql_lines=[]
    with source.open("rb") as inp,target.open("wb") as out:
        for line in inp:
            if active:
                if line==b"\\.\n":
                    out.write(line)
                    active["payload_sha256"]=active.pop("hasher").hexdigest()
                    records.append(active);active=None
                else:
                    out.write(line)
                    active["hasher"].update(line)
                    active["rows"]+=1
                    active["payload_bytes"]+=len(line)
                continue
            if line.startswith(b"\\"):
                m=re.fullmatch(rb"\\(restrict|unrestrict) ([A-Za-z0-9]+)\n",line)
                require(m is not None,"Unexpected data psql command")
                if m[1]==b"restrict":
                    require(meta==0,"Unexpected data restrict position")
                    key=m[2];meta=1
                else:
                    require(meta==1 and key==m[2],"Unexpected data unrestrict")
                    meta=2
                out.write(line)
                continue
            if not line.strip() or line.startswith(b"--"):
                # Comments are metadata only. Omit them to avoid stale source object labels.
                continue
            require(meta==1,"Data SQL outside restricted envelope")
            sql_lines.append(line)
            if not line.rstrip().endswith(b";"):
                continue
            text=b"".join(sql_lines).decode();sql_lines=[]
            parsed=parse_sql(text)
            require(len(parsed)==1,"Unexpected multiple data statements")
            stmt=parsed[0].stmt;original=copy.deepcopy(stmt)
            if isinstance(stmt,ast.CopyStmt):
                table=transform_copy(stmt,remapper)
                require(table not in seen,"Duplicate data table")
                seen.add(table)
                transformed=RENDER(stmt)+";\n"
                check=parse_sql(transformed)[0].stmt
                transform_copy(check,remapper,inverse=True)
                require(normalized(check)==normalized(original),"COPY AST inverse mismatch")
                active=dict(source_table=table,target_table=remapper.relation_map[table],
                            rows=0,payload_bytes=0,hasher=hashlib.sha256())
            elif isinstance(stmt,ast.VariableSetStmt):
                remapper.transform(stmt)
                transformed=RENDER(stmt)+";\n"
            elif isinstance(stmt,ast.SelectStmt):
                name=tuple(strings(stmt.targetList[0].val.funcname))
                if name==("pg_catalog","set_config"):
                    remapper.transform(stmt);transformed=RENDER(stmt)+";\n"
                else:
                    sequence=transform_setval(stmt,remapper)
                    require(sequence not in states,"Duplicate sequence state")
                    transformed=RENDER(stmt)+";\n"
                    check=parse_sql(transformed)[0].stmt
                    transform_setval(check,remapper,inverse=True)
                    require(normalized(check)==normalized(original),"setval AST inverse mismatch")
                    states[sequence]=dict(target=remapper.relation_map[sequence],
                                         source_ast=normalized(original))
            else:
                raise RuntimeError("Unexpected data SQL statement")
            out.write(transformed.encode())
    require(active is None and not sql_lines and meta==2,"Incomplete data stream")
    require(seen==set(remapper.tables) and set(states)==set(remapper.sequences),
            "Data table/sequence coverage mismatch")
    # Independent second pass over output verifies emitted bytes, not just input accounting.
    output_records={};active=None
    with target.open("rb") as f:
        for line in f:
            if active:
                if line==b"\\.\n":
                    active["payload_sha256"]=active.pop("hasher").hexdigest()
                    output_records[active.pop("table")]=active;active=None
                else:
                    active["hasher"].update(line);active["rows"]+=1
                    active["payload_bytes"]+=len(line)
            elif line.startswith(b"COPY "):
                stmt=parse_sql(line.decode())[0].stmt
                table=transform_copy(stmt,remapper,inverse=True)
                active=dict(table=table,rows=0,payload_bytes=0,hasher=hashlib.sha256())
    require(active is None and set(output_records)==seen,"Output COPY coverage mismatch")
    baseline=json.loads((PACKAGE/"baseline-counts.json").read_text())
    expected_counts=baseline["rows_by_source_table"]
    require(baseline["source_archive_sha256"] == EXPECTED and
            baseline["source_archive_bytes"] == EXPECTED_BYTES and
            baseline["tables"] == 86 and baseline["total_rows"] == 1503137 and
            set(expected_counts) == set(remapper.tables) and
            all(type(v) is int and v >= 0 for v in expected_counts.values()) and
            sum(expected_counts.values()) == 1503137, "Count-only baseline mismatch")
    for record in records:
        require(output_records[record["source_table"]]==
                {k:record[k] for k in ("rows","payload_bytes","payload_sha256")},
                "Output COPY bytes differ")
        require(record["rows"]==expected_counts[record["source_table"]],
                "Source COPY count differs from prior verified baseline")
    require(sum(r["rows"] for r in records)==1503137,"Total data row mismatch")
    save("data-payload-manifest.private.json",dict(tables=records,sequence_states=states,
        payload_bytes_preserved=True,sql_identifier_inverse_ast_match=True,
        runtime_constraints_checked=False,hosted_import=False))
    return records

def main():
    configure()
    extract("schema",BASE/"source-schema.private.sql")
    sql=strip_psql_envelope((BASE/"source-schema.private.sql").read_text())
    source=[r.stmt for r in parse_sql(sql)]
    remapper=Remapper(source)
    parsed,pre,post=ast_roundtrip(remapper)
    tests=negative_tests(remapper)
    save("mapping.private.json",remapper.manifest())
    print("Schema AST checks passed: all 86 tables, 848 columns, 84 sequences, 236 constraints and 164 additional indexes mapped to sa_.",flush=True)
    rows=data_companion(remapper)
    print("COPY companion checks passed: 86 table payloads, 1,503,137 rows and 84 sequence-state mappings; payload bytes unchanged.",flush=True)
    save("verification.json",dict(
       status="OFFLINE_AST_AND_COPY_ARTIFACTS_VERIFIED_NOT_DEPLOYED",
       source_archive_sha256=EXPECTED,source_archive_unchanged=digest(ARCHIVE)==EXPECTED,
       parser_version=pglast.__version__,postgres_parser_version=parser.get_postgresql_version(),
       installed_distribution_version=PACKAGE_VERSION,
       pg_restore_version=RESTORE_VERSION,python_version=platform.python_version(),
       source_archive_bytes=EXPECTED_BYTES,baseline_counts_sha256=EXPECTED_BASELINE_SHA256,
       preparer_code_sha256=digest(Path(__file__).resolve()),
       package_provenance="Installed distribution version and runtime package location checked; platform-specific wheel is not pinned here.",
       target_schema=TARGET_SCHEMA,tables=86,columns=848,sequences=84,
       sequence_defaults=84,sequence_ownership_links=84,literal_defaults=206,
       primary_keys=86,foreign_keys=150,additional_indexes=164,
       indexes_including_primary_keys=250,constraints=236,total_rows=1503137,
       schema_statements=len(parsed),pre_data_statements=len(pre),post_data_statements=len(post),
       inverse_schema_ast_exact=True,copy_payload_bytes_exact=True,
       copy_and_sequence_inverse_ast_exact=True,negative_tests=tests,
       shortened_relation_names=len(remapper.manifest()["shortened_names"]),
       all_86_tables_retained=True,hosted_writes=False,postgres_runtime_started=False,
       auth_import=False,source_owners_acl_replayed=False,
       limitations=[
          "Offline artifacts only; no renamed database restore or runtime constraint validation.",
          "Source default collation remains unknown; no source locale-semantic equivalence claim.",
          "Data contains password verifiers and token-like fields; transmission requires applicable secure user handoff.",
          "Secure schema creation, target privileges/RLS/default ACL review and import wrapper remain separate.",
          "Historical Airtable records preserved; no integration enabled.",
          "No native Supabase Auth import or working-login claim."
       ]))
    files=[p for p in BASE.iterdir() if p.is_file() and p.name!="checksums.private.json"]
    save("checksums.private.json",{p.name:dict(bytes=p.stat().st_size,sha256=digest(p)) for p in files})
    require(digest(ARCHIVE) == EXPECTED and ARCHIVE.stat().st_size == EXPECTED_BYTES,
            "Source archive changed during preparation")
    print("Local-only artifacts complete; no database connection or hosted transfer.",flush=True)

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        # Never emit a parser exception, which could include source snippets.
        print("STOPPED: "+(str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__)+
              "; no hosted action performed.",file=sys.stderr)
        raise SystemExit(1)
