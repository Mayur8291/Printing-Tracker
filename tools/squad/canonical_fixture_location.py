"""Pinned source locations with no existing environment relationships."""
import json
from pathlib import Path
COUNTRY_PATH=Path(__file__).resolve().parents[2]/'apps/admin/src/squad/features/people/country.json'
def canonical_locations():
 return {(row['state'],city) for row in json.loads(COUNTRY_PATH.read_text())['states'] for city in row['cities']}
def unused_location(c):
 # Exact pinned source spellings, with no existing city/zone/dealer relationship.
 used={r[0] for r in c.execute('SELECT lower(btrim(city)) FROM sa_snapshot_20261019.sa_addresses UNION SELECT lower(btrim(name)) FROM sa_snapshot_20261019.sa_cities').fetchall()}
 for state,city in sorted(canonical_locations()):
  if city.strip().lower() not in used:return {'state':state,'city':city}
 raise AssertionError('No unused canonical location is available for isolated registration')
def assert_unused_location(c,location):
 assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_addresses WHERE lower(btrim(city))=lower(btrim(%s)) UNION ALL SELECT 1 FROM sa_snapshot_20261019.sa_cities WHERE lower(btrim(name))=lower(btrim(%s)) LIMIT 1',(location['city'],location['city'])).fetchone(),'Synthetic registration location now has existing relationships'
