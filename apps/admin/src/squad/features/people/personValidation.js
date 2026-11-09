/** Source forms require ten Indian phone digits; never rewrite unchanged legacy data. */
export function validatePersonContact(values,role,existing){
 const phone=String(values.phone??'').trim(),previous=String(existing?.phone??'').trim();
 if(!(existing&&phone===previous)&&!/^\d{10}$/.test(phone))throw new Error('Enter a ten-digit phone number.');
 if(!existing&&[11,12].includes(Number(role))&&!String(values.designation??'').trim())throw new Error('Enter a designation for this team member.');
}
