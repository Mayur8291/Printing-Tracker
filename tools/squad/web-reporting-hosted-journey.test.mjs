import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {reportingDates} from './web-reporting-hosted-journey.mjs';

const cases=[
 ['2026-11-09T18:29:59.999Z','2026-11-08','2026-11-10','2026-11-07'],
 ['2026-11-09T18:30:00.000Z','2026-11-09','2026-11-11','2026-11-07'],
 ['2026-11-09T23:59:59.999Z','2026-11-09','2026-11-11','2026-11-07'],
 ['2026-11-10T00:00:00.000Z','2026-11-09','2026-11-11','2026-11-07'],
 ['2026-11-06T18:29:59.999Z','2026-11-05','2026-11-07','2026-10-31'],
 ['2026-11-06T18:30:00.000Z','2026-11-06','2026-11-08','2026-11-07'],
 ['2024-02-29T18:30:00.000Z','2024-02-29','2024-03-02','2024-02-24'],
 ['2026-12-31T18:30:00.000Z','2026-12-31','2027-01-02','2026-12-26'],
];
test('report dates obey Kolkata exclusive tomorrow and nonfuture Saturday at civil-date boundaries',()=>{
 for(const [instant,from,before,weekStart]of cases){
  const actual=reportingDates(new Date(instant));assert.deepEqual(actual,{period:{from,before},weekStart});
  assert.equal((Date.parse(before)-Date.parse(from))/86400000,2);
  assert.equal(new Date(weekStart).getUTCDay(),6);
  assert.ok(Date.parse(weekStart)<Date.parse(before));
  // The failed adapter used UTC today+2, which violates report_period before
  // Kolkata midnight. This case must stay exactly UTC today+1 instead.
  if(instant==='2026-11-09T18:29:59.999Z')assert.notEqual(before,'2026-11-11');
 }
});
test('report dates are identical under UTC and Kolkata host timezones',()=>{
 const module=new URL('./web-reporting-hosted-journey.mjs',import.meta.url).href;
 const code=`import {reportingDates} from ${JSON.stringify(module)};console.log(JSON.stringify(${JSON.stringify(cases.map(row=>row[0]))}.map(value=>reportingDates(new Date(value)))));`;
 const results=['UTC','Asia/Kolkata'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'}));
 assert.equal(results[0],results[1]);assert.deepEqual(JSON.parse(results[0]),cases.map(([,from,before,weekStart])=>({period:{from,before},weekStart})));
});
