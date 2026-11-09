import React, {useRef, useState} from 'react';
import {AlertCircle, ChevronLeft, ChevronRight, Loader2, PackageOpen, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {SquadDialogContent as DialogContent} from '../../components/SquadDialogContent';
import {useSquadCommand} from '../../data/hooks';
import {PageHeader, Field as SharedField, StatusBadge, DataTable as SharedTable, ResourceState} from '../../components/index.js';

export function PageTitle(props) {return <PageHeader {...props}/>;}
export function Field({label, children, hint, ...props}) {return <SharedField label={label} hint={hint} required={props.required}>{children || <Input {...props}/>}</SharedField>;}
export function SelectField({label, value, onChange, children, ...props}) {return <Field label={label}><select value={value} onChange={onChange} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...props}>{children}</select></Field>;}
export function Panel({title, description, actions, children, className=''}) {return <section className={`overflow-hidden rounded-xl border bg-card shadow-sm ${className}`}>{(title || actions) && <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{actions}</div>}{children}</section>;}
export function QueryState({query, empty, children, title='Nothing here yet', description='Records will appear here when they are available.'}) {
  if(query.isLoading)return <ResourceState status="loading"/>;
  if(query.error)return <ResourceState status="error" description={query.error.message} onRetry={()=>query.refetch()}/>;
  if(empty)return <ResourceState status="empty" title={title} description={description}/>;
  return children;
}
export function Pager({next, stack, setStack, fetching, count}) {return <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm"><span className="text-muted-foreground">{count ?? 0} records · Page {stack.length}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={stack.length===1 || fetching} onClick={()=>setStack(stack.slice(0,-1))}><ChevronLeft/>Previous</Button><Button variant="outline" size="sm" disabled={!next || fetching} onClick={()=>setStack([...stack,next])}>Next<ChevronRight/></Button></div></div>;}
export function Status(props) {return <StatusBadge {...props}/>;}
export function CommandDialog({title, description, open, onClose, onSubmit, children, disabled=false, confirm='Save changes', destructive=false, version, onSuccess}) {
  const [pending,setPending]=useState(false),[error,setError]=useState(null),lock=useRef(false),command=useSquadCommand();
  async function submit(event){event.preventDefault();if(lock.current || disabled)return;lock.current=true;setPending(true);setError(null);try{const data=Object.fromEntries(new FormData(event.currentTarget));const result=await command.run(c=>onSubmit(data,c),{key:title,payload:data,expectedVersion:version??null});await onSuccess?.(result);onClose();}catch(e){setError(e.message||'Unable to save. Please retry.');}finally{lock.current=false;setPending(false);}}
  return <Dialog open={open} onOpenChange={value=>{if(!value&&!pending)onClose();}}><DialogContent className="squad-dialog max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><fieldset disabled={pending || disabled} className="space-y-4">{children}</fieldset>{error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" variant={destructive?'destructive':'default'} disabled={pending || disabled}>{pending && <Loader2 className="animate-spin"/>}{confirm}</Button></DialogFooter></form></DialogContent></Dialog>;
}
export function DataTable({columns, rows, rowKey='id'}) {return <SharedTable rows={rows} getRowKey={row=>row[rowKey]} columns={columns.map(column=>({...column,render:column.render?(_,row)=>column.render(row):undefined}))}/>;}
