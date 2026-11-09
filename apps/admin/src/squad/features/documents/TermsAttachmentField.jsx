import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/squad/components';
import { putFile } from '@/squad/components/Media';
import { safeMediaUrl, formatBytes } from '@/squad/components/mediaModel';
import { getEnvironmentConfig } from '@/runtimeEnv';
import { useSquadCommand } from '@/squad/data/hooks';
const types = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
export default function TermsAttachmentField({
  sdk,
  environment,
  canWrite,
  value,
  onChange,
  onBusyChange
}) {
  const command = useSquadCommand();
  const intent = useRef(null),
    alive = useRef(true),
    abort = useRef(null),
    lock = useRef(false);
  const [file, setFile] = useState(null),
    [phase, setPhase] = useState(''),
    [progress, setProgress] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  function choose(e) {
    const f = e.target.files?.[0];
    setError('');
    if (!f) return;
    if (!types.includes(f.type) || f.size < 1 || f.size > 5242880) {
      e.target.value = '';
      setError('Choose a PDF, PNG, JPEG or UTF-8 text file up to 5 MB.');
      return;
    }
    intent.current = {
      reserveKey: crypto.randomUUID(),
      finalizeKey: crypto.randomUUID()
    };
    setFile(f);
    onChange(null);
    onBusyChange?.(true);
  }
  async function upload() {
    if (!file || !canWrite || lock.current) return;
    lock.current = true;
    onBusyChange?.(true);
    setError('');
    setPhase('Preparing upload');
    const current = intent.current;
    try {
      const result = await command.run(async () => {
        const u = await sdk.reserveDocumentAttachment({
          filename: file.name,
          bytes: file.size,
          content_type: file.type
        }, current.reserveKey);
        if (!alive.current) throw Error('Upload cancelled.');
        if (u.state === 'reserved') {
          const url = safeMediaUrl(u.upload_url, getEnvironmentConfig(environment).url, true);
          if (!url) throw Error('The upload link does not belong to this environment.');
          setPhase('Uploading');
          setProgress(0);
          abort.current = new AbortController();
          const status = await putFile(url, file, file.type, p => {
            if (alive.current) setProgress(p);
          }, abort.current.signal);
          if (!(status >= 200 && status < 300) && ![400, 409].includes(status)) throw Error('Upload interrupted. Retry to continue.');
        } else if (!['verified', 'attached'].includes(u.state)) throw Error('This upload expired. Choose the file again.');
        if (!alive.current) throw Error('Upload cancelled.');
        setPhase('Verifying attachment');
        return sdk.finalizeDocumentAttachment(u.upload_id, {
          expectedVersion: u.expected_version,
          idempotencyKey: current.finalizeKey
        });
      }, {
        key: 'document.terms-upload',
        payload: {
          key: current.reserveKey,
          filename: file.name,
          bytes: file.size
        }
      });
      if (alive.current) {
        onChange({
          resource: result.resource,
          record_id: result.record_id,
          field: result.field,
          ...(result.pointer !== undefined ? {
            pointer: result.pointer
          } : {})
        });
        setFile(null);
        intent.current = null;
        onBusyChange?.(false);
      }
    } catch (e) {
      if (alive.current) setError(e.message || 'Attachment could not be saved. Retry to continue.');
    } finally {
      lock.current = false;
      if (alive.current) {
        setPhase('');
      }
    }
  }
  return <div className="space-y-3 rounded-lg border p-4"><Field label="Terms attachment (optional)" hint="PDF, PNG, JPEG or UTF-8 text, up to 5 MB. Files are checked before adding them to the catalogue."><input type="file" accept={types.join(',')} onChange={choose} disabled={!canWrite || !!phase} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-foreground" /></Field>
 {value && <div className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><FileText className="size-4" />Terms attachment ready</span><Button type="button" variant="ghost" disabled={!canWrite || !!phase} onClick={() => onChange(null)}>Remove from catalogue</Button></div>}
 {file && <div className="flex flex-wrap items-center gap-3"><p className="min-w-0 break-all text-sm">{file.name} · {formatBytes(file.size)}</p><Button type="button" variant="outline" onClick={upload} disabled={!canWrite || !!phase}><UploadCloud className="size-4" />{phase || 'Upload terms attachment'}</Button>{!phase && <Button type="button" variant="ghost" onClick={() => {
        setFile(null);
        intent.current = null;
        setError('');
        onBusyChange?.(false);
      }}>Remove selected file</Button>}{phase === 'Uploading' && <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}><X className="size-4" />Cancel upload</Button>}</div>}
 {phase === 'Uploading' && <progress className="w-full" value={progress} max="100" aria-label="Terms upload progress" />}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
 </div>;
}
