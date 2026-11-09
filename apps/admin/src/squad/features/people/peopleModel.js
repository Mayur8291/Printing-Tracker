export const PERSONAS={0:'Admin',1:'Sales Coordinator',2:'Production Coordinator',3:'Customer',4:'Factory Manager',5:'Tailor',6:'SubTailor',7:'Dispatch Incharge',8:'Inspector',9:'Cutting Master',10:'Dealer',11:'Job Worker',12:'Assistant Worker / Team'};
export function manageableRoles(role){return ({0:[0,1,2,3,4,5,6,7,8,9,10,11,12],1:[3,10],2:[4,5,6,7,8,9],4:[5,6,7,8,9],10:[3]})[Number(role)]??[];}
export function accountStatus(person){return person.disabled?'Disabled':person.approved!==true?'Awaiting approval':!person.onboarded?'Onboarding':'Active';}
export function peopleFilterValues(values){
 const filters={};
 for(const key of ['onboarded','direct'])if(values[key]==='true'||values[key]==='false')filters[key]=values[key]==='true';
 for(const key of ['coordinator_id','dealer_id','zone_id','price_type_id','factory_id','manager_id','parent_tailor_id'])if(/^[1-9]\d*$/.test(values[key]??''))filters[key]=values[key];
 if(/^[0-3]$/.test(values.registered_by??''))filters.registered_by=[Number(values.registered_by)];
 return filters;
}
export function savePerson(sdk,id,role,fields,command){if(role===5)return sdk.saveTailor(id,fields,command);if(role===6)return sdk.saveSubtailor(id,fields,command);if([7,8,9].includes(role))return sdk.saveFactoryTeam(id,role,fields,command);return sdk.savePerson(id,role,fields,command);}
export function personFields(values,role,{existing=false,actor}={}){
  const fields=Object.fromEntries(['name','phone','first_name','last_name','company_name','gst_no','designation'].filter(k=>values[k]!==undefined).map(k=>[k,values[k].trim()]));
  if(!existing&&![5,6].includes(role))fields.email=values.email?.trim();
  if(role===4&&values.factory_id)fields.factory_id=values.factory_id;
  if([5,6,7,8,9].includes(role)&&values.manager_id)fields.manager_id=values.manager_id;
  if(role===6&&values.parent_tailor_id)fields.parent_tailor_id=values.parent_tailor_id;
  return fields;
}

/** Bounded, visible-page selection; never fetches or assumes unseen customers. */
export function selectVisiblePeople(selected,rows,select=true){
 const result={...selected};
 for(const row of rows){if(![3,10].includes(row.role))continue;if(!select){delete result[row.id];continue;}if(result[row.id]||Object.keys(result).length<100)result[row.id]={id:row.id,version:row.version};}
 return result;
}
