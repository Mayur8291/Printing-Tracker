import assert from 'node:assert/strict';
/** Journals an asserted branch, never implies module completion or fixture cleanup. */
export function createCompletedCheckRecorder({log,errors,violations,modules}) {
 const recorded=new Set();
 return (name,check)=>{
  assert.ok(modules.includes(name),'Check belongs to an enabled journey');
  assert.match(check,/^[a-z][a-z0-9_]{2,180}$/,'Stable check identifier required');
  assert.deepEqual(errors,[],'Unexpected browser exceptions before completed check');
  assert.deepEqual(violations,[],'Unexpected raw-table or external request before completed check');
  const key=name+':'+check;assert.ok(!recorded.has(key),'Duplicate completed check');
  log('journey_check_result',{name,check,browser_errors:0,network_violations:0});
  recorded.add(key);
 };
}
