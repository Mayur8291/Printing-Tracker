import test from 'node:test';
import assert from 'node:assert/strict';
import {browserErrorDiagnostic} from './browser-error-diagnostic.mjs';
test('retains useful ordinary startup error without stack',()=>{
 assert.deepEqual(browserErrorDiagnostic({name:'Error',message:'Missing Supabase env vars. Check .env configuration.',stack:'private'}),{name:'Error',message:'Missing Supabase env vars. Check .env configuration.'});
});
test('redacts supplied credentials, identities, URLs and generic tokens',()=>{
 const result=browserErrorDiagnostic({name:'secret-name',message:'Failure secret-password secret-access https://host.invalid/private?token=abc a@b.test 00000000-1111-2222-3333-444444444444 eyJabc.abcdef.signature'},['secret-password','secret-access']);
 assert.equal(result.name,'Error');for(const value of ['secret-password','secret-access','host.invalid','a@b.test','00000000','eyJabc'])assert(!result.message.includes(value));
});
test('structured auth payload is omitted and messages are bounded',()=>{
 assert.equal(browserErrorDiagnostic({message:'{"access_token":"unknown"}'}).message,'Structured error payload omitted');
 assert.equal(browserErrorDiagnostic({message:'x'.repeat(1000)}).message.length,400);
});
