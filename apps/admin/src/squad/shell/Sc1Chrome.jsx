import { useState } from "react";
import { Icon, Sheet, Avatar } from "../../scott-one-ui";
import EnvironmentSwitcherPopover from "../../components/EnvironmentSwitcherPopover";
import { TabIcon } from "../navigation/PersonaChrome";
import { EfficiencyGauge } from "../features/factory/FactoryTabs";
import { usePwa, installAvailable, IosInstallSheet } from "./Sc1Pwa";
import { promptInstall } from "../../pwa";

// Native icon family where a glyph exists; other tabs fall back to the Flutter SVG mask.
const TAB_GLYPH = { orders: "orders", customers: "customers", distributors: "bag", products: "categories", todos: "check" };

// Two long Admin tab names do not fit five across; the full name stays available to screen readers.
const SHORT_LABEL = { "sales-coordinators": "Sales", "production-coordinators": "Production" };

const spa = (onNavigate, href) => (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  onNavigate(href);
};
const displayName = (identity) => identity?.name || identity?.display_name || identity?.email || "Your account";

export function Sc1Header({ identity, root, title, showAdminTools, onBack, onNavigate, onAccount }) {
  return <header className="sc1 sc1-app-header" data-pushed={!root}>
    {root ? <div className="sc1-app-lockup" role="img" aria-label="Scott One">
      <span className="sc1-app-mark" aria-hidden="true" />
      <span className="sc1-type-wordmark" aria-hidden="true">Scott One</span>
    </div> : <div className="sc1-app-back-row">
      <button type="button" className="sc1-app-action" onClick={onBack} aria-label="Back"><Icon name="arrow-left" /></button>
      <p className="sc1-app-title">{title}</p>
    </div>}
    <div className="sc1-app-actions">
      <EnvironmentSwitcherPopover showAdminTools={showAdminTools} />
      <a className="sc1-app-action" href="/squad/notifications" aria-label="Notifications" onClick={spa(onNavigate, "/squad/notifications")}><Icon name="bell" /></a>
      <button type="button" className="sc1-app-action" aria-label={`Account and menu for ${displayName(identity)}`} aria-haspopup="dialog" onClick={onAccount}><Icon name="account" size={28} /></button>
    </div>
  </header>;
}

export function Sc1Dock({ tabs, activeKey, onNavigate }) {
  if (!tabs.length) return null;
  return <div className="sc1 sc1-app-dock">
    <nav className="sc1-dock" aria-label="Primary">
      {tabs.map((tab) => <a key={tab.key} href={tab.href} aria-current={tab.key === activeKey ? "page" : undefined} aria-label={SHORT_LABEL[tab.key] ? tab.label : undefined} onClick={spa(onNavigate, tab.href)}>
        {TAB_GLYPH[tab.key] ? <Icon name={TAB_GLYPH[tab.key]} size={26} /> : <TabIcon name={tab.icon} className="size-6" />}
        <span>{SHORT_LABEL[tab.key] ?? tab.label}</span>
      </a>)}
    </nav>
  </div>;
}

export function Sc1AccountSheet({ open, onOpenChange, identity, items, onNavigate, onSignOut }) {
  const name = displayName(identity);
  const pwa = usePwa();
  const [iosHelp, setIosHelp] = useState(false);
  const install = () => { onOpenChange(false); if (pwa.canInstall) promptInstall(); else setIosHelp(true); };
  const go = (href) => { onOpenChange(false); onNavigate(href); };
  const groups = [...new Set(items.map((item) => item.group))];
  return <><Sheet open={open} onOpenChange={onOpenChange} title="Account" skin="account">
    {open && <>
      <button type="button" className="sc1-account-profile" onClick={() => go("/squad/profile")}>
        <Avatar name={name} size="profile" />
        <span><strong>{name}</strong><small>{identity?.role_name}</small></span>
        <Icon name="chevron-right" size={20} />
      </button>
      <EfficiencyGauge identity={identity} />
      {groups.map((group) => <section key={group} className="sc1-account-group" aria-label={group}>
        <h3 className="sc1-caption">{group}</h3>
        <ul>{items.filter((item) => item.group === group).map((item) => <li key={item.label}>
          <button type="button" onClick={() => go(item.href)}><span>{item.label}</span><Icon name="chevron-right" size={20} /></button>
        </li>)}</ul>
      </section>)}
      {installAvailable(pwa) && <section className="sc1-account-group" aria-label="App"><ul><li><button type="button" onClick={install}><span>Install Scott One</span><Icon name="download" size={20} /></button></li></ul></section>}
      <button type="button" className="sc1-account-signout" onClick={onSignOut}>Sign out</button>
    </>}
  </Sheet><IosInstallSheet open={iosHelp} onOpenChange={setIosHelp} /></>;
}
