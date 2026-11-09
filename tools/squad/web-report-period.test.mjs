import test from 'node:test';
import assert from 'node:assert/strict';
import {indiaDate,todayReportPeriod,reportPeriod} from '../../apps/admin/src/squad/features/reports/reportModel.js';
test('today follows the application India date across UTC midnight',()=>{
 const now=new Date('2026-11-06T19:00:00Z');
 assert.equal(indiaDate(now),'2026-11-07');
 assert.deepEqual(todayReportPeriod(now),{from:'2026-11-07',before:'2026-11-08'});
});
test('end-exclusive today handles month and year rollover',()=>{
 assert.deepEqual(todayReportPeriod(new Date('2026-12-31T18:40:00Z')),{from:'2027-01-01',before:'2027-01-02'});
 assert.deepEqual(todayReportPeriod(new Date('2028-02-28T20:00:00Z')),{from:'2028-02-29',before:'2028-03-01'});
 assert.deepEqual(reportPeriod('2028-02-29','2028-03-01'),{from:'2028-02-29',before:'2028-03-01'});
});
