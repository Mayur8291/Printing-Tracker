"""Independent golden vectors for the approved Flutter develop calculator.

Source: 5d55d9461af18b94a867dce07dee7c4b76f1e51f, lib/app/calculator.dart
(fabric/add-on/overhead/margin, three-decimal unit price, per-unit GST and
branding area). BrandingModel defaults to inch; the unit selector in
lib/ui/widgets/add_branding_widget.dart is commented out. No unit conversion
exists in getBrandingCost, so a conversion-equivalence test would invent scope.

Expected values below are fixed arithmetic examples, not calls to the private
implementation under test. Every assertion uses the public quote RPC.
"""
import decimal
import unittest

import psycopg
from psycopg.types.json import Jsonb

from fixtures import rpc, session
from local_db import connect
from test_catalogue import seed_catalogue
from test_pricing import custom

D = decimal.Decimal


class PricingGoldens(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:
            seed_catalogue(c)

    def setUp(self):
        self.c = connect()
        self.c.execute('BEGIN')
        self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100")
        session(self.c, 101)  # Assigned SC may inspect the fixed cost breakdown.

    def tearDown(self):
        self.c.execute('ROLLBACK')
        self.c.close()

    def raw(self, statement, args=()):
        self.c.execute('RESET ROLE')
        self.c.execute(statement, args)
        session(self.c, 101)

    def quote(self, line):
        return rpc(self.c, 'v1_quote', (Jsonb({
            'customer_id': '103', 'address_id': '100', 'lines': [line],
        }),))

    def assert_amounts(self, actual, expected):
        for field, value in expected.items():
            self.assertEqual(D(actual[field]), D(value), field)

    def test_no_addons_keeps_fabric_stitching_trims_overhead_and_profit(self):
        line = custom(6)
        line['configuration']['parts'][0]['addons'] = []
        q = self.quote(line)
        # 100 fabric + 30 stitching + 5 trims = 135; +13.5 overhead;
        # 20% profit on 148.5 = 29.7; final unit 178.200.
        self.assert_amounts(q['lines'][0]['costs'], {
            'fabric': '100', 'stitching': '30', 'trims': '5', 'addons': '0',
            'manufacturing': '135', 'overhead': '13.5', 'profit': '29.7',
        })
        self.assertEqual(D(q['lines'][0]['variants'][0]['unit_price']), D('178.200'))
        self.assert_amounts(q, {'subtotal': '1069.20', 'cgst': '26.76', 'sgst': '26.76', 'total': '1122.72'})

    def test_multiple_compatible_addons_sum_each_selected_cost_once(self):
        self.raw("""UPDATE sa_snapshot_20261019.sa_add_ons
            SET add_on_price=7,add_on_of=4,add_on_sn=3,group_name='cuff' WHERE id=2""")
        self.raw("""INSERT INTO sa_snapshot_20261019.sa_add_on_base_products
            (base_product_id,add_on_id,created_at,updated_at) VALUES(1,2,now(),now())""")
        line = custom(6)
        line['configuration']['parts'][0]['addons'].append({'addon_id': '2'})
        q = self.quote(line)
        # Original add-on 5+3+2=10; second 7+4+3=14. Base 135+24=159.
        # Overhead 15.9; margin 34.98; final 209.880.
        self.assert_amounts(q['lines'][0]['costs'], {
            'addons': '24', 'manufacturing': '159', 'overhead': '15.9', 'profit': '34.98',
        })
        self.assertEqual(D(q['lines'][0]['variants'][0]['unit_price']), D('209.880'))

    def test_embroidery_rate_tracks_quantity_band_and_tax_rounds_per_unit(self):
        for quantity, expected in [
            (6, {'branding_total': '108', 'subtotal': '1148.40', 'cgst': '31.44', 'sgst': '31.44', 'total': '1319.28'}),
            (10, {'branding_total': '120', 'subtotal': '1754.50', 'cgst': '46.90', 'sgst': '46.90', 'total': '1968.30'}),
        ]:
            with self.subTest(quantity=quantity):
                line = custom(quantity)
                line['brandings'] = [{'type': 'embroidery', 'side': 'front', 'width': '2', 'height': '3', 'unit': 'inch'}]
                q = self.quote(line)
                self.assert_amounts(q, expected)
                self.assertEqual(D(q['lines'][0]['branding']['unit_price']), D('18' if quantity == 6 else '12'))

    def test_print_and_embroidery_on_distinct_sides_preserve_dimensions_and_total(self):
        line = custom(6)
        line['brandings'] = [
            {'type': 'print', 'side': 'front', 'width': '2', 'height': '3', 'unit': 'inch'},
            {'type': 'embroidery', 'side': 'back', 'width': '1.5', 'height': '2', 'unit': 'inch'},
        ]
        q = self.quote(line)
        placements = q['lines'][0]['branding']['placements']
        self.assertEqual([(v['type'], v['side'], v['width'], v['height'], v['unit']) for v in placements],
                         [('print', 'front', '2', '3', 'inch'), ('embroidery', 'back', '1.5', '2', 'inch')])
        self.assertEqual([D(v['unit_price']) for v in placements], [D('12'), D('9')])
        self.assert_amounts(q, {'branding_total': '126', 'subtotal': '1148.40', 'cgst': '31.86', 'sgst': '31.86', 'total': '1338.12'})

    def test_above_999_golden_in_state_and_out_of_state(self):
        self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET sample_rate=1000.01 WHERE id=1')
        self.assert_amounts(self.quote(custom(1)), {
            'subtotal': '1000.01', 'cgst': '60.00', 'sgst': '60.00', 'igst': '0', 'total': '1120.01',
        })
        self.raw("UPDATE sa_snapshot_20261019.sa_addresses SET state='Maharashtra' WHERE id=100")
        self.assert_amounts(self.quote(custom(1)), {
            'subtotal': '1000.01', 'cgst': '0', 'sgst': '0', 'igst': '120.00', 'total': '1120.01',
        })

    def test_third_decimal_unit_rounding_precedes_line_subtotal(self):
        self.raw('UPDATE sa_snapshot_20261019.sa_fabrics SET price=50.001 WHERE id=1')
        q = self.quote(custom(6))
        # 145.002 * 1.1 * 1.2 = 191.40264, rounded to 191.403 per unit;
        # 6 * 191.403 = 1148.418, then line subtotal 1148.42.
        self.assertEqual(D(q['lines'][0]['variants'][0]['unit_price']), D('191.403'))
        self.assertEqual(D(q['subtotal']), D('1148.42'))

    def test_invalid_dimensions_and_unsupported_units_do_not_silently_convert(self):
        for field, value in [('width', '0'), ('width', '-1'), ('height', '0'), ('height', 'Infinity'), ('unit', 'cm'), ('unit', 'mm')]:
            with self.subTest(field=field, value=value):
                line = custom(6)
                branding = {'type': 'embroidery', 'side': 'back', 'width': '2', 'height': '3', 'unit': 'inch'}
                branding[field] = value
                line['brandings'] = [branding]
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    with self.c.transaction():
                        self.quote(line)


if __name__ == '__main__':
    unittest.main(verbosity=2)
