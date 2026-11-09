import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from './web-tracker-read-hosted.mjs';
import {STAGING} from './web-tracker-read-policy.mjs';
const now=Date.parse('2026-11-09T00:00:00Z');
function config(){return {base:'http://127.0.0.1:5185',url:STAGING,run_id:'00000000-0000-4000-8000-000000000001',actors:['admin','viewer'].map((role,index)=>{
 const id=`00000000-0000-4000-8000-00000000000${index+2}`,email=`local-${role}@example.invalid`,expires=Math.floor(now/1000)+3600;
 const payload={iss:STAGING+'/auth/v1',sub:id,role:'authenticated',exp:expires};
 return {role,id,email,session:{user:{id,email,role:'authenticated'},expires_at:expires,access_token:'header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic-not-a-real-session'}};
})};}
test('accepts exact parent protocol and confines evidence to private tree',()=>{
 const input=config();assert.match(validateConfig(input,now),/tools\/squad\/private\/tracker-read-/);
 input.evidence_dir='/tmp/public-evidence';assert.throws(()=>validateConfig(input,now));
});
test('rejects wrong account identity, role, project and expired session',()=>{
 for(const alter of [c=>c.actors[0].session.user.id=c.actors[1].id,c=>c.actors[0].session.user.role='sa_app',c=>c.actors[0].role='owner',c=>c.url='https://levwrmvqdntngeasrtnb.supabase.co',c=>c.actors[0].session.expires_at=Math.floor(now/1000)+120,c=>c.actors[1].id=c.actors[0].id]){
  const input=config();alter(input);assert.throws(()=>validateConfig(input,now));
 }
});
test('token claims cannot override expected identity or environment',()=>{
 for(const altered of [{iss:'https://levwrmvqdntngeasrtnb.supabase.co/auth/v1'},{sub:'different'},{role:'service_role'}]){
  const input=config(),parts=input.actors[0].session.access_token.split('.');
  parts[1]=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(parts[1],'base64url').toString()),...altered})).toString('base64url');
  input.actors[0].session.access_token=parts.join('.');assert.throws(()=>validateConfig(input,now));
 }
});
