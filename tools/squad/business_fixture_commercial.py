"""Exact-owned commercial prerequisites for the reviewed business harness.

This module does not enable writes, create Auth users, invoke providers, commit,
or clean up. The common integrator checkpoints this manifest, owns its database
transaction and removes only verified rows in reverse dependency order.
"""
import re
import uuid

from psycopg import sql
from business_fixture_commercial_extras import plan_fixture as plan_extras

SCHEMA = 'sa_snapshot_20261019'


def plan_fixture(state):
    """Pure, deterministic plan; every prospective insert has an explicit ID."""
    run = uuid.UUID(state['run_id'])
    base = state['data_base']
    actor_base = state['base']
    label = state['label']
    assert type(base) is int and 1901000000 <= base <= 2000000000
    assert type(actor_base) is int and 1900000000 <= actor_base < 1901000000
    assert re.fullmatch(r'SQB [a-f0-9]{12}', label), 'Expected common business fixture label'
    ids = {
        'customerAddressId':base, 'dealerAddressId':base+1, 'sizeId':base+2,
        'reviewCustomerId':base+3, 'baseTypeId':base+4, 'baseProductId':base+5,
        'categoryId':base+6, 'fabricId':base+7, 'colorId':base+8,
        'partId':base+9, 'addonId':base+10, 'partCriterionId':base+11,
        'sizeTypeId':base+14, 'scSizeId':base+15,
    }
    table_rows = []

    def rows(table, values):
        table_rows.append({'table':f'{SCHEMA}.sa_{table}', 'ids':[v['id'] for v in values], 'rows':values})

    rows('users',[{'id':base+3,'name':label+' pending review','email':f'squad-business-{run.hex[:12]}-review@mailinator.com',
                   'encrypted_password':'','role':3,'approved':False,'onboarded':False,'disabled':False,'created_by_id':actor_base+1,'is_direct_deal':False}])
    rows('addresses',[
        {'id':base,'user_id':actor_base+3,'address':label+' customer address','state':'Karnataka','city':label+' city','zip_code':'560001','is_primary':True},
        {'id':base+1,'user_id':actor_base+10,'address':label+' dealer address','state':'Karnataka','city':label+' city','zip_code':'560001','is_primary':True},
    ])
    rows('sizes',[{'id':base+2,'name':label+' size'}])
    rows('size_types',[{'id':base+14,'name':label+' size type'}])
    rows('sc_sizes',[{'id':base+15,'name':label+' size','size_type_id':base+14,'position':0}])
    rows('base_product_types',[{'id':base+4,'name':label+' type'}])
    rows('base_products',[{'id':base+5,'name':label+' base','base_product_type_id':base+4,
                          'size_type_id':base+14,'base_of':20,'base_sn':10,'tims_cost':5,'adult_consumption':2,'kids_consumption':1,
                          'over_header_percentage':10,'sample_rate':500,'calculator':1000}])
    rows('categories',[{'id':base+6,'name':label+' category'}])
    rows('fabrics',[{'id':base+7,'name':label+' fabric','price':600,'uom':'KG','gsm':180}])
    rows('colors',[{'id':base+8,'name':label+' color','created_by_id':None}])
    rows('parts',[{'id':base+9,'name':label+' part','order_criteria':True}])
    rows('add_ons',[{'id':base+10,'add_on':label+' add-on','add_on_price':5,'add_on_of':3,'add_on_sn':2,'has_color':True,'select_type':0,'group_name':label+' addon group'}])
    rows('criteria',[{'id':base+11,'name':label+' part'}])
    for offset, table, fields in [
        (20,'base_product_categories',{'base_product_id':base+5,'category_id':base+6}),
        (21,'base_product_fabrics',{'base_product_id':base+5,'fabric_id':base+7}),
        (22,'fabric_colors',{'fabric_id':base+7,'color_id':base+8}),
        (23,'base_product_parts',{'base_product_id':base+5,'part_id':base+9}),
        (24,'part_colors',{'part_id':base+9,'color_id':base+8}),
        (25,'add_on_parts',{'add_on_id':base+10,'part_id':base+9}),
        (26,'add_on_base_products',{'add_on_id':base+10,'base_product_id':base+5}),
        (27,'add_on_colors',{'add_on_id':base+10,'color_id':base+8}),
        (28,'base_size_types',{'base_product_id':base+5,'size_type_id':base+14}),
    ]:
        rows(table,[{'id':base+offset,**fields}])
    result = {
        'label':label,'ids':{key:str(value) for key,value in ids.items()},
        'reviewCustomerId':str(base+3),
        'createdTeamEmail':f'squad-business-{run.hex[:12]}-created-team@mailinator.com',
        'customConfig':{'base_product_id':str(base+5),'fabric_id':str(base+7),'fabric_color_id':str(base+8),
                        'category_id':str(base+6),'parts':[{'part_id':str(base+9),'color_id':str(base+8),'addons':[{'addon_id':str(base+10),'color_id':str(base+8)}]}]},
        'fixture_tables':table_rows,
        'optional_shared_criteria':[{'id':base+12,'name':'Fabric'},{'id':base+13,'name':'Trims'}],
    }
    extras = plan_extras(state)
    by_table = {entry['table']:entry for entry in table_rows}
    for entry in extras['fixture_tables']:
        if entry['table'] in by_table:
            target = by_table[entry['table']]
            assert not set(target['ids']) & set(entry['ids'])
            target['ids'].extend(entry['ids']);target['rows'].extend(entry['rows'])
        else:
            table_rows.append(entry);by_table[entry['table']] = entry
    result['commercialExtras'] = extras['commercialExtras']
    if 'web_address_location' in state:
        result['web_address_location'] = dict(state['web_address_location'])
    if state.get('weekly_mail_rehearsal') is True:
        from business_fixture_weekly_mail import plan_fixture as plan_weekly
        weekly=plan_weekly(state)
        for entry in weekly['fixture_tables']:
            if entry['table'] in by_table:
                target=by_table[entry['table']]
                assert not set(target['ids']) & set(entry['ids'])
                target['ids'].extend(entry['ids']);target['rows'].extend(entry['rows'])
            else:
                table_rows.append(entry);by_table[entry['table']]=entry
        result['weeklyMail']=weekly['weeklyMail']
    if 'web_content_media' in state:
        from web_content_fixture import planned_rows
        table_rows.append(planned_rows(state))
    return result


