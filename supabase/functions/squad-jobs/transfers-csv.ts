/** RFC 4180 records with bounded byte-range checkpoints, UTF-8 only. */
export class CsvError extends Error {constructor(readonly code:string,readonly row?:number){super(code);}}
export interface CsvChunk {rows:string[][];consumed:number;done:boolean;}
export const CSV_RANGE_BYTES=262144,CSV_MAX_FIELD=16384,CSV_MAX_RECORD=65536,CSV_MAX_COLUMNS=100;
export function parseCsvRange(bytes:Uint8Array,eof:boolean,first=false,maxRows=100):CsvChunk {
 if(bytes.length>CSV_RANGE_BYTES||!Number.isInteger(maxRows)||maxRows<1||maxRows>1000)throw new CsvError('CSV_LIMIT');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes,{stream:!eof});}catch{throw new CsvError('INVALID_UTF8');}
 let i=first&&text.charCodeAt(0)===0xfeff?1:0,start=i,consumed=i,cell='',record:string[]=[],quoted=false,closed=false,atStart=true;const rows:string[][]=[];
 const field=()=>{if(cell.length>CSV_MAX_FIELD)throw new CsvError('FIELD_TOO_LONG',rows.length+1);record.push(cell);cell='';closed=false;atStart=true;if(record.length>CSV_MAX_COLUMNS)throw new CsvError('TOO_MANY_COLUMNS',rows.length+1);};
 const row=(end:number)=>{if(new TextEncoder().encode(text.slice(start,end)).length>CSV_MAX_RECORD)throw new CsvError('RECORD_TOO_LONG',rows.length+1);field();if(record.some(v=>v.trim()!==''))rows.push(record);record=[];};
 for(;i<text.length;i++){
  const c=text[i];if(c==='\0')throw new CsvError('BINARY_CONTENT',rows.length+1);
  if(i-start>CSV_MAX_RECORD)throw new CsvError('RECORD_TOO_LONG',rows.length+1);
  if(quoted){
   if(c==='"'){
    if(i+1===text.length&&!eof)break; // May be the first half of an escaped quote.
    if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}
   }else cell+=c;
  }else if(c===','){field();}
  else if(c==='\r'||c==='\n'){
   if(c==='\r'&&text[i+1]==='\n')i++;
   row(i+1);consumed=i+1;start=consumed;if(rows.length>=maxRows)break;
  }else if(c==='"'&&atStart&&!closed){quoted=true;atStart=false;}
  else if(closed){if(c!==' '&&c!=='\t')throw new CsvError('INVALID_QUOTE',rows.length+1);}
  else{if(c==='"')throw new CsvError('INVALID_QUOTE',rows.length+1);cell+=c;atStart=false;}
  if(cell.length>CSV_MAX_FIELD)throw new CsvError('FIELD_TOO_LONG',rows.length+1);
 }
 if(i>=text.length&&eof){
  if(quoted)throw new CsvError('UNCLOSED_QUOTE',rows.length+1);
  if(cell.length||record.length||closed)row(text.length);consumed=text.length;
 }
 const consumedBytes=new TextEncoder().encode(text.slice(0,consumed)).length;
 if(!consumedBytes&&bytes.length===CSV_RANGE_BYTES)throw new CsvError('RECORD_TOO_LONG',rows.length+1);
 return{rows,consumed:consumedBytes,done:eof&&consumedBytes===bytes.length};
}
export function csvHeaders(row:string[]){
 if(!row.length||row.length>CSV_MAX_COLUMNS)throw new CsvError('INVALID_HEADERS');
 const headers=row.map(x=>x.trim().toLowerCase().replace(/[ -]+/g,'_'));
 if(headers.some(x=>!x||x.length>100||!/^[a-z][a-z0-9_]*$/.test(x))||new Set(headers).size!==headers.length)throw new CsvError('INVALID_HEADERS');return headers;
}
export function csvObjects(headers:string[],rows:string[][],firstRow:number){
 return rows.map((cells,index)=>({row:firstRow+index,values:cells.length===headers.length?Object.fromEntries(headers.map((h,i)=>[h,cells[i]])):null,error:cells.length===headers.length?null:'COLUMN_COUNT'}));
}
/** Treat untrusted text as text in spreadsheet applications, including whitespace-prefixed formulas. */
export function csvCell(value:unknown):string {
 let text=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
 if(typeof value!=='number'&&/^[\s\uFEFF]*[=+@-]/u.test(text)||/^[\t\r]/u.test(text))text="'"+text;
 return'"'+text.replaceAll('"','""')+'"';
}
export function encodeCsvRows(rows:unknown[][]){return new TextEncoder().encode(rows.map(row=>row.map(csvCell).join(',')+'\r\n').join(''));}
