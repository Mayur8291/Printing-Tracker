import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSquad } from '@/squad/data/hooks';
import { continueSalesExport, newExportState } from './salesExport.js';
export default function ReportExport({
  sdk,
  kind,
  period,
  filters
}) {
  const {
    scope,
    onAuthorizationError
  } = useSquad();
  const key = JSON.stringify([scope, kind, period, filters]);
  const session = useRef(null),
    current = useRef(key),
    alive = useRef(true),
    url = useRef(null),
    lock = useRef(false);
  current.current = key;
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null),
    [error, setError] = useState(''),
    [download, setDownload] = useState(null),
    [resumable, setResumable] = useState(false);
  function clearUrl() {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }
  useEffect(() => {
    alive.current = true;
    session.current?.abort?.abort();
    session.current = null;
    clearUrl();
    setBusy(false);
    setProgress(null);
    setError('');
    setDownload(null);
    setResumable(false);
    return () => {
      alive.current = false;
      session.current?.abort?.abort();
      clearUrl();
    };
  }, [key]);
  async function run() {
    if (lock.current) return;
    lock.current = true;
    setError('');
    setBusy(true);
    setDownload(null);
    clearUrl();
    const ownedKey = key;
    if (session.current?.key !== key || session.current?.state.complete) session.current = {
      key,
      state: newExportState(kind, period, filters)
    };
    const active = session.current;
    active.abort = new AbortController();
    try {
      const blob = await continueSalesExport(sdk, active.state, {
        signal: active.abort.signal,
        isCurrent: () => alive.current && current.current === ownedKey,
        onProgress: p => {
          if (alive.current && current.current === ownedKey) setProgress(p);
        }
      });
      if (!alive.current || current.current !== ownedKey) return;
      url.current = URL.createObjectURL(blob);
      setDownload({
        url: url.current,
        name: `squad-${kind}-${active.state.period.from}-${active.state.period.before}.csv`
      });
      setResumable(false);
    } catch (cause) {
      if (!alive.current || current.current !== ownedKey) return;
      if (['session', 'forbidden'].includes(cause.kind)) onAuthorizationError?.(cause);
      setError(cause.message || 'Export failed.');
      const retryable = cause.name !== 'AbortError' && !['session', 'forbidden', 'conflict', 'validation'].includes(cause.kind) && !/(exceeds|repeated|incomplete|period changed)/i.test(cause.message || '');
      setResumable(retryable && active.state.started);
      if (!retryable) session.current = null;
    } finally {
      lock.current = false;
      if (alive.current && current.current === ownedKey) setBusy(false);
    }
  }
  return <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={busy} onClick={run}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{busy ? 'Preparing CSV…' : resumable ? 'Resume CSV export' : 'Export all filtered rows'}</Button>{busy && <Button type="button" variant="ghost" onClick={() => session.current?.abort?.abort()}><X className="size-4" />Cancel</Button>}{download && <a href={download.url} download={download.name} className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium">Download {progress?.rows.toLocaleString()} rows</a>}</div>{progress && <p role="status" className="text-xs text-muted-foreground">{progress.rows.toLocaleString()} rows prepared · {(progress.bytes / 1048576).toFixed(2)} MB</p>}{error && <p role="alert" className="max-w-lg text-sm text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">Up to 25,000 rows / 16 MB. Keep this page open. A data change stops the export so rows from different revisions are never combined.</p></div>;
}