def prepare_fixture(c,state):
    """Insert planned prerequisites in the caller's transaction, never commit.

    Before calling, the integrator must persist plan_fixture(state). On uncertain
    commit it can recover the exact planned row set; shared criteria are deleted
    only when their reserved ID and name prove they were inserted by this run.
    """
    assert c.info.transaction_status.name == 'INTRANS', 'Caller must own an active transaction'
    result = plan_fixture(state)
    actor_base = state['base']
    actors = c.execute('SELECT id,role,name FROM sa_snapshot_20261019.sa_users WHERE id=ANY(%s)',
                       ([actor_base+n for n in [0,1,2,3,4,10,11,12]],)).fetchall()
    assert len(actors)==8 and all(role==rid-actor_base and name.startswith(state['label']+' ') for rid,role,name in actors), 'Exact-owned actors required'
    assert c.execute('SELECT is_direct_deal FROM sa_snapshot_20261019.sa_users WHERE id=%s',(actor_base+3,)).fetchone()==(True,), 'Common fixture must start Customer direct'
    tables = result['fixture_tables']
    for entry in tables:
        schema,table = entry['table'].split('.')
        assert not c.execute(sql.SQL('SELECT 1 FROM {}.{} WHERE id=ANY(%s::bigint[]) LIMIT 1').format(sql.Identifier(schema),sql.Identifier(table)),(entry['ids'],)).fetchone(), 'Commercial fixture IDs collide'
    criteria_owned = []
    borrowed = []
    for row in result['optional_shared_criteria']:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',('criteria:'+row['name'],))
        found = c.execute('SELECT id FROM sa_snapshot_20261019.sa_criteria WHERE name=%s ORDER BY id LIMIT 1',(row['name'],)).fetchone()
        if found:
            borrowed.append(str(found[0]))
        else:
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_criteria WHERE id=%s',(row['id'],)).fetchone(), 'Criterion ID collision'
            criteria_owned.append(row)
    if criteria_owned:
        entry = next(entry for entry in tables if entry['table']==SCHEMA+'.sa_criteria')
        entry['rows'].extend(criteria_owned); entry['ids'].extend(row['id'] for row in criteria_owned)
    for entry in tables:
        schema,table = entry['table'].split('.')
        for row in entry['rows']:
            columns = list(row)
            c.execute(sql.SQL('INSERT INTO {}.{} ({},created_at,updated_at) VALUES ({},now(),now())').format(
                sql.Identifier(schema),sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,columns)),
                sql.SQL(',').join(sql.Placeholder() for _ in columns)),list(row.values()))
    result['borrowedCriteriaIds'] = borrowed
    return result
