import test from 'node:test';
import assert from 'node:assert/strict';
import {createSquadClient} from './squad.js';

test('document attachment uses exact purpose-specific reservation and finalization with two-part verification version',async()=>{
 const calls=[],client=createSquadClient({schema:()=>({rpc(){throw Error('unexpected RPC')}}),functions:{async invoke(name,{body}){calls.push({name,body});return {data:{},error:null}}}}),file={filename:'terms.pdf',bytes:123,content_type:'application/pdf'},reserveKey='reserve',command={expectedVersion:'7:19',idempotencyKey:'verify'};
 await client.reserveDocumentAttachment(file,reserveKey);await client.verifyDocumentAttachment('upload',command);await client.finalizeDocumentAttachment('upload',{...command,idempotencyKey:'attach'});
 assert.deepEqual(calls,[{name:'squad-account/documents/attachments',body:{file,idempotency_key:'reserve'}},{name:'squad-account/media/verify',body:{upload_id:'upload',expected_version:'7:19',idempotency_key:'verify'}},{name:'squad-account/documents/attachments/finalize',body:{upload_id:'upload',expected_version:'7:19',idempotency_key:'attach'}}]);
 await assert.rejects(()=>client.withSignal(new AbortController().signal).verifyDocumentAttachment('upload',command));assert.equal(calls.length,3);
});
test('legacy DOC uses its dedicated verification route without changing PDF',async()=>{const calls=[],client=createSquadClient({schema:()=>({rpc(){throw Error('unexpected RPC')}}),functions:{async invoke(name,{body}){calls.push({name,body});return {data:{},error:null}}}}),command={expectedVersion:'7:19',idempotencyKey:'verify'};await client.verifyLegacyDocumentAttachment('upload',command);assert.deepEqual(calls,[{name:'squad-account/documents/attachments/verify',body:{upload_id:'upload',expected_version:'7:19',idempotency_key:'verify'}}]);await assert.rejects(()=>client.withSignal(new AbortController().signal).verifyLegacyDocumentAttachment('upload',command));assert.equal(calls.length,1)});
