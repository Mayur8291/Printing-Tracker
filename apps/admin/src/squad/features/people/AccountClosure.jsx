import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CommandDialog, Field, SectionCard } from '../../components/index.js';

const CONFIRMATION = 'DELETE MY ACCOUNT';

/**
 * reauthenticate(password) returns an isolated SDK bound to a fresh, same-user
 * password session. Unlike ordinary commands, closure must not invalidate/refetch
 * authenticated queries after revoking them. Keep the original token and command
 * together for an uncertain-response retry; never silently sign in again.
 */
export default function AccountClosure({ identity, canWrite, reauthenticate, onClosed }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [closed, setClosed] = useState(false);
  const attempt = useRef(null);
  const inFlight = useRef(false);
  const passwordInput = useRef(null);
  if (identity.role !== 3) return null;

  async function submit() {
    if (inFlight.current || !canWrite || confirmation !== CONFIRMATION || closed) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      if (!attempt.current) {
        let password = passwordInput.current?.value || '';
        if (passwordInput.current) passwordInput.current.value = '';
        if (!password) throw new Error('Enter your current password to confirm account ownership.');
        let sdk;
        try { sdk = await reauthenticate(password); }
        finally { password = ''; }
        attempt.current = { sdk, command: { expectedVersion: identity.version, idempotencyKey: crypto.randomUUID() } };
      }
      const result = await attempt.current.sdk.closeAccount(CONFIRMATION, attempt.current.command);
      if (result?.state !== 'closed' || result.sessions_revoked !== true) throw new Error('The account closure could not be confirmed. Retry to check the same request.');
      setClosed(true); setOpen(false); attempt.current = null; setRetrying(false);
      await onClosed?.(result);
    } catch (cause) {
      setError(cause);
      // Known transactional server refusals made no changes. A network/unknown
      // response retains both original access token and key to retrieve the receipt.
      if (['validation', 'conflict', 'unavailable', 'forbidden', 'session'].includes(cause.kind)) attempt.current = null;
      setRetrying(Boolean(attempt.current));
    } finally { inFlight.current = false; setPending(false); }
  }

  return <SectionCard title="Close account" description="Permanently stop access to your customer account.">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">You will be signed out on every device and will no longer be able to sign in. Existing orders and business records remain available to the team. This cannot be undone here.</p>
      <Button variant="destructive" className="shrink-0" disabled={!canWrite || pending || closed || !reauthenticate} onClick={() => { setOpen(true); setError(null); }}>{closed ? 'Account closed' : 'Close my account'}</Button>
    </div>
    {closed && <p role="status" className="mt-4 text-sm">Your account is closed and all sessions have been revoked.</p>}
    <CommandDialog open={open} onOpenChange={value => { setOpen(value); if (!value && passwordInput.current) passwordInput.current.value = ''; }} title="Close your account?" description="This permanently removes your access while preserving your order history. Confirm only if you intend to close this account." destructive pending={pending} error={error} disabled={!canWrite || confirmation !== CONFIRMATION} onSubmit={submit} submitLabel={retrying ? 'Check closure and retry' : 'Permanently close account'}>
      {retrying ? <p role="status" className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">The last response was interrupted. Checking again uses the same request, so your account will not be closed twice. Do not sign in again to retry.</p> : <Field label="Current password" required><Input ref={passwordInput} type="password" name="closure_password" autoComplete="current-password" disabled={pending} /></Field>}
      <Field label={`Type ${CONFIRMATION} to confirm`} required><Input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} disabled={pending || retrying} /></Field>
    </CommandDialog>
  </SectionCard>;
}
