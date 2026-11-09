"""Bounded local equivalence, executor-call, spill and snapshot proof.

Only unique synthetic schemas on the hard-coded localhost cluster are touched.
No business fixture, hosted connection, source/application row, or key is used.
"""
import concurrent.futures
import hashlib
import json
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
import psycopg
from psycopg import sql
from local_db import connect
import test_hosted_business_journeys as business
from profile_source_fingerprint_streaming import statement, decode, nodes

EVIDENCE = Path(__file__).resolve().parents[2]/'docs/squad-one-web/evidence/source-fingerprint-streaming-local.json'

# Frozen pre-change implementation; independent of the candidate generator and
# integrated source_state. Keep its MATERIALIZED CTE as the regression oracle.
def original_materialized_state(c, schema):
 """Bounded digest per source table; no source contents or PII persisted."""
 tables=c.execute("SELECT t.tablename,EXISTS(SELECT 1 FROM information_schema.columns a WHERE a.table_schema=%s AND a.table_name=t.tablename AND a.column_name='id' AND a.data_type IN('bigint','integer','smallint')) FROM pg_tables t WHERE t.schemaname=%s ORDER BY 1",(schema,schema)).fetchall()
 assert 0<len(tables)<=300
 queries=[]
 for table,has_id in tables:
  maxid=sql.SQL('max(id)') if has_id else sql.SQL('NULL::bigint')
  sums=[sql.SQL("coalesce(sum(('x'||substr(h,{},16))::bit(64)::bigint::numeric),0)::text").format(sql.Literal(n)) for n in (1,17,33,49)]
  # Explicit materialization prevents PostgreSQL from inlining the expensive
  # row serialization/SHA256 expression into each of the four digest sums.
  queries.append(sql.SQL("(WITH row_hashes AS MATERIALIZED (SELECT {},encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM {}.{} t) SELECT {},count(*),{},{} FROM row_hashes)").format(sql.SQL('id') if has_id else sql.SQL('NULL::bigint id'),sql.Identifier(schema),sql.Identifier(table),sql.Literal(table),maxid,sql.SQL(',').join(sums)))
 return {row[0]:{'count':row[1],'max_id':row[2],'digest':list(row[3:])} for row in c.execute(sql.SQL(' UNION ALL ').join(queries)).fetchall()}


