import {useQueryClient} from '@tanstack/react-query';
import PdfShareDialog from './PdfShareDialog';
import {catalogueDefaults,validateCatalogueFields,cataloguePreferenceKey} from './cataloguePreferences';
import TermsAttachmentField from './TermsAttachmentField';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Download, FileText, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DetailList } from '@/squad/components';
import { getEnvironmentConfig } from '@/runtimeEnv';
import { useSquadQuery, useSquad } from '@/squad/data/hooks';
import { PageHeader, Panel, QueryState, DataTable, DateText, Status, Pagination, useCursor, useOperationQuery, useOperationCommand, CommandState, Field, Select, RefreshButton } from '../production/OperationsUI';
import PersonPicker from '../production/PersonPicker';
import { roleOf } from '../production/operationsModel';
import { signedDownloadUrl, validateWeek } from '../reports/reportModel';
const LABELS = {
  catalogue: 'Product catalogue',
  delivery_challan: 'Delivery challan',
  tailor_weekly: 'Weekly tailor report'
};
export function documentKinds(identity) {
  const role = roleOf(identity);
  return [...(identity.capabilities?.documents ? [['catalogue', LABELS.catalogue]] : []), ...([4, 7, 10].includes(role) ? [['delivery_challan', LABELS.delivery_challan]] : []), ...([0, 2, 4].includes(role) ? [['tailor_weekly', LABELS.tailor_weekly]] : [])];
}
export default function DocumentsPage(props) {
  const path = String(props.path || '').split('?')[0].split('/').filter(Boolean),
    id = path[2];
  return id === 'new' ? <DocumentRequest key={path[3] || 'new'} {...props} initialKind={path[3]} /> : id ? <DocumentDetail key={id} {...props} id={decodeURIComponent(id)} /> : <DocumentHistory {...props} />;
}
function DocumentHistory({
  sdk,
  identity,
  environment,
  onNavigate
}) {
  const page = useCursor(),
    [kind, setKind] = useState(''),
    [state, setState] = useState(''),
    [legacy, setLegacy] = useState(false);
  const kinds = documentKinds(identity);
  const query = useOperationQuery([environment, identity.id, 'documents', kind, state, legacy, page.cursor], ({sdk}) => sdk.documents({
    kind: kind || undefined,
    state: state || undefined,
    legacy
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  return <div className="space-y-5"><PageHeader title="Documents" description="Generate, track and download documents created for your work.">{kinds.length > 0 && <Button onClick={() => onNavigate('/squad/documents/new')}><Plus />Create document</Button>}</PageHeader><Panel title="Document history" actions={<RefreshButton onClick={query.refresh} />}><div className="mb-5 grid gap-3 sm:grid-cols-3"><Field label="Document type"><Select value={kind} disabled={legacy} onChange={e => {
            setKind(e.target.value);
            page.reset();
          }}><option value="">All types</option>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><Field label="Status"><Select value={state} onChange={e => {
            setState(e.target.value);
            page.reset();
          }}><option value="">All statuses</option>{['queued', 'rendering', 'ready', 'failed', 'expired', 'legacy_pending'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</Select></Field>{identity.capabilities?.documents && <Field label="History"><Select value={String(legacy)} onChange={e => {
            setLegacy(e.target.value === 'true');
            setKind('');
            page.reset();
          }}><option value="false">New documents</option><option value="true">Original catalogues</option></Select></Field>}</div><QueryState query={query} empty={!query.data?.data.length} />{query.data?.data.length > 0 && <DataTable rows={query.data.data} columns={[{
        key: 'kind',
        label: 'Document',
        render: r => <Button variant="link" className="h-auto p-0" onClick={() => onNavigate(`/squad/documents/${encodeURIComponent(r.id)}`)}><FileText />{LABELS[r.kind]}<ArrowUpRight /></Button>
      }, {
        key: 'created_at',
        label: 'Created',
        render: r => <DateText value={r.created_at} />
      }, {
        key: 'state',
        label: 'Status',
        render: r => <Status tone={r.state === 'ready' ? 'success' : ['failed', 'expired'].includes(r.state) ? 'warning' : 'neutral'}>{r.state.replaceAll('_', ' ')}</Status>
      }, {
        key: 'delivery_state',
        label: 'Delivery',
        render: r => r.delivery === 'email' ? r.delivery_state === 'sent' ? 'Sent to mail provider' : r.delivery_state?.replaceAll('_', ' ') : 'Download'
      }, {
        key: 'pages',
        label: 'Pages'
      }]} />}<Pagination cursor={query.data?.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data?.next_cursor)} loading={query.loading} /></Panel></div>;
}
function DocumentDetail({
  sdk,
  identity,
  environment,
  onNavigate,
  id
}) {
  const query = useSquadQuery([environment, identity.id, 'document', id], ({sdk}) => sdk.document(id), {
    refetchInterval: q => ['queued', 'rendering'].includes(q.state.data?.state) ? 3000 : false,
    refetchIntervalInBackground: false
  });
  const document = query.data;
  const [download, setDownload] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),[sharing,setSharing]=useState(false);
  async function prepareDownload() {
    setBusy(true);
    setError('');
    setDownload(null);
    try {
      let response;
      if (document.media_reference) {
        const grants = await sdk.mediaGrants([document.media_reference], {
          download: true
        });
        const grant = grants.references[0];
        if (grant?.status !== 'ready' || !grant.url) throw new Error('This original file is not available. It is recorded as missing; no other environment will be used.');
        response = grant;
      } else response = await sdk.downloadDocument(id);
      setDownload({
        url: signedDownloadUrl(response.url, getEnvironmentConfig(environment).url),
        expires: Date.now() + (response.expires_in || 120) * 1000
      });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="space-y-5"><Button variant="ghost" onClick={() => onNavigate('/squad/documents')}><ArrowLeft />Back to documents</Button><PageHeader title={document ? LABELS[document.kind] : 'Document'} description="Current generation, delivery and download status."><RefreshButton onClick={() => {
        setDownload(null);
        query.refetch();
      }} /></PageHeader><QueryState query={{
      ...query,
      loading: query.isLoading,
      refresh: query.refetch
    }} />{document && <Panel title="Document status" actions={<Status tone={document.state === 'ready' ? 'success' : ['failed', 'expired'].includes(document.state) ? 'warning' : 'neutral'}>{document.state.replaceAll('_', ' ')}</Status>}><DetailList items={[{
        label: 'Created',
        value: <DateText value={document.created_at} />
      }, {
        label: 'Pages',
        value: document.pages ?? 'Not yet available'
      }, {
        label: 'Delivery',
        value: document.delivery === 'email' ? 'Email' : 'Download'
      }, {
        label: 'Email status',
        value: document.delivery === 'email' ? document.delivery_state === 'sent' ? 'Accepted by mail provider; inbox delivery is not confirmed' : document.delivery_state?.replaceAll('_', ' ') : 'Not requested'
      }, {
        label: 'Expiry',
        value: document.expires_at ? <DateText value={document.expires_at} /> : 'Not recorded'
      }]} />{['queued', 'rendering'].includes(document.state) && <div role="status" className="mt-6 rounded-lg border bg-muted/30 p-4"><p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Your document is being prepared. This page updates automatically.</p>{document.total_parts > 0 && <><progress className="mt-3 w-full" max={document.total_parts} value={Math.min(document.completed_parts || 0, document.total_parts)} aria-label="Document generation progress" /><p className="mt-1 text-xs text-muted-foreground">{document.completed_parts || 0} of {document.total_parts} parts</p></>}</div>}{document.state === 'legacy_pending' && <p className="mt-5 text-sm text-muted-foreground">This catalogue was still pending in the original application. It is not a running job in this workspace.</p>}{document.state === 'failed' && <div className="mt-5 space-y-3"><p className="text-sm text-destructive">Generation failed{document.error_code ? ` (${document.error_code})` : ''}. Review your selections and create a new request.</p><Button variant="outline" onClick={() => onNavigate(`/squad/documents/new/${document.kind}`)}>Create new request</Button></div>}{document.state === 'expired' && <p className="mt-5 text-sm text-muted-foreground">This generated document has expired. Create a new document to get an updated copy.</p>}{document.state === 'ready' && <div className="mt-5 flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={prepareDownload}><Download />{busy ? 'Preparing link…' : 'Prepare download'}</Button><Button variant="outline" onClick={()=>setSharing(true)}>Share PDF</Button>{download && <a className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted" href={download.url} target="_blank" rel="noopener noreferrer" onClick={e => {
          if (Date.now() > download.expires) {
            e.preventDefault();
            setDownload(null);
            setError('This secure link expired. Prepare a new download.');
          }
        }}>Open PDF<ArrowUpRight className="ml-2 size-4" /></a>}</div>}{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</Panel>}{sharing&&document&&<PdfShareDialog sdk={sdk} identity={identity} environment={environment} document={document} onClose={()=>setSharing(false)}/>}</div>;
}
function DocumentRequest(props) {
  const {
    sdk,
    identity,
    canWrite,
    onNavigate,
    initialKind
  } = props;
  const kinds = documentKinds(identity),
    [kind, setKind] = useState(kinds.some(([k]) => k === initialKind) ? initialKind : kinds[0]?.[0]);
  const command = useOperationCommand(canWrite, result => onNavigate(`/squad/documents/${result.id}`));
  if (!kind || initialKind && !kinds.some(([k]) => k === initialKind)) return <QueryState query={{
    error: new Error('This document is not available for your role.'),
    refresh: () => onNavigate('/squad/documents')
  }} />;
  return <div className="space-y-5"><Button variant="ghost" onClick={() => onNavigate('/squad/documents')}><ArrowLeft />Back to documents</Button><PageHeader title="Create document" description="Choose the content and delivery method. Generation continues in the background." /><Panel title="Document type"><Field label="Type"><Select value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field></Panel>{kind === 'catalogue' ? <CatalogueRequest key={kind} {...props} command={command} /> : kind === 'tailor_weekly' ? <WeeklyRequest key={kind} {...props} command={command} /> : <ChallanRequest key={kind} {...props} command={command} />}<CommandState command={command} /></div>;
}
function DeliveryField({
  value,
  onChange
}) {
  return <Field label="Delivery"><Select value={value} onChange={e => onChange(e.target.value)}><option value="download">Download in this workspace</option><option value="email">Email to configured recipient</option></Select></Field>;
}
function WeeklyRequest({
  sdk,
  canWrite,
  command,
  path
}) {
  const initial = new URLSearchParams(String(path || '').split('?')[1] || '').get('tailor') || '';
  const [tailor, setTailor] = useState(initial),
    [role, setRole] = useState(5),
    [week, setWeek] = useState(''),
    [includeTeam, setIncludeTeam] = useState(false),
    [delivery, setDelivery] = useState('download');
  return <Panel title="Weekly work and payment report"><form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify(['weekly', tailor, week, includeTeam, delivery]), key => {
        if (!tailor) throw new Error('Choose a tailor.');
        return sdk.requestDocument('tailor_weekly', {
          tailor_id: tailor,
          ...(validateWeek(week) ? {
            week_start: week
          } : {}),
          include_team: role === 5 && includeTeam,
          delivery
        }, key);
      });
    }}><Field label="Workforce"><Select value={role} onChange={e => {
          setRole(Number(e.target.value));
          setTailor('');
        }}><option value="5">Tailor</option><option value="6">Subtailor</option></Select></Field><PersonPicker sdk={sdk} role={role} value={tailor} onChange={setTailor} label={role === 5 ? 'tailor' : 'subtailor'} /><Field label="Week starting Saturday" hint="Leave blank for the previous completed week."><Input type="date" value={week} onChange={e => setWeek(e.target.value)} /></Field>{role === 5 && <label className="flex gap-2 text-sm"><input type="checkbox" checked={includeTeam} onChange={e => setIncludeTeam(e.target.checked)} />Include subtailors</label>}<DeliveryField value={delivery} onChange={setDelivery} /><Button type="submit" disabled={!canWrite || command.busy || !tailor}>Generate weekly PDF</Button></form></Panel>;
}
function ChallanRequest({
  sdk,
  canWrite,
  command
}) {
  const page = useCursor(),
    [selected, setSelected] = useState(null),
    [delivery, setDelivery] = useState('download');
  const query = useOperationQuery(['document-deliveries', page.cursor], ({sdk}) => sdk.deliveries({}, {
    cursor: page.cursor,
    limit: 25
  }));
  return <Panel title="Choose a recorded delivery" description="The challan uses the destination captured when this delivery was recorded."><QueryState query={query} empty={!query.data?.data.length} />{query.data && <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      command.run(JSON.stringify(['challan', selected, delivery]), key => {
        if (!selected) throw new Error('Choose a delivery.');
        return sdk.requestDocument('delivery_challan', {
          item_id: selected.item_id,
          dispatch_id: selected.id,
          delivery
        }, key);
      });
    }}><DataTable rows={query.data.data} columns={[{
        key: 'select',
        label: 'Choose',
        render: r => <input type="radio" name="delivery" aria-label={`Delivery ${r.id}`} checked={selected?.id === r.id} onChange={() => setSelected(r)} />
      }, {
        key: 'id',
        label: 'Delivery',
        render: r => `#${r.id}`
      }, {
        key: 'order_id',
        label: 'Order',
        render: r => `#${r.order_id}`
      }, {
        key: 'occurred_at',
        label: 'Date',
        render: r => <DateText value={r.occurred_at} />
      }, {
        key: 'quantity',
        label: 'Quantity'
      }]} /><Pagination cursor={query.data.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data.next_cursor)} /><DeliveryField value={delivery} onChange={setDelivery} /><Button type="submit" disabled={!canWrite || command.busy || !selected}>Generate challan</Button></form>}</Panel>;
}
function CatalogueRequest({
  sdk,
  environment,
  identity,
  canWrite,
  command
}) {
  const client=useQueryClient(),{scope}=useSquad(),preferencesKey=cataloguePreferenceKey(scope,environment,identity.id);
  const saved=client.getQueryData(preferencesKey);
  const self=useSquadQuery(['catalogue-self',environment,identity.id],({sdk}) => sdk.person(identity.id));
  const [form, setForm] = useState(()=>catalogueDefaults(identity,saved)),
    [selection, setSelection] = useState({}),
    [attachment, setAttachment] = useState(null),
    [uploadBusy, setUploadBusy] = useState(false);
  useEffect(()=>{if(saved)return;const address=self.data?.addresses?.find(a=>a.is_primary);if(!address)return;setForm(v=>({...v,building_name:v.building_name||address.address||'',area:v.area||[address.city,address.state].filter(Boolean).join(', ')}));},[self.data]);
  const update = (key, value) => setForm(v => ({
    ...v,
    [key]: value
  }));
  return <form className="space-y-5" onSubmit={e => {
    e.preventDefault();
    if (uploadBusy) return;
    command.run(JSON.stringify(['catalogue', form, selection, attachment]), key => {
      validateCatalogueFields(form);
      if (!/^\d+(\.\d+)?$/.test(form.markup)) throw new Error('Enter a nonnegative markup.');
      const request = {
        selection,
        markup: {
          kind: form.markupKind,
          value: form.markup
        },
        company_name: form.company_name,
        company_desc: form.company_desc,
        display_stock: form.display_stock,
        bank_details: form.bank_details,
        display_address: form.display_address,
        delivery: form.delivery,
        terms: form.terms,
        ...(attachment ? {
          terms_reference: attachment
        } : {}),
        remarks: form.remarks,
        ...(form.bank_details ? {
          full_name: form.full_name,
          account_no: form.account_no,
          ifsc: form.ifsc
        } : {}),
        ...(form.display_address ? {
          building_name: form.building_name,
          area: form.area
        } : {})
      };
      return sdk.requestDocument('catalogue', request, key).then(result=>{client.setQueryDefaults(preferencesKey,{gcTime:Infinity});client.setQueryData(preferencesKey,{...form});return result;});
    });
  }}><Panel title="Catalogue content" description="By default, include every product available to your account. Use selections to narrow the catalogue."><CatalogueSelection sdk={sdk} selection={selection} onChange={setSelection} /></Panel><Panel title="Company and pricing"><div className="grid gap-4 sm:grid-cols-2"><Field label="Company name" required><Input required maxLength={1000} value={form.company_name} onChange={e => update('company_name', e.target.value)} /></Field><Field label="Company description"><Input maxLength={1000} value={form.company_desc} onChange={e => update('company_desc', e.target.value)} /></Field><Field label="Markup type"><Select value={form.markupKind} onChange={e => update('markupKind', e.target.value)}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></Select></Field><Field label={form.markupKind === 'percentage' ? 'Markup (%)' : 'Markup (₹)'}><Input inputMode="decimal" value={form.markup} onChange={e => update('markup', e.target.value)} /></Field></div><label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={form.display_stock} onChange={e => update('display_stock', e.target.checked)} />Display available stock</label></Panel><Panel title="Contact, payment and terms"><div className="space-y-4"><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.display_address} onChange={e => update('display_address', e.target.checked)} />Include company address</label>{form.display_address && <div className="grid gap-4 sm:grid-cols-2"><Field label="Building / address" required><Input required value={form.building_name} maxLength={1000} onChange={e => update('building_name', e.target.value)} /></Field><Field label="Area" required><Input required value={form.area} maxLength={1000} onChange={e => update('area', e.target.value)} /></Field></div>}<label className="flex gap-2 text-sm"><input type="checkbox" checked={form.bank_details} onChange={e => update('bank_details', e.target.checked)} />Include bank details</label>{form.bank_details && <div className="grid gap-4 sm:grid-cols-3">{[['full_name', 'Account holder'], ['account_no', 'Account number'], ['ifsc', 'IFSC']].map(([key, label]) => <Field key={key} label={label} required><Input required value={form[key]} maxLength={1000} onChange={e => update(key, e.target.value)} /></Field>)}</div>}<Field label="Remarks"><Textarea value={form.remarks} maxLength={1000} onChange={e => update('remarks', e.target.value)} /></Field><Field label="Terms and conditions"><Textarea rows={5} value={form.terms} maxLength={8000} onChange={e => update('terms', e.target.value)} /></Field><TermsAttachmentField sdk={sdk} environment={environment} canWrite={canWrite && !command.busy} value={attachment} onChange={setAttachment} onBusyChange={setUploadBusy} /><DeliveryField value={form.delivery} onChange={value => update('delivery', value)} /></div></Panel><Button type="submit" disabled={!canWrite || command.busy || uploadBusy}>{command.busy ? 'Submitting…' : 'Generate catalogue'}</Button></form>;
}
function CatalogueSelection({
  sdk,
  selection,
  onChange
}) {
  const [kind, setKind] = useState('brand_ids'),
    [excluded, setExcluded] = useState(false);
  const page = useCursor();
  const query = useOperationQuery(['catalogue-document-options', kind, page.cursor], ({sdk}) => kind === 'class_ids' ? sdk.readyMade({}, null, {
    cursor: page.cursor,
    limit: 25
  }) : sdk.catalogueOptions(kind === 'parent_category'?'main_categories':kind === 'brand_ids' ? 'brands' : 'categories', null, {
    cursor: page.cursor,
    limit: 25
  }));
  const field = (excluded ? 'exclude_' : '') + kind,
    values = selection[field] || [];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="Select by"><Select value={kind} onChange={e => {
          setKind(e.target.value);
          page.reset();
        }}><option value="parent_category">Main category</option><option value="brand_ids">Brand</option><option value="category_ids">Category</option><option value="class_ids">Product class</option></Select></Field><Field label="Selection action"><Select disabled={kind==='parent_category'} value={kind==='parent_category'?'false':String(excluded)} onChange={e => setExcluded(e.target.value === 'true')}><option value="false">Include selected</option><option value="true">Exclude selected</option></Select></Field></div>{selection.parent_category&&<div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>Main category: {selection.parent_category}</span><Button type="button" variant="ghost" size="sm" onClick={()=>{const next={...selection};delete next.parent_category;onChange(next);}}>Clear category</Button></div>}<p className="text-xs text-muted-foreground">{Object.values(selection).reduce((sum, ids) => sum + (Array.isArray(ids)?ids.length:ids?1:0), 0)} selections across all filters. Empty inclusion lists mean all available products.</p><QueryState query={query} />{query.data && !query.data.data.length && <p className="py-2 text-sm text-muted-foreground">No options available for this filter.</p>}{query.data && <>{query.data.data.length > 0 && <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{query.data.data.map(row => <label key={row.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted/50"><input type={kind==='parent_category'?'radio':'checkbox'} name={kind==='parent_category'?'main-category':undefined} checked={kind==='parent_category'?selection.parent_category===row.name:values.includes(row.id)} onChange={e => {
            if(kind==='parent_category'){onChange({...selection,parent_category:row.name});return;}
            const updated = e.target.checked ? [...values, row.id] : values.filter(id => id !== row.id);
            onChange({
              ...selection,
              [field]: updated
            });
          }} />{row.name || `Product #${row.id}`}</label>)}</div>}<Pagination cursor={query.data.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data.next_cursor)} /></>}</div>;
}
