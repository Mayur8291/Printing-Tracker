// Source saves these preferences in the current user model, not durable storage.
export function catalogueDefaults(identity,saved){return {...{
 company_name:identity.name||identity.company_name||'',company_desc:'',markup:'0',markupKind:'fixed',display_stock:true,bank_details:false,display_address:false,delivery:'download',terms:'',remarks:'',full_name:'',account_no:'',ifsc:'',building_name:'',area:''
},...(saved||{})};}
export function validateCatalogueFields(form){
 const required=['company_name',...(form.bank_details?['full_name','account_no','ifsc']:[]),...(form.display_address?['building_name','area']:[])];
 if(required.some(k=>!String(form[k]??'').trim()))throw new Error('Complete the company name and all enabled address or bank details.');
}
export function cataloguePreferenceKey(scope,environment,id){return['squad',scope,'catalogue-preferences',environment,id];}
