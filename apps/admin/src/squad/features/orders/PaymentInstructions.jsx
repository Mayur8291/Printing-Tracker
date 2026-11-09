import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useSquadQuery} from '../../data/hooks';
import {DetailList} from '../../components/index.js';
import {QueryState} from './CommerceUI';
import legacyQr from './legacy-payment-qr.jpg';

// Flutter develop 5d55d9461af18b94a867dce07dee7c4b76f1e51f:
// lib/ui/views/payment/payment_view.dart and unchanged assets/payment_qr.jpg.
const BANK=[{label:'Account name',value:'Scott International'},{label:'Account number',value:'9345589225'},{label:'Bank',value:'Kotak Mahindra Bank'},{label:'Branch',value:'Malleshwaram'},{label:'IFSC',value:'KKBK0000418'}];
export function paymentContactUrl(phone){
 const raw=String(phone??'').replace(/[\s()-]/g,'');
 const normalized=/^[6-9][0-9]{9}$/.test(raw)?`91${raw}`:raw.replace(/^\+/, '');
 return /^[1-9][0-9]{9,14}$/.test(normalized)?`https://wa.me/${normalized}`:null;
}

export default function PaymentInstructions({sdk,identity,environment,customerId,orderId}){
 const [open,setOpen]=useState(false),[acknowledged,setAcknowledged]=useState(false);
 const allowed=[1,3,10].includes(identity.role),subject=identity.role===1?customerId:identity.id;
 const person=useSquadQuery(['payment-contact',environment,identity.id,subject],({sdk}) => sdk.person(subject),{enabled:allowed&&open&&!!subject});
 const direct=person.data&&!person.data.dealer_ids?.length&&person.data.coordinator_contact;
 const url=paymentContactUrl(person.data?.coordinator_contact?.phone),live=environment==='production';
 if(!allowed||!subject)return null;
 return <><Button variant="outline" onClick={()=>setOpen(true)}>Payment instructions</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="squad-dialog max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{acknowledged?'Receipt sharing instructions':'Manual payment instructions'}</DialogTitle><DialogDescription>{orderId?`Order #${orderId}. `:''}The sales team confirms payments. Opening these instructions does not mark an order as paid.</DialogDescription></DialogHeader>
  <QueryState query={person} empty={!person.data} title="Payment contact unavailable">{person.data&&(direct?<div className="space-y-5">{!live&&<p className="rounded-lg border bg-muted/40 p-4 text-sm">Staging preview — no payment is required. Payment QR and external contact actions are disabled here.</p>}<div className="grid gap-6 sm:grid-cols-[200px_1fr]">{live?<img src={legacyQr} alt="Scott International payment QR from the existing application" className="w-full max-w-[200px] rounded-lg border bg-white p-3"/>:<div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Payment QR appears in production</div>}<DetailList items={BANK}/></div><div className="rounded-lg border bg-muted/20 p-4"><p className="font-medium">Share your receipt with {person.data.coordinator_contact.name||'your account manager'}</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">After paying, share the receipt screenshot with your assigned account manager. Your payment status changes only after the sales team records it.</p></div><div className="flex flex-wrap gap-3">{live&&url?<Button asChild><a href={url} target="_blank" rel="noopener noreferrer" onClick={()=>setAcknowledged(true)}>Open account manager chat</a></Button>:<Button disabled>{!live?'Contact disabled in staging':'Account manager phone unavailable'}</Button>}<Button variant="outline" onClick={()=>{setAcknowledged(true);setOpen(false);}}>I understand</Button></div></div>:<p className="text-sm leading-relaxed text-muted-foreground">Please contact your linked dealership or sales coordinator for the appropriate payment instructions. Direct company payment details are available only for accounts assigned to direct sales.</p>)}</QueryState>
 </DialogContent></Dialog></>;
}
