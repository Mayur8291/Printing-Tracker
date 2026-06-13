import { cloneElement } from "react";

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true
};

function SidebarIcon({ children, className }) {
  return (
    <svg className={className} {...ICON_PROPS}>
      {children}
    </svg>
  );
}

const SIDEBAR_ICONS = {
  home: (
    <SidebarIcon>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z" />
    </SidebarIcon>
  ),
  printing: (
    <SidebarIcon>
      <path d="M6 9V4h12v5M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <path d="M6 14h12v7H6v-7z" />
    </SidebarIcon>
  ),
  printing_department: (
    <SidebarIcon>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </SidebarIcon>
  ),
  billing: (
    <SidebarIcon>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </SidebarIcon>
  ),
  dispatch: (
    <SidebarIcon>
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7V10z" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </SidebarIcon>
  ),
  inventory: (
    <SidebarIcon>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3.5 8.5L12 13l8.5-4.5M12 22V13" />
    </SidebarIcon>
  ),
  regular: (
    <SidebarIcon>
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z" />
      <path d="M3 6h18M16 10a4 4 0 01-8 0" />
    </SidebarIcon>
  ),
  production_tracker: (
    <SidebarIcon>
      <path d="M12 20V10M18 20V4M6 20v-6" />
    </SidebarIcon>
  ),
  distributor: (
    <SidebarIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </SidebarIcon>
  ),
  shared_links: (
    <SidebarIcon>
      <path d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5" />
      <path d="M14 11a5 5 0 00-7.07 0L5.52 12.41a5 5 0 007.07 7.07L14 19" />
    </SidebarIcon>
  ),
  contact_book: (
    <SidebarIcon>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </SidebarIcon>
  ),
  chat: (
    <SidebarIcon>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    </SidebarIcon>
  ),
  asset_management: (
    <SidebarIcon>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
    </SidebarIcon>
  ),
  audit: (
    <SidebarIcon>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </SidebarIcon>
  ),
  admin: (
    <SidebarIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </SidebarIcon>
  )
};

const FALLBACK_ICON = (
  <SidebarIcon>
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41" />
  </SidebarIcon>
);

export function DashboardSidebarIcon({ tabId, className = "dashboard-sidebar-item-icon" }) {
  const icon = SIDEBAR_ICONS[tabId] ?? FALLBACK_ICON;
  return cloneElement(icon, { className });
}
