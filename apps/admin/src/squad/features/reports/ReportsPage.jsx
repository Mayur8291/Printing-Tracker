import FactoryScopePicker from './FactoryScopePicker';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MetricCard, DetailList } from '@/squad/components';
import { PageHeader, Panel, QueryState, DataTable, DateText, Status, Pagination, useCursor, useOperationQuery, Field, Select, RefreshButton } from '../production/OperationsUI';
import ReportScopePicker from './ReportScopePicker';
import ReportExport from './ReportExport';
import PersonPicker from '../production/PersonPicker';
import { money as formatMoney } from '@/squad/data/format';
import { roleOf } from '../production/operationsModel';
import { SALES_REPORTS, reportTabs, reportPeriod, salesFilters, validateWeek, todayReportPeriod } from './reportModel';
const money = value => value == null ? 'Needs review' : formatMoney(value);
const count = value => value == null ? 'Needs review' : new Intl.NumberFormat('en-IN').format(value);
function Metrics({
  items
}) {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{items.map(([label, value, description]) => <MetricCard key={label} label={label} value={value ?? '—'} description={description} />)}</div>;
}
function ReportFootnote({
  report
}) {
  return report ? <p className="mt-4 text-xs text-muted-foreground">{report.period?.timezone || 'Asia/Kolkata'} · {report.period?.from || report.period?.week_start} to {report.period?.before || report.period?.week_end}{report.period?.before ? ' (end date excluded)' : ''} · Updated {new Date(report.as_of).toLocaleString()}</p> : null;
}
function PeriodControls({
  onApply, initial = {}, today = false
}) {
  const [from, setFrom] = useState(initial.from || ''),
    [before, setBefore] = useState(initial.before || ''),
    [error, setError] = useState('');
  return <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
    e.preventDefault();
    try {
      onApply(reportPeriod(from, before));
      setError('');
    } catch (cause) {
      setError(cause.message);
    }
  }}><Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="Before" hint="End date is excluded"><Input type="date" value={before} onChange={e => setBefore(e.target.value)} /></Field><Button type="submit" variant="outline">Apply period</Button>{today && <Button type="button" variant="ghost" onClick={() => { const period = todayReportPeriod(); setFrom(period.from); setBefore(period.before); setError(''); onApply(period); }}>Today</Button>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</form>;
}
export default function ReportsPage(props) {
  const tabs = reportTabs(roleOf(props.identity));
  const requested = String(props.path || '').split('/')[3];
  const tab = tabs.some(([key]) => key === requested) ? requested : tabs[0]?.[0];
  if (!tab) return <QueryState query={{
    error: new Error('Reports are not available for your account.'),
    refresh: () => props.onNavigate('/squad')
  }} />;
  if (requested && !tabs.some(([key]) => key === requested)) return <QueryState query={{
    error: new Error('This report is not available for your role.'),
    refresh: () => props.onNavigate('/squad/reports')
  }} />;
  return <div className="space-y-5"><PageHeader title="Reports" description="Business performance and operational progress in your scope." /><div className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <Button key={key} variant={key === tab ? 'default' : 'outline'} onClick={() => props.onNavigate(`/squad/reports/${key}`)}>{label}</Button>)}</div>{tab === 'sales' ? <SalesReport {...props} /> : tab === 'coordinator' ? <CoordinatorReport {...props} /> : tab === 'work' ? <WorkReport {...props} /> : tab === 'leaderboard' ? <Leaderboard {...props} /> : <Earnings {...props} />}</div>;
}
function SalesReport({
  sdk,
  identity,
  environment,
  onNavigate
}) {
  const [kind, setKind] = useState('customers'),
    [period, setPeriod] = useState({}),
    [filters, setFilters] = useState({}),
    [draft, setDraft] = useState({}),
    [error, setError] = useState('');
  const page = useCursor();
  const query = useOperationQuery([environment, identity.id, 'sales', kind, period, filters, page.cursor], ({sdk}) => sdk.salesReport(kind, period, filters, {
    cursor: page.cursor,
    limit: 25
  }));
  const report = query.data;
  const itemReport = ['order_items', 'custom_items', 'rmp_items'].includes(kind),
    directory = kind === 'customer_directory';
  const columns = directory ? [{
    key: 'name',
    label: 'Customer',
    render: r => <div><p className="font-medium">{r.company_name || r.name || `#${r.id}`}</p><p className="text-xs text-muted-foreground">{r.email}</p></div>
  }, {
    key: 'phone',
    label: 'Phone'
  }, {
    key: 'coordinator',
    label: 'Coordinator',
    render: r => r.coordinator?.name || 'Unassigned'
  }, {
    key: 'zone',
    label: 'Zone',
    render: r => r.zone?.name || 'Not set'
  }, {
    key: 'approved',
    label: 'Approval',
    render: r => <Status tone={r.approved ? 'success' : 'warning'}>{r.approved ? 'Approved' : 'Pending'}</Status>
  }, {
    key: 'last_order_at',
    label: 'Last order',
    render: r => <DateText value={r.last_order_at} />
  }] : itemReport ? [{
    key: 'id',
    label: 'Item',
    render: r => <Button type="button" variant="link" className="h-auto p-0" onClick={() => onNavigate(`/squad/orders/${r.order_id}`)}>#{r.id} · Order #{r.order_id}</Button>
  }, {
    key: 'customer',
    label: 'Customer',
    render: r => r.customer?.name || `#${r.customer?.id}`
  }, {
    key: 'product',
    label: 'Product',
    render: r => r.product?.name || r.class?.name || 'Not recorded'
  }, {
    key: 'ordered_at',
    label: 'Ordered',
    render: r => <DateText value={r.ordered_at} />
  }, {
    key: 'quantity',
    label: 'Quantity',
    render: r => r.quantity_needs_reconciliation ? 'Needs review' : count(r.quantity)
  }, {
    key: 'subtotal',
    label: 'Subtotal',
    render: r => money(r.subtotal)
  }, {
    key: 'tax',
    label: 'Tax',
    render: r => money(r.tax)
  }, {
    key: 'gross',
    label: 'Gross',
    render: r => money(r.gross)
  }, {
    key: 'provider_status',
    label: 'Status'
  }] : [{
    key: 'name',
    label: SALES_REPORTS.find(r => r[0] === kind)?.[1].replace(' sales', ''),
    render: r => r.name || `#${r.id}`
  }, {
    key: 'orders',
    label: 'Orders'
  }, {
    key: 'quantity',
    label: 'Quantity',
    render: r => count(r.quantity)
  }, {
    key: 'subtotal',
    label: 'Subtotal',
    render: r => money(r.subtotal)
  }, {
    key: 'closed_quantity',
    label: 'Closed quantity',
    render: r => count(r.closed_quantity)
  }, {
    key: 'fill_rate',
    label: 'Fill rate',
    render: r => r.fill_rate == null ? 'Needs review' : `${r.fill_rate}%`
  }, {
    key: 'previous_subtotal',
    label: 'Previous subtotal',
    render: r => r.previous_subtotal == null ? '—' : money(r.previous_subtotal)
  }, {
    key: 'subtotal_growth_percent',
    label: 'Growth',
    render: r => r.subtotal_growth_percent == null ? '—' : `${r.subtotal_growth_percent}%`
  }];
  return <div className="space-y-5"><Panel title="Sales analysis" description="Totals reflect all matching records. Detailed item amounts remain line amounts; order totals are not repeated or added." actions={<RefreshButton onClick={query.refresh} />}><div className="space-y-4"><Field label="Report"><Select value={kind} onChange={e => {
            setKind(e.target.value);
            setDraft({});
            setFilters({});
            page.reset();
          }}>{SALES_REPORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field><PeriodControls onApply={p => {
          setPeriod(p);
          page.reset();
        }} /><form onSubmit={e => {
          e.preventDefault();
          try {
            setFilters(salesFilters(draft));
            page.reset();
            setError('');
          } catch (cause) {
            setError(cause.message);
          }
        }} className="space-y-4"><div className="grid gap-4 sm:grid-cols-3">{!directory && <><Field label="Order status"><Select value={draft.status || ''} onChange={e => setDraft(v => ({
                  ...v,
                  status: e.target.value
                }))}><option value="">All statuses</option>{['pending', 'overdue', 'failed', 'completed'].map(v => <option key={v} value={v}>{v}</option>)}</Select></Field><Field label="Customer type"><Select value={draft.customer_role || ''} onChange={e => setDraft(v => ({
                  ...v,
                  customer_role: e.target.value,
                  customer_id: ''
                }))}><option value="">Customers and dealers</option><option value="3">Customers</option><option value="10">Dealers</option></Select></Field></>}{kind === 'customers' && <Field label="Compare with"><Select value={draft.comparison || ''} onChange={e => setDraft(v => ({
                ...v,
                comparison: e.target.value
              }))}><option value="">No comparison</option>{['previous_period', 'weekly', 'monthly', 'quarterly', 'yearly'].map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</Select></Field>}{itemReport && <><Field label="Order number"><Input inputMode="numeric" value={draft.order_id || ''} onChange={e => setDraft(v => ({
                  ...v,
                  order_id: e.target.value
                }))} /></Field><Field label="Item number"><Input inputMode="numeric" value={draft.item_id || ''} onChange={e => setDraft(v => ({
                  ...v,
                  item_id: e.target.value
                }))} /></Field></>}</div><details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Customer and coordinator filters</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-sm font-medium">Customer</p><PersonPicker sdk={sdk} role={Number(draft.customer_role || 3)} label="customer" value={draft.customer_id || ''} onChange={value => setDraft(v => ({
                  ...v,
                  customer_id: value
                }))} /></div><div><p className="mb-2 text-sm font-medium">Sales coordinator</p><PersonPicker sdk={sdk} role={1} label="sales coordinator" value={draft.coordinator_id || ''} onChange={value => setDraft(v => ({
                  ...v,
                  coordinator_id: value
                }))} /></div></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><ReportScopePicker sdk={sdk} kind="zone" label="Zones" value={draft.zone_id} onChange={value => setDraft(v => ({
                ...v,
                zone_id: value
              }))} />{!directory && <><ReportScopePicker sdk={sdk} kind="brand" label="Brands" value={draft.brand_id} onChange={value => setDraft(v => ({
                  ...v,
                  brand_id: value
                }))} /><ReportScopePicker sdk={sdk} kind="class" label="Product classes" value={draft.class_id} onChange={value => setDraft(v => ({
                  ...v,
                  class_id: value
                }))} /></>}</div></details>{directory && <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.no_orders === true} onChange={e => setDraft(v => ({
              ...v,
              no_orders: e.target.checked ? true : undefined
            }))} />Customers with no orders</label>}<div className="flex gap-2"><Button type="submit" variant="outline">Apply filters</Button><Button type="button" variant="ghost" onClick={() => {
              setDraft({});
              setFilters({});
              page.reset();
            }}>Clear filters</Button></div>{error && <p role="alert" className="text-destructive">{error}</p>}</form></div></Panel><QueryState query={query} />{report && <Panel title={SALES_REPORTS.find(r => r[0] === kind)?.[1]} description={directory ? 'Customer directory is a current roster; the date range does not limit this report.' : itemReport ? 'Item detail totals are per row. Use aggregate reports for full-filter totals.' : null}>{kind === 'unique_customers' ? <Metrics items={[["Unique customers", count(report.summary.total_unique_customers)], ["Custom order customers", count(report.summary.custom_order_customers)], ["Ready-made customers", count(report.summary.rmp_order_customers)], ["Mixed order customers", count(report.summary.mixed_order_customers)]]} /> : <>{!itemReport && !directory && <div className="mb-5"><Metrics items={[["Groups", count(report.summary.groups)], ["Quantity", count(report.summary.quantity)], ["Subtotal", money(report.summary.subtotal)], ["Closed quantity", count(report.summary.closed_quantity)]]} /></div>}{report.summary.needs_reconciliation && <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">Some source amounts or quantities require reconciliation. Unreliable totals are shown as “Needs review”.</p>}<DataTable rows={report.data} columns={columns} /><Pagination cursor={report.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(report.next_cursor)} /></>}<div className="mt-5 border-t pt-4"><ReportExport sdk={sdk} kind={kind} period={{
          from: report.period.from,
          before: report.period.before
        }} filters={filters} /></div><ReportFootnote report={report} /></Panel>}</div>;
}
function CoordinatorReport({
  sdk,
  identity,
  environment
}) {
  const role = roleOf(identity),
    [subject, setSubject] = useState(role === 1 ? identity.id : ''),
    [period, setPeriod] = useState({});
  return <div className="space-y-5"><Panel title="Coordinator performance">{role !== 1 && <div className="mb-4"><PersonPicker sdk={sdk} role={1} value={subject} onChange={setSubject} label="sales coordinator" /></div>}<PeriodControls onApply={setPeriod} /></Panel>{subject ? <CoordinatorResult key={subject} sdk={sdk} identity={identity} environment={environment} subject={subject} period={period} /> : <Panel title="Choose a coordinator"><p className="text-sm text-muted-foreground">Select a coordinator to see their current roster, orders and backlog.</p></Panel>}</div>;
}
function CoordinatorResult({
  sdk,
  identity,
  environment,
  subject,
  period
}) {
  const query = useOperationQuery([environment, identity.id, 'coordinator-report', subject, period], ({sdk}) => sdk.salesCoordinatorMetrics(subject, period));
  const r = query.data;
  return <><QueryState query={query} />{r && <><Metrics items={[["Customers", count(r.customers.current)], ["Orders", count(r.orders.total)], ["Pending orders", count(r.backlog.pending)], ["Overdue", count(r.backlog.overdue)]]} /><Panel title="Customer progress"><DetailList items={[{
          label: 'Awaiting approval',
          value: count(r.customers.pending_approval)
        }, {
          label: 'Awaiting onboarding',
          value: count(r.customers.pending_onboarding)
        }, {
          label: 'New in period',
          value: count(r.customers.new_in_period)
        }, {
          label: 'Completed orders',
          value: count(r.orders.completed)
        }, {
          label: 'Cancelled orders',
          value: count(r.orders.cancelled)
        }, {
          label: 'Pending criteria',
          value: count(r.backlog.pending_criteria)
        }, {
          label: 'Feedback average',
          value: r.feedback.average ?? 'No feedback'
        }]} />{r.sales && <div className="mt-5"><Metrics items={[["Placed sales", money(r.sales.placed)], ["Completed sales", money(r.sales.completed)]]} /></div>}<ReportFootnote report={r} /></Panel></>}</>;
}
function WorkReport({
  sdk,
  identity,
  environment
}) {
  const [period, setPeriod] = useState({});
  const [factory, setFactory] = useState(''),
    [subject, setSubject] = useState(''),
    [subjectRole, setSubjectRole] = useState(4);
  const role = roleOf(identity);
  const query = useOperationQuery([environment, identity.id, 'work-report', period, factory, subject], ({sdk}) => sdk.workMetrics(period, {
    factoryId: factory || undefined,
    subjectId: subject || undefined
  }));
  const r = query.data;
  return <div className="space-y-5"><Panel title="Work performance" description="Period activity and current backlog are shown separately."><PeriodControls onApply={setPeriod} />{[0, 2].includes(role) && <div className="mt-4"><Field label="Factory"><FactoryScopePicker sdk={sdk} value={factory} onChange={v => {
            setFactory(v);
            setSubject('');
          }} /></Field></div>}{[0, 2, 4].includes(role) && <details className="mt-4 rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Person scope (optional)</summary><div className="mt-4 space-y-4"><Field label="Workforce"><Select value={subjectRole} onChange={e => {
              setSubjectRole(Number(e.target.value));
              setSubject('');
            }}>{[[4, 'Factory manager'], [7, 'Dispatch incharge'], [8, 'Inspector'], [9, 'Cutting master'], ...([0, 2].includes(role) ? [[11, 'Job worker']] : [])].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</Select></Field><PersonPicker sdk={sdk} role={subjectRole} value={subject} onChange={setSubject} label="work subject" />{subject && <Button variant="ghost" onClick={() => setSubject('')}>Clear person scope</Button>}</div></details>}</Panel><QueryState query={query} />{r && <><Metrics items={[["Orders in period", count(r.cohort.orders)], ["Completed", count(r.cohort.completed)], ["On-time completion", r.cohort.on_time_percent == null ? 'Not recorded' : `${r.cohort.on_time_percent}%`], ["Current overdue", count(r.backlog.overdue_orders)]]} /><Panel title="Work recorded in period"><Metrics items={[["Cut", count(r.work_in_period.cut)], ["Assigned", count(r.work_in_period.assigned)], ["Inspected / picked", count(r.work_in_period.inspected)], ["Dispatched", count(r.work_in_period.dispatched)]]} /></Panel><Panel title="Current remaining work" description="These are current balances across all dates, not only the selected period."><Metrics items={[["To cut", count(r.factory_balances.remaining_cut)], ["To assign", count(r.factory_balances.remaining_assignment)], ["To inspect", count(r.factory_balances.remaining_inspection)], ["To dispatch", count(r.factory_balances.remaining_dispatch)]]} />{r.factory_balances.needs_reconciliation && <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">{r.factory_balances.invalid_items} item balances need reconciliation.</p>}<ReportFootnote report={r} /></Panel><Panel title="Job work and feedback"><DetailList items={[{
          label: 'Not started',
          value: count(r.worker_stages.not_started)
        }, {
          label: 'In progress',
          value: count(r.worker_stages.in_progress)
        }, {
          label: 'Completed',
          value: count(r.worker_stages.completed)
        }, {
          label: 'Stage not recorded',
          value: count(r.worker_stages.unknown)
        }, {
          label: 'Original due date not recorded',
          value: count(r.backlog.worker_original_due_unknown)
        }, {
          label: 'Feedback average',
          value: r.feedback.average ?? 'No feedback'
        }]} /></Panel></>}</div>;
}
function Leaderboard({
  sdk,
  identity,
  environment,
  onNavigate
}) {
  const page = useCursor(),
    [period, setPeriod] = useState(todayReportPeriod);
  const [factory, setFactory] = useState('');
  const query = useOperationQuery([environment, identity.id, 'tailor-leaderboard', period, factory, page.cursor], ({sdk}) => sdk.tailorLeaderboard(factory || null, period, {
    cursor: page.cursor,
    limit: 25
  }), {refetchInterval: 5 * 60 * 1000, refetchIntervalInBackground: false});
  const role = roleOf(identity);
  return <div className="space-y-5"><Panel title="Tailor leaderboard" description="Ranked by completed quantity. Tailors and subtailors are listed separately.">{[0, 2].includes(role) && <div className="mb-4"><FactoryScopePicker sdk={sdk} value={factory} onChange={v => {
          setFactory(v);
          page.reset();
        }} /></div>}<PeriodControls initial={period} today onApply={p => {
        setPeriod(p);
        page.reset();
      }} /></Panel><QueryState query={query} />{query.data && <Panel title="Team performance"><Metrics items={[["People", count(query.data.summary.subjects)], ["Completed quantity", count(query.data.summary.completed)]]} /><div className="mt-5"><DataTable rows={query.data.data} columns={[{
          key: 'rank',
          label: 'Rank'
        }, {
          key: 'name',
          label: 'Person',
          render: r => <div><p className="font-medium">{r.name}</p><span className="text-xs text-muted-foreground">{r.role === 5 ? 'Tailor' : 'Subtailor'}</span></div>
        }, {
          key: 'assigned',
          label: 'Assigned',
          render: r => count(r.assigned)
        }, {
          key: 'completed',
          label: 'Completed',
          render: r => count(r.completed)
        }, ...([0, 2, 4].includes(role) ? [{
          key: 'amount',
          label: 'Earnings',
          render: r => money(r.amount)
        }] : []), {
          key: 'needs_reconciliation',
          label: 'Status',
          render: r => r.needs_reconciliation ? <Status tone="warning">Needs review</Status> : <Status tone="success">Calculated</Status>
        }]} /></div><Pagination cursor={query.data.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data.next_cursor)} /><ReportFootnote report={query.data} /></Panel>}</div>;
}
function Earnings({
  sdk,
  identity,
  environment,
  onNavigate
}) {
  const [tailor, setTailor] = useState(''),
    [role, setRole] = useState(5),
    [week, setWeek] = useState(''),
    [includeTeam, setIncludeTeam] = useState(false),
    [request, setRequest] = useState(null),
    [error, setError] = useState('');
  return <div className="space-y-5"><Panel title="Weekly tailor earnings" description="Uses the original assignment-week and current completion/rate calculation."><form className="space-y-4" onSubmit={e => {
        e.preventDefault();
        try {
          if (!tailor) throw new Error('Choose a tailor.');
          setRequest({
            tailor,
            week: validateWeek(week),
            includeTeam: role === 5 && includeTeam
          });
          setError('');
        } catch (cause) {
          setError(cause.message);
        }
      }}><Field label="Workforce"><Select value={role} onChange={e => {
            setRole(Number(e.target.value));
            setTailor('');
            setRequest(null);
          }}><option value="5">Tailor</option><option value="6">Subtailor</option></Select></Field><PersonPicker sdk={sdk} role={role} value={tailor} onChange={setTailor} label={role === 5 ? 'tailor' : 'subtailor'} /><Field label="Week starting Saturday" hint="Leave blank for the previous completed week."><Input type="date" value={week} onChange={e => setWeek(e.target.value)} /></Field>{role === 5 && <label className="flex gap-2 text-sm"><input type="checkbox" checked={includeTeam} onChange={e => setIncludeTeam(e.target.checked)} />Include subtailors</label>}<Button type="submit">View earnings</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</form></Panel>{request && <EarningsResult key={JSON.stringify(request)} sdk={sdk} identity={identity} environment={environment} request={request} onNavigate={onNavigate} />}</div>;
}
function EarningsResult({
  sdk,
  identity,
  environment,
  request,
  onNavigate
}) {
  const page = useCursor();
  const query = useOperationQuery([environment, identity.id, 'earnings', request, page.cursor], ({sdk}) => sdk.tailorEarnings(request.tailor, {
    weekStart: request.week,
    includeTeam: request.includeTeam
  }, {
    cursor: page.cursor,
    limit: 25
  }));
  return <><QueryState query={query} />{query.data && <Panel title="Earnings breakdown" actions={<Button variant="outline" onClick={() => onNavigate(`/squad/documents/new/tailor_weekly?tailor=${request.tailor}`)}>Create weekly PDF</Button>}><Metrics items={[["Assigned", count(query.data.summary.assigned)], ["Completed", count(query.data.summary.completed)], ["Pending", count(query.data.summary.pending)], ["Earnings", money(query.data.summary.amount)]]} />{query.data.summary.needs_reconciliation && <p className="my-4 text-sm text-amber-700 dark:text-amber-300">Some source rows need review. Calculated subtotal: {money(query.data.summary.calculated_subtotal)}.</p>}<div className="mt-5"><DataTable rows={query.data.data} columns={[{
          key: 'product_name',
          label: 'Product',
          render: r => r.product_name || `Item #${r.item_id}`
        }, {
          key: 'assigned',
          label: 'Assigned'
        }, {
          key: 'completed',
          label: 'Completed'
        }, {
          key: 'pending',
          label: 'Pending'
        }, {
          key: 'unit_rate',
          label: 'Unit rate',
          render: r => money(r.unit_rate)
        }, {
          key: 'amount',
          label: 'Amount',
          render: r => money(r.amount)
        }, {
          key: 'status',
          label: 'Status',
          render: r => <Status tone={r.status === 'calculated' ? 'success' : 'warning'}>{r.status === 'calculated' ? 'Calculated' : 'Needs review'}</Status>
        }]} /></div><Pagination cursor={query.data.next_cursor} hasPrevious={page.hasPrevious} onPrevious={page.previous} onNext={() => page.next(query.data.next_cursor)} /><ReportFootnote report={query.data} /></Panel>}</>;
}
