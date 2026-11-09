/** No raw error message, stack header, path, request body, email or proof retained. */
import {readFileSync} from 'node:fs';
export const contract=JSON.parse(readFileSync(new URL('./guest-diagnostic-contract.json',import.meta.url),'utf8'));
export function guestFailureDiagnostic(error,{kind=null,stage='initializing'}={}){
 const frames=[];
 for(const line of String(error?.stack??'').split('\n')){
  const match=line.match(/^\s*at\s+.*\/([A-Za-z0-9_.-]+):(\d{1,7}):(\d{1,7})\)?$/);
  if(match&&contract.files.includes(match[1]))frames.push({file:match[1],line:Number(match[2]),column:Number(match[3])});
  if(frames.length===8)break;
 }
 return {format:'squad-guest-failure/v1',kind:['register','confirm','recovery','invite'].includes(kind)?kind:null,
  stage:contract.stages.includes(stage)?stage:'initializing',type:contract.types.includes(error?.name)?error.name:'Error',
  code:contract.codes.includes(error?.code)?error.code:null,frames};
}
