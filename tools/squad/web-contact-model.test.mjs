import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactLinks, accountContacts } from '../../apps/admin/src/squad/components/contactModel.js';
test('retains Indian mobile, landline and explicit international destinations',()=>{
 assert.deepEqual(contactLinks('98765 43210'),{whatsapp:'https://wa.me/919876543210',telephone:'tel:+919876543210'});
 assert.equal(contactLinks('(80) 2345-6789').telephone,'tel:+918023456789');
 assert.equal(contactLinks('+1 (415) 555-0123').telephone,'tel:+14155550123');
 assert.equal(contactLinks('919876543210').whatsapp,'https://wa.me/919876543210');
});
test('rejects URL injection, extensions, control characters and malformed numbers',()=>{
 for(const input of [null,9876543210,'javascript:alert(1)','https://wa.me/919876543210','9876543210?text=secret','9876543210x9','+91\n9876543210','+00000000','0000000000','919876543210'.repeat(4)])assert.equal(contactLinks(input),null);
});
test('uses all scoped linked dealers in stable order else coordinator, without widening scope',()=>{
 const dealer={id:'12',name:'Dealer',phone:'9876543210'},other={id:'13',name:'Other'},sc={id:'20',name:'SC'};
 assert.deepEqual(accountContacts({linked_dealers:[dealer,other,dealer],coordinator_contact:sc}),[dealer,other]);
 assert.deepEqual(accountContacts({linked_dealers:[],coordinator_contact:sc}),[sc]);assert.deepEqual(accountContacts({}),[]);
});
