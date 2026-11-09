import { forwardRef, useRef } from 'react';
import { DialogContent } from '@/components/ui/dialog';

/** Controlled dialogs often open without Radix's Trigger component. Preserve the
 * actual keyboard invoker rather than leaving focus on the document after close. */
export const SquadDialogContent = forwardRef(function SquadDialogContent({onOpenAutoFocus,onCloseAutoFocus,...props},ref) {
  const invoker=useRef(null);
  return <DialogContent {...props} ref={ref} onOpenAutoFocus={event=>{
    const active=document.activeElement;
    if(active instanceof HTMLElement && active!==document.body && !active.closest('[role="dialog"]'))invoker.current=active;
    onOpenAutoFocus?.(event);
  }} onCloseAutoFocus={event=>{
    onCloseAutoFocus?.(event);
    if(!event.defaultPrevented && invoker.current?.isConnected){event.preventDefault();invoker.current.focus({preventScroll:true});}
  }}/>;
});
