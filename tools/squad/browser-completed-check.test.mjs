import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompletedCheckRecorder} from './browser-completed-check.mjs';
test('a later failure leaves only previously asserted branches recorded, not a completed module',()=>{
 const rows=[],errors=[],violations=[];const record=createCompletedCheckRecorder({log:(kind,value)=>rows.push({kind,value}),errors,violations,modules:['workflow-extensions']});
 record('workflow-extensions','first_completed_assertion');
 assert.throws(()=>{throw new Error('later branch failed');},/later/);
 assert.deepEqual(rows,[{kind:'journey_check_result',value:{name:'workflow-extensions',check:'first_completed_assertion',browser_errors:0,network_violations:0}}]);
 errors.push('script error');assert.throws(()=>record('workflow-extensions','second_assertion'),/browser exceptions/);assert.equal(rows.length,1);
});
test('network violations, disabled journeys and duplicate assertions cannot produce acceptance rows',()=>{
 const rows=[],violations=[];const record=createCompletedCheckRecorder({log:(...r)=>rows.push(r),errors:[],violations,modules:['workflow-extensions']});
 assert.throws(()=>record('unrequested','first_assertion'),/enabled journey/);
 violations.push('forbidden request');assert.throws(()=>record('workflow-extensions','first_assertion'),/external request/);violations.length=0;
 record('workflow-extensions','first_assertion');assert.throws(()=>record('workflow-extensions','first_assertion'),/Duplicate/);assert.equal(rows.length,1);
});
