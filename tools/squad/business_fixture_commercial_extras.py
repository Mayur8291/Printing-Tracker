"""Pure exact-owned fixture plan for the three additional commercial journeys.

The common harness owns insertion, checkpoint provenance and cleanup. No Auth
identity, provider configuration, external call, write toggle or commit is made.
"""
import re
import uuid


def plan_fixture(state):
    base = state['data_base']
    label = state['label']
    run = uuid.UUID(state['run_id'])
    assert type(base) is int and 1901000000 <= base <= 2000000000
    assert re.fullmatch(r'SQB [a-f0-9]{12}', label)
    tables = []

    def row(table, offset, **values):
        item = {'id': base + offset, **values}
        tables.append({'table': 'sa_snapshot_20261019.sa_' + table,
                       'ids': [item['id']], 'rows': [item]})

    row('authorized_brands', 100, name=label + ' RMP authorization')
    row('rmp_brands', 101, name=label + ' RMP brand', authorized_brand_id=base + 100)
    row('rmp_categories', 102, name=label + ' RMP category')
    row('rmp_colors', 103, name=label + ' RMP color')
    row('rmp_classes', 104, name=label + ' RMP class', rmp_color_id=base + 103)
    # Legacy order acceptance maps RMP size to custom size by its exact name.
    row('rmp_sizes', 105, name=label + ' size', size_type=0)
    row('rmp_skus', 106, name=label + ' RMP SKU', rmp_class_id=base + 104,
        rmp_brand_id=base + 101, rmp_category_id=base + 102, rmp_size_id=base + 105,
        cgst='2.5', sgst='2.5', igst='5')
    # The fallback pricing rule recognizes this exact name. Only our new SKU
    # links to this owned row; no existing user's price assignment is changed.
    row('rmp_price_types', 107, name='Regular', price_for=0)
    row('rmp_prices', 108, name=label + ' RMP price', price='80', mrp='100',
        rmp_sku_id=base + 106, rmp_price_type_id=base + 107)
    row('rmp_sku_prices', 109, rmp_sku_id=base + 106, rmp_price_id=base + 108)
    row('users', 120, name=label + ' alternate coordinator',
        email=f'squad-business-{run.hex[:12]}-coordinator@mailinator.com',
        encrypted_password='', role=1, approved=True, onboarded=True, disabled=False)
    row('addresses', 121, user_id=base + 3, address=label + ' reviewed customer address',
        state='Karnataka', city=label + ' city', zip_code='560001', is_primary=True)
    return {
        'fixture_tables': tables,
        'commercialExtras': {
            'rmpSkuId': str(base + 106), 'rmpClassId': str(base + 104), 'coordinatorId': str(base + 120),
            'mixedCustomerId': str(base + 3), 'mixedAddressId': str(base + 121),
            'createdCustomerEmail': f'squad-business-{run.hex[:12]}-dealer-customer@mailinator.com',
        },
    }
