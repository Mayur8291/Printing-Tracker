"""Local-only candidate for the exact existing source ownership fingerprint.

Not wired into hosted cleanup. OFFSET 0 prevents pull-up of the hash projection
without retaining every row in a CTE tuplestore. No predicates, limits, digest
arithmetic, serialization, inventory, or snapshot boundaries are changed.
"""
from psycopg import sql


def statement(schema, tables, *, materialized=False, hash_function=None):
    assert 0 < len(tables) <= 300
    parts = []
    for table, has_id in tables:
        identity = sql.SQL('id') if has_id else sql.SQL('NULL::bigint id')
        maxid = sql.SQL('max(id)') if has_id else sql.SQL('NULL::bigint')
        sums = [sql.SQL("coalesce(sum(('x'||substr(h,{},16))::bit(64)::bigint::numeric),0)::text").format(sql.Literal(n)) for n in (1,17,33,49)]
        # The optional local immutable instrumentation function has the same
        # input/output type and volatility as sha256; production uses sha256.
        function = sql.Identifier(*hash_function) if hash_function else sql.SQL('sha256')
        projection = sql.SQL("SELECT {},encode({}(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM {}.{} t").format(identity,function,sql.Identifier(schema),sql.Identifier(table))
        aggregate = sql.SQL('SELECT {},count(*),{},{} FROM row_hashes').format(sql.Literal(table),maxid,sql.SQL(',').join(sums))
        if materialized:
            parts.append(sql.SQL('(WITH row_hashes AS MATERIALIZED ({}) {})').format(projection,aggregate))
        else:
            parts.append(sql.SQL('(SELECT {},count(*),{},{} FROM ({} OFFSET 0) row_hashes)').format(sql.Literal(table),maxid,sql.SQL(',').join(sums),projection))
    return sql.SQL(' UNION ALL ').join(parts)


def decode(rows):
    return {row[0]: {'count':row[1], 'max_id':row[2], 'digest':list(row[3:])} for row in rows}


def nodes(plan):
    yield plan
    for child in plan.get('Plans', []):
        yield from nodes(child)
