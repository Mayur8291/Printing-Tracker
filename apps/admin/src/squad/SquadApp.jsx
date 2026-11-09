import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Package, ShoppingBag, Users, Factory, Scissors, Boxes, CheckSquare, Target, BarChart3, Files, Image, Bell, Settings, UserRound, Flag } from "lucide-react";
import SquadShell from "./SquadShell";
import { useSquad } from "./data/hooks";
import { navigationFor, canVisit } from "./navigation/registry";
import { ResourceState } from "./components";
import HomePage from "./features/home/HomePage";
import ProfilePage from "./features/profile/ProfilePage";
import NotificationsPage from "./features/notifications/NotificationsPage";

const AdministrationPage = lazy(() => import("./features/administration/AdministrationPage"));
const OrdersPage = lazy(() => import("./features/orders/OrdersPage"));
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
const ICONS = {home:Home,catalogue:Package,orders:ShoppingBag,people:Users,production:Factory,"job-work":Scissors,stock:Boxes,tasks:CheckSquare,goals:Target,targets:Flag,reports:BarChart3,documents:Files,promotions:Image,notifications:Bell,administration:Settings,profile:UserRound};
const PAGES = { administration: AdministrationPage, home: HomePage, promotions: PromotionsPage, reports: ReportsPage, documents: DocumentsPage, tasks: WorkPage, goals: WorkPage, targets: TargetsPage, catalogue: CataloguePage, orders: OrdersPage, people: PeoplePage, production: ProductionPage, "job-work": JobWorkPage, stock: StockPage, profile: ProfilePage, notifications: NotificationsPage };
export default function SquadApp() {
  const context = useSquad(); const location = useLocation(); const navigate = useNavigate();
  const module = location.pathname.split("/")[2] || "home";
  const Page = PAGES[module];
  const items = navigationFor(context.identity).map((item) => ({ ...item, icon: ICONS[item.key] }));
  const allowed = canVisit(context.identity, location.pathname);
  return <SquadShell identity={context.identity} navItems={items} activePath={location.pathname} onNavigate={navigate} onSignOut={context.onSignOut} environment={context.environment} writeState={context.writeState}>
    {!allowed ? <ResourceState status="denied" description="Your role does not have access to this workspace." /> : <Suspense fallback={<ResourceState status="loading" />}>
      {Page ? <Page key={location.pathname + location.search} {...context} path={location.pathname} search={location.search} onNavigate={navigate} /> : <ResourceState title="Page not found" description="Choose a workspace from the navigation." />}
    </Suspense>}
  </SquadShell>;
}