class SourceFingerprintStreaming(unittest.TestCase):
    def setUp(self):
        self.c = connect()
        assert self.c.info.host == '127.0.0.1' and self.c.info.dbname.startswith('squad_test')
        self.schema = 'fingerprint_' + uuid.uuid4().hex
        self.c.execute('BEGIN')
        self.c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(self.schema)))
        self.c.execute("SET LOCAL work_mem='64kB';SET LOCAL max_parallel_workers_per_gather=0;SET LOCAL jit=off;SET LOCAL statement_timeout='10s'")
    def tearDown(self):
        self.c.rollback();self.c.close()
    def create(self, table, definition):
        self.c.execute(sql.SQL('CREATE TABLE {}.{} ({})').format(sql.Identifier(self.schema),sql.Identifier(table),sql.SQL(definition)))
    def run_state(self, tables, **options):
        return decode(self.c.execute(statement(self.schema,tables,**options)).fetchall())
    def test_exact_original_empty_duplicates_signed_hashes_nulls_and_mutations(self):
        self.create('sa_big','id bigint,n numeric,b boolean,p jsonb,bytes bytea,at timestamptz,label text')
        self.create('sa_none','label text,p jsonb')
        self.create('sa_text','id text,label text')
        self.create('sa_empty','id smallint')
        self.c.execute(sql.SQL("INSERT INTO {}.sa_big VALUES (-9223372036854775808,-9.125,true,'{{\"x\":null}}','\\x00ff','2026-11-09T00:00:00Z','हैलो'),(9223372036854775807,1e30,false,'[1,2]',NULL,NULL,''),(NULL,NULL,NULL,NULL,NULL,NULL,NULL)").format(sql.Identifier(self.schema)))
        self.c.execute(sql.SQL("INSERT INTO {}.sa_none VALUES ('duplicate','null'),('duplicate','null'),(NULL,NULL)").format(sql.Identifier(self.schema)))
        self.c.execute(sql.SQL("INSERT INTO {}.sa_text VALUES ('not-numeric','text id')").format(sql.Identifier(self.schema)))
        tables=[('sa_big',True),('sa_empty',True),('sa_none',False),('sa_text',False)]
        def compare():
            original=original_materialized_state(self.c,self.schema)
            with patch.object(business,'SCHEMA',self.schema): self.assertEqual(business.source_state(self.c),original)
            current=self.run_state(tables)
            self.assertEqual(current,original)
            self.assertEqual(self.run_state(list(reversed(tables))),original)
            return current
        original=compare();self.assertEqual(original['sa_empty'],{'count':0,'max_id':None,'digest':['0']*4})
        # Independent Python SHA256 and signed-word arithmetic on exact PostgreSQL
        # row serialization, including duplicate multiplicity and NULL fields.
        for table, has_id in tables:
            serialized=self.c.execute(sql.SQL("SELECT to_jsonb(t)::text FROM {}.{} t").format(sql.Identifier(self.schema),sql.Identifier(table))).fetchall()
            expected=[0]*4
            for (text,) in serialized:
                digest=hashlib.sha256(text.encode('utf8')).digest()
                for n in range(4):expected[n]+=int.from_bytes(digest[n*8:n*8+8],'big',signed=True)
            self.assertEqual(original[table]['digest'],list(map(str,expected)))
        self.c.execute(sql.SQL("UPDATE {}.sa_big SET label='changed' WHERE id IS NULL").format(sql.Identifier(self.schema)))
        self.assertNotEqual(compare()['sa_big'],original['sa_big'])
        self.c.execute(sql.SQL("UPDATE {}.sa_big SET label=NULL WHERE id IS NULL").format(sql.Identifier(self.schema)))
        self.assertEqual(compare(),original)
        self.c.execute(sql.SQL("DELETE FROM {}.sa_none WHERE ctid=(SELECT min(ctid) FROM {}.sa_none)").format(sql.Identifier(self.schema),sql.Identifier(self.schema)))
        self.assertNotEqual(compare()['sa_none'],original['sa_none'])
    def test_hash_projection_evaluated_once_per_row(self):
        self.create('sa_calls','id integer,label text')
        self.c.execute(sql.SQL("INSERT INTO {}.sa_calls SELECT n,repeat(n::text,20) FROM generate_series(1,25)n").format(sql.Identifier(self.schema)))
        self.c.execute("SET LOCAL track_functions='all'")
        self.c.execute(sql.SQL("CREATE FUNCTION {}.counted_hash(bytea) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT AS 'BEGIN RETURN sha256($1); END'").format(sql.Identifier(self.schema)))
        name=self.schema+'.counted_hash(bytea)'
        def calls():return self.c.execute('SELECT coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE funcid=%s::regprocedure),0)',(name,)).fetchone()[0]
        for materialized in [True,False]:
            before=calls();result=self.run_state([('sa_calls',True)],materialized=materialized,hash_function=(self.schema,'counted_hash'))
            self.assertEqual(calls()-before,25)
        # Positive sensitivity control: without the barrier, the planner copies
        # the expensive expression into all four sums (100 calls for 25 rows).
        q=statement(self.schema,[('sa_calls',True)],hash_function=(self.schema,'counted_hash')).as_string(self.c).replace(' OFFSET 0','')
        before=calls();self.c.execute(q).fetchall();self.assertEqual(calls()-before,100)
    def test_86_table_single_statement_spill_plan(self):
        tables=[('sa_%03d'%n,True) for n in range(86)]
        for table,_ in tables:self.create(table,'id bigint,label text')
        self.c.execute(sql.SQL("INSERT INTO {}.sa_000 SELECT n,repeat(md5(n::text),8) FROM generate_series(1,20000)n").format(sql.Identifier(self.schema)))
        for table,_ in tables[1:]:self.c.execute(sql.SQL("INSERT INTO {}.{} VALUES (1,'small')").format(sql.Identifier(self.schema),sql.Identifier(table)))
        original=original_materialized_state(self.c,self.schema)
        with patch.object(business,'SCHEMA',self.schema): self.assertEqual(business.source_state(self.c),original)
        self.assertEqual(self.run_state(tables),original)
        samples=[]
        for materialized in [True,False]:
            plan=self.c.execute(sql.SQL('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) {}').format(statement(self.schema,tables,materialized=materialized))).fetchone()[0][0]
            all_nodes=list(nodes(plan['Plan']))
            if materialized:self.assertGreater(plan['Plan'].get('Temp Written Blocks',0),0);self.assertEqual(sum(n['Node Type']=='CTE Scan' for n in all_nodes),86)
            else:self.assertEqual(plan['Plan'].get('Temp Written Blocks',0),0);self.assertFalse(any(n['Node Type'] in ('CTE Scan','Materialize','Sort') for n in all_nodes))
            samples.append({'variant':'materialized' if materialized else 'offset_zero_streaming','execution_ms':plan['Execution Time'],'temp_written_blocks':plan['Plan'].get('Temp Written Blocks',0),'temp_read_blocks':plan['Plan'].get('Temp Read Blocks',0),'node_types':sorted(set(n['Node Type'] for n in all_nodes))})
        report={'format':'squad-source-fingerprint-local/v1','local_postgres_version':self.c.execute('SHOW server_version').fetchone()[0],'tables':86,'rows':20085,'work_mem':'64kB','parallel_workers':0,'jit':False,'exact_original_result_equal':True,'samples':samples,'scope':'Local synthetic SQL only; not an attribution of hosted platform failure or a hosted throughput benchmark. No hosted query performed. The harness uses the equivalent inline streaming SQL; the candidate builder is not a runtime dependency.','documents':['https://www.postgresql.org/docs/17/queries-with.html','https://www.postgresql.org/docs/17/transaction-iso.html']}
        EVIDENCE.write_text(json.dumps(report,indent=2)+'\n')
    def test_all_union_branches_share_statement_snapshot(self):
        # A separately owned tiny committed schema is needed for the concurrent
        # writer. DROP is exact-name and runs in finally; no business data used.
        self.create('sa_first','id bigint');self.create('sa_last','id bigint')
        self.c.execute(sql.SQL('INSERT INTO {}.sa_first VALUES(1);INSERT INTO {}.sa_last VALUES(1)').format(sql.Identifier(self.schema),sql.Identifier(self.schema)))
        self.c.commit()
        key=int(uuid.uuid4().int%(2**31))
        try:
            with connect() as blocker:
                blocker.execute('SELECT pg_advisory_lock(%s)',(key,))
                q=sql.SQL("SELECT 'gate',0::bigint,NULL::bigint,'0','0','0','0' FROM pg_advisory_xact_lock({}) UNION ALL {}").format(sql.Literal(key),statement(self.schema,[('sa_first',True),('sa_last',True)]))
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    result=pool.submit(lambda:self.c.execute(q).fetchall())
                    try:
                        deadline=time.monotonic()+3
                        while not blocker.execute("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE pid=%s AND wait_event='advisory')",(self.c.info.backend_pid,)).fetchone()[0]:
                            self.assertLess(time.monotonic(),deadline);time.sleep(.01)
                        blocker.execute(sql.SQL('INSERT INTO {}.sa_first VALUES(2);INSERT INTO {}.sa_last VALUES(2)').format(sql.Identifier(self.schema),sql.Identifier(self.schema)))
                    finally:blocker.execute('SELECT pg_advisory_unlock(%s)',(key,))
                    observed=decode(result.result(timeout=3))
                self.assertEqual(observed['sa_first']['count'],1);self.assertEqual(observed['sa_last']['count'],1)
                next_state=self.run_state([('sa_first',True),('sa_last',True)])
                self.assertEqual(next_state['sa_first']['count'],2);self.assertEqual(next_state['sa_last']['count'],2)
        finally:self.c.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(self.schema)))

if __name__=='__main__':unittest.main(verbosity=2)
