import test from 'node:test';
import assert from 'node:assert/strict';
import {guestFailureDiagnostic} from './guest-failure-diagnostics.mjs';
test('diagnostic keeps exact safe stage and frames but excludes every raw secret',()=>{
 const secrets=['OTP-87654321','password-secret','Bearer ey.private.token','person@mailinator.com'];
 const error=Object.assign(new Error(secrets.join(' ')),{name:'TimeoutError',code:secrets[1]});
 error.stack=`TimeoutError: ${secrets.join(' ')}\n at readCode (file:///private/${secrets[1]}/web-account-entry-adapter.mjs:82:16)\n at ${secrets[0]} (file:///tmp/${secrets[2]}.js:1:1)\n at send (file:///private/web-guest-hosted.mjs:62:22)`;
 const value=guestFailureDiagnostic(error,{kind:'recovery',stage:'completion_status'});
 assert.deepEqual(value,{format:'squad-guest-failure/v1',kind:'recovery',stage:'completion_status',type:'TimeoutError',code:null,frames:[{file:'web-account-entry-adapter.mjs',line:82,column:16},{file:'web-guest-hosted.mjs',line:62,column:22}]});
 for(const secret of secrets)assert.ok(!JSON.stringify(value).includes(secret));
});
test('unknown error labels, flow and stage never become output; frames bounded',()=>{
 const error={name:'secret-type',code:'57014',stack:Array.from({length:100},()=> ' at fn (file:///tmp/squad.js:10:2)').join('\n')};
 const value=guestFailureDiagnostic(error,{kind:'secret-flow',stage:'secret-stage'});
 assert.equal(value.kind,null);assert.equal(value.stage,'initializing');assert.equal(value.type,'Error');assert.equal(value.code,'57014');assert.equal(value.frames.length,8);
});
