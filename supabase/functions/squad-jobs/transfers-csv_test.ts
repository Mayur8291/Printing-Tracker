import {parseCsvRange,csvHeaders,csvObjects,csvCell,CsvError,encodeCsvRows} from './transfers-csv.ts';
const assert=(value:unknown)=>{if(!value)throw new Error('assertion failed');};
const bytes=(text:string)=>new TextEncoder().encode(text);
function collect(text:string,range=40,maxRows=2){
 const all=bytes(text),rows:string[][]=[];let offset=0;
 while(offset<all.length){const chunk=all.slice(offset,offset+range),r=parseCsvRange(chunk,offset+chunk.length===all.length,offset===0,maxRows);if(!r.consumed)throw new Error('fixture range too small for one record');rows.push(...r.rows);offset+=r.consumed;}
 return rows;
}
Deno.test('CSV escaped quotes, embedded commas/newlines and CRLF survive bounded checkpoints',()=>{
 const value='name,description\r\n"One","Quoted ""text"", comma\nand newline"\r\nTwo,Plain\r\n';const all=parseCsvRange(bytes(value),true,true).rows;
 assert(JSON.stringify(collect(value,65,1))===JSON.stringify(all));assert(all[1][1]==='Quoted "text", comma\nand newline');
});
Deno.test('CSV Unicode and BOM survive byte cuts inside multibyte characters',()=>{
 const value='\uFEFFname,value\nनमस्ते,1\nभारत,2\nLast,3';const expected=parseCsvRange(bytes(value),true,true).rows;
 for(let size=30;size<45;size++)assert(JSON.stringify(collect(value,size,1))===JSON.stringify(expected));
});
Deno.test('CSV checkpoints never commit a partial quoted record or escaped quote',()=>{
 const prefix='a,b\n';for(const tail of ['"incomplete','"quote"','"quote""']){const r=parseCsvRange(bytes(prefix+tail),false,true);assert(r.consumed===bytes(prefix).length&&r.rows.length===1);}
});
Deno.test('CSV final records, blank lines and trailing empty fields have explicit behavior',()=>{
 const r=parseCsvRange(bytes('a,b,c\r\n\n1,2,\n3,4,""'),true,true);assert(r.done&&r.rows.length===3&&r.rows[1][2]===''&&r.rows[2][2]==='');
 assert(parseCsvRange(bytes(''),true,true).done);
});
Deno.test('CSV malformed encoding and quotes fail visibly',()=>{
 for(const source of [bytes('a,"unclosed'),bytes('a,b"c\n'),bytes('"x"bad,y\n'),bytes('a,\0b'),new Uint8Array([0xff])]){
  try{parseCsvRange(source,true);throw new Error('accepted');}catch(e){assert(e instanceof CsvError);}
 }
});
Deno.test('CSV fields, records, columns and range size are bounded',()=>{
 for(const text of ['x'.repeat(16385),Array(101).fill('x').join(','),'x'.repeat(262145)]){try{parseCsvRange(bytes(text),true);throw new Error('accepted');}catch(e){assert(e instanceof CsvError);}}
});
Deno.test('CSV headers reject duplicates, empty and ambiguous fields',()=>{
 assert(JSON.stringify(csvHeaders(['RMP SKU','Price Type','price']))==='["rmp_sku","price_type","price"]');
 for(const row of [['name','Name'],['','price'],['secret.path'],['a-b','a_b']]){try{csvHeaders(row);throw new Error('accepted');}catch(e){assert(e instanceof CsvError);}}
 const rows=csvObjects(['a','b'],[['1','2'],['3']],2);assert(rows[1].row===3&&rows[1].error==='COLUMN_COUNT'&&rows[1].values===null);
});
Deno.test('CSV export escapes formulas, quotes and newlines without changing numeric cells',()=>{
 for(const text of ['=HYPERLINK("evil")',' +SUM(1,2)','@cmd','-cmd','\ttext','\rtext'])assert(csvCell(text).startsWith('"\''));
 assert(csvCell(-10)==='"-10"');const output=new TextDecoder().decode(encodeCsvRows([['a,b','a"b','a\nb',null]]));assert(output==='"a,b","a""b","a\nb",""\r\n');
});
Deno.test('CSV deterministic randomized checkpoint sizes preserve every quoted Unicode record',()=>{
 let seed=42;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};const alphabet=['a','"',',','\n','\r','ह','😀',' ','0'];
 const rows=Array.from({length:200},()=>Array.from({length:3},()=>Array.from({length:1+next()%20},()=>alphabet[next()%alphabet.length]).join('')));
 const source=rows.map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
 const expected=rows.filter(row=>row.some(value=>value.trim()!==''));
 for(const range of [300,511,1023,4096])for(const maxRows of [1,7,100])assert(JSON.stringify(collect(source,range,maxRows))===JSON.stringify(expected));
});
