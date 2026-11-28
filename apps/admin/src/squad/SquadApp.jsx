import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Home, Package, ShoppingBag, Users, Factory, Scissors, Boxes, CheckSquare, Target, BarChart3, Files, Image, Bell, Settings, UserRound, Flag } from "lucide-react";
import SquadShell from "./SquadShell";
import { sc1Enabled, isTabRoot } from "./navigation/sc1";
import { tabsFor, drawerFor, landingFor, activeTabKey } from "./navigation/personaNav";
import { BottomBar, RightMenu, TabIcon } from "./navigation/PersonaChrome";
import { useSquad } from "./data/hooks";
import { navigationFor, canVisit } from "./navigation/registry";
import { ResourceState } from "./components";
import HomePage from "./features/home/HomePage";
import ProfilePage from "./features/profile/ProfilePage";
import NotificationsPage from "./features/notifications/NotificationsPage";

const AdministrationPage = lazy(() => import("./features/administration/AdministrationPage"));
const FilteredOrdersPage = lazy(() => import("./features/filteredOrders/FilteredOrdersPage"));
const CoordinatorsPage = lazy(() => import("./features/coordinators/CoordinatorsPage"));
const PersonasPage = lazy(() => import("./features/coordinators/AdminExtras").then((m) => ({ default: m.PersonasPage })));
const ForceCompletePage = lazy(() => import("./features/coordinators/AdminExtras").then((m) => ({ default: m.ForceCompletePage })));
const ChangeScPage = lazy(() => import("./features/customers/ChangeScPage"));
const CustomerRequestsPage = lazy(() => import("./features/people/CoordinatorRequests"));
const OrderBoard = lazy(() => import("./features/orders/OrderBoard"));
const TailorsPage = lazy(() => import("./features/factory/FactoryTabs").then((m) => ({ default: m.TailorsPage })));
const DeliveryPage = lazy(() => import("./features/factory/FactoryTabs").then((m) => ({ default: m.DeliveryPage })));
const QueueStats = lazy(() => import("./features/factory/FactoryTabs").then((m) => ({ default: m.QueueStats })));
const OrdersPage = lazy(() => import("./features/orders/OrdersPage"));
const CustomersPage = lazy(() => import("./features/customers/CustomersPage"));
const PeoplePage = lazy(() => import("./features/people/PeoplePage"));
const ProductionPage = lazy(() => import("./features/production/ProductionPage"));
const JobWorkPage = lazy(() => import("./features/jobWork/JobWorkPage"));
const StockPage = lazy(() => import("./features/stock/StockPage"));
const WorkPage = lazy(() => import("./features/work/WorkPage"));
const TargetsPage = lazy(() => import("./features/work/TargetsPage"));
const CataloguePage = lazy(() => import("./features/catalogue/CataloguePage"));
const ReportsPage = lazy(() => import("./features/reports/ReportsPage"));
const DocumentsPage = lazy(() => import("./features/documents/DocumentsPage"));
const PromotionsPage = lazy(() => import("./features/promotions/PromotionsPage"));
const ICONS = {home:Home,catalogue:Package,orders:ShoppingBag,people:Users,customers:Users,distributors:Users,team:Users,production:Factory,"job-work":Scissors,stock:Boxes,tasks:CheckSquare,goals:Target,targets:Flag,reports:BarChart3,documents:Files,promotions:Image,notifications:Bell,administration:Settings,profile:UserRound};
const PAGES = { tailors: TailorsPage, delivery: DeliveryPage, "change-sc": ChangeScPage, "customer-requests": CustomerRequestsPage, coordinators: CoordinatorsPage, personas: PersonasPage, "force-complete": ForceCompletePage, "filtered-orders": FilteredOrdersPage, administration: AdministrationPage, home: HomePage, promotions: PromotionsPage, reports: ReportsPage, documents: DocumentsPage, tasks: WorkPage, goals: WorkPage, targets: TargetsPage, catalogue: CataloguePage, orders: OrdersPage, people: PeoplePage, team: PeoplePage, customers: CustomersPage, distributors: CustomersPage, production: ProductionPage, "job-work": JobWorkPage, stock: StockPage, profile: ProfilePage, notifications: NotificationsPage };
// Flutter-style persona navigation is the default. Explicit ?persona=0 / ?persona=1 is remembered for review and rollback.
function personaNavEnabled(search) {
  try {
    const flag = new URLSearchParams(search).get("persona");
    if (flag === "1" || flag === "0") localStorage.setItem("squad.personaNav", flag);
    return (flag ?? localStorage.getItem("squad.personaNav") ?? "1") === "1";
  } catch { return new URLSearchParams(search).get("persona") !== "0"; }
}
const iconFor = (name) => (props) => <TabIcon name={name} className={props.className} />;
export default function SquadApp() {
  const context = useSquad(); const location = useLocation(); const navigate = useNavigate(); const navigationType = useNavigationType();
  const module = location.pathname.split("/")[2] || "home";
  const persona0 = personaNavEnabled(location.search);
  const boardRole = [1, 2, 3, 4, 10, 11].includes(Number(context.identity.role));
  const Page = persona0 && boardRole && location.pathname.replace(/\/$/, "") === "/squad/orders" ? OrderBoard : PAGES[module];
  const persona = personaNavEnabled(location.search);
  const tabs = persona ? tabsFor(context.identity) : [], drawer = persona ? drawerFor(context.identity) : [];
  const landing = landingFor(context.identity), atHome = module === "home";
  useEffect(() => { if (persona && atHome && landing !== "/squad/home") navigate(landing, { replace: true }); }, [persona, atHome, landing]);
  const items = persona
    ? [...tabs.map((tab) => ({ key: `tab-${tab.key}`, label: tab.label, href: tab.href, group: "Workspace", icon: iconFor(tab.icon) })),
       ...drawer.map((item) => ({ key: `menu-${item.label}`, label: item.label, href: item.href, group: item.group, icon: ICONS[item.href.split("/")[2]] }))]
    : navigationFor(context.identity).map((item) => ({ ...item, icon: ICONS[item.key] }));
  const allowed = canVisit(context.identity, location.pathname);
  const personaProps = persona ? { bottomBar: <BottomBar tabs={tabs} activeKey={activeTabKey(tabs, location.pathname + location.search)} onNavigate={navigate} />, rightMenu: <RightMenu identity={context.identity} items={drawer} onNavigate={navigate} onSignOut={context.onSignOut} /> } : {};
  const scott = persona && sc1Enabled(context.identity, { search: location.search, storage: globalThis.localStorage, setting: import.meta.env.VITE_SQUAD_SC1_PERSONAS });
  const activeKey = activeTabKey(tabs, location.pathname + location.search);
  // Back returns through history; a deep link with no history falls back to the owning tab.
  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate(tabs.find((tab) => tab.key === activeKey)?.href ?? landing, { replace: true }));
  // Pushed pages are headed by what they show, not by whichever menu entry happens to point there.
  const pathName = location.pathname.replace(/\/$/, "");
  const TITLES = { "filtered-orders": "Orders", administration: "Administration", production: "Production", team: "Team", people: "Profile", "job-work": "Job work", distributors: "Distributor", customers: "Customer", orders: "Order", targets: "Milestone" };
  const pageTitle = pathName === "/squad/coordinators/factory" ? "Factory" : pathName.startsWith("/squad/coordinators/") ? "Coordinator" : pathName === "/squad/distributors" ? "Distributors" : TITLES[module];
  const sc1 = scott ? { title: pageTitle, tabs, activeKey, menu: drawer.filter((item, index) => drawer.findIndex((other) => other.href === item.href) === index), navigationType, root: isTabRoot(tabs, location.pathname, location.search), onBack: goBack } : null;
  return <SquadShell {...personaProps} sc1={sc1} identity={context.identity} navItems={items} activePath={location.pathname + location.search} onNavigate={navigate} onSignOut={context.onSignOut} environment={context.environment} writeState={context.writeState}>
    {!allowed ? <ResourceState status="denied" description="Your role does not have access to this workspace." /> : <Suspense fallback={<ResourceState status="loading" />}>
      {Page && persona && module === "production" ? <QueueStats identity={context.identity} scott={scott} hideCounters={scott && location.pathname.replace(/\/$/, "") !== "/squad/production"}><Page key={location.pathname + location.search} {...context} scott={scott} path={location.pathname} search={location.search} onNavigate={navigate} /></QueueStats> : Page ? <Page key={module==="customers"?location.pathname:location.pathname + location.search} {...context} scott={scott} persona={persona} path={location.pathname} search={location.search} onNavigate={navigate} /> : <ResourceState title="Page not found" description="Choose a workspace from the navigation." />}
    </Suspense>}
  </SquadShell>;
}
