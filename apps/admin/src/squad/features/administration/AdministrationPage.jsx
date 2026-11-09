import { lazy, Suspense } from 'react';
import { PageHeader, ResourceState } from '../../components';
import { Button } from '../../../components/ui/button';
const StockReconciliation = lazy(() => import('../stock/StockReconciliationPanel'));
const Settings = lazy(() => import('./SettingsPanel'));
const Operations = lazy(() => import('./OperationsPanel'));
const Integrations = lazy(() => import('./IntegrationsPanel'));
const Transfers = lazy(() => import('./TransfersPanel'));
const tabs = [['settings','Settings'],['stock','Stock reconciliation'],['jobs','Background jobs'],['delivery-failures','Delivery failures'],['audit','Activity'],['integrations','Integrations & email'],['transfers','Data imports']];
export default function AdministrationPage(props) {
  const section = props.path.split('/')[3] || 'settings';
  const Panel = section === 'stock' ? StockReconciliation : ['jobs','delivery-failures','audit'].includes(section) ? Operations : section === 'integrations' ? Integrations : section === 'transfers' ? Transfers : section === 'settings' ? Settings : null;
  return <div className="space-y-6"><PageHeader title="Administration" description="Manage application settings and monitor business operations."/>
    <nav className="flex flex-wrap gap-2" aria-label="Administration sections">{tabs.map(([key,label])=><Button key={key} variant={key===section?'default':'outline'} onClick={()=>props.onNavigate(`/squad/administration/${key}`)} aria-current={key===section?'page':undefined}>{label}</Button>)}</nav>
    <Suspense fallback={<ResourceState status="loading"/>}>{Panel ? <Panel {...props} section={section} key={section}/> : <ResourceState title="Page not found"/>}</Suspense>
  </div>;
}
