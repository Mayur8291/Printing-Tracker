import React,{useEffect,useRef,useState} from 'react';
import {Download,Loader2,Share2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {getEnvironmentConfig} from '../../../runtimeEnv';
import {preparePdfFile} from './pdfShareModel';

export default function PdfShareDialog({sdk,identity,environment,document,onClose}){
 const [file,setFile]=useState(null),[download,setDownload]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const attempt=useRef(0),controller=useRef(null),url=useRef('');
 useEffect(()=>{setFile(null);setDownload('');setError('');setMessage('');setBusy(false);return()=>{attempt.current++;controller.current?.abort();if(url.current)URL.revokeObjectURL(url.current);url.current='';};},[sdk,environment,identity.id,document.id]);
 async function prepare(){const current=++attempt.current;controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal;setBusy(true);setError('');setMessage('');setFile(null);if(url.current)URL.revokeObjectURL(url.current);url.current='';setDownload('');
  try{const result=await preparePdfFile({sdk,document,origin:getEnvironmentConfig(environment).url,signal});if(current!==attempt.current)return;url.current=URL.createObjectURL(result);setDownload(url.current);setFile(result);}
  catch(cause){if(current===attempt.current&&!signal.aborted)setError(cause.message||'The PDF could not be prepared.');}
  finally{if(current===attempt.current)setBusy(false);}
 }
 let canShare=false;try{canShare=Boolean(file&&navigator.share&&navigator.canShare?.({files:[file]}));}catch{/* Download remains available. */}
 async function share(){const current=attempt.current;setBusy(true);setError('');try{await navigator.share({files:[file],title:'Squad document'});if(current===attempt.current)setMessage('PDF shared.');}catch(cause){if(current===attempt.current&&cause.name!=='AbortError')setError('File sharing is unavailable. Download the PDF instead.');}finally{if(current===attempt.current)setBusy(false);}}
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="squad-dialog sm:max-w-lg"><DialogHeader><DialogTitle>Share PDF</DialogTitle><DialogDescription>Prepare the original PDF, then choose where to share it.</DialogDescription></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Up to 25 MB. The file is shared directly; temporary download links are not included.</p>{busy&&<p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin"/>{file?'Opening sharing options…':'Preparing your PDF…'}</p>}{file&&<p role="status" className="text-sm">{file.name} is ready.{!canShare&&' This browser does not offer file sharing. Download it to share from your computer.'}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{message&&<p role="status" className="text-sm">{message}</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Close</Button>{!file?<Button disabled={busy} onClick={prepare}><Share2/>Prepare PDF</Button>:<><Button asChild variant={canShare?'outline':'default'}><a href={download} download={file.name}><Download/>Download PDF</a></Button>{canShare&&<Button disabled={busy} onClick={share}><Share2/>Share PDF</Button>}</>}</DialogFooter></DialogContent></Dialog>;
}
