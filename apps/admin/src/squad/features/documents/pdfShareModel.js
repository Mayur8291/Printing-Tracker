import {signedDownloadUrl} from '../reports/reportModel.js';
export const PDF_SHARE_LIMIT=25*1024*1024;
export async function preparePdfFile({sdk,document,origin,signal,fetcher=fetch}){
 signal.throwIfAborted();
 let grant;
 if(document.media_reference){
  const result=await sdk.mediaGrants([document.media_reference],{download:true});grant=result.references[0];
  if(grant?.status!=='ready')throw new Error('This original PDF is unavailable. No other environment will be used.');
 }else grant=await sdk.downloadDocument(document.id);
 signal.throwIfAborted();
 const url=signedDownloadUrl(grant?.url,origin);
 const response=await fetcher(url,{signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
 if(!response.ok)throw new Error('The PDF could not be downloaded. Prepare it again.');
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>PDF_SHARE_LIMIT){await response.body?.cancel();throw new Error('This PDF exceeds the 25 MB sharing limit. Use Open PDF instead.');}
 if(!response.body)throw new Error('The PDF download was empty.');
 const reader=response.body.getReader(),parts=[];let total=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>PDF_SHARE_LIMIT)throw new Error('This PDF exceeds the 25 MB sharing limit. Use Open PDF instead.');parts.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 signal.throwIfAborted();
 const file=new File(parts,`${document.kind==='delivery_challan'?'delivery-challan':document.kind==='tailor_weekly'?'tailor-statement':'catalogue'}.pdf`,{type:'application/pdf'});
 if(total<5||new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('The downloaded file is not a valid PDF.');
 signal.throwIfAborted();return file;
}
