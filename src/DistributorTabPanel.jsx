import { useState } from "react";
import DealerCardsPanel from "./DealerCardsPanel";
import DealerReportPanel from "./DealerReportPanel";

export default function DistributorTabPanel({ canEdit = false, isAdmin = false, sessionUserId }) {
  const [subTab, setSubTab] = useState("dealer_report");

  return (
    <section className="panel distributor-panel dashboard-card dashboard-card--flat">
      <div className="distributor-panel-head">
        <h2 className="distributor-panel-title">Distributor</h2>
      </div>
      <div className="orders-tabs distributor-subtabs" role="tablist" aria-label="Distributor views">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "dealer_report"}
          className={subTab === "dealer_report" ? "orders-tab is-active" : "orders-tab"}
          onClick={() => setSubTab("dealer_report")}
        >
          Dealer Report
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "dealer_cards"}
          className={subTab === "dealer_cards" ? "orders-tab is-active" : "orders-tab"}
          onClick={() => setSubTab("dealer_cards")}
        >
          Dealer Cards
        </button>
      </div>
      {subTab === "dealer_report" ? (
        <DealerReportPanel canEdit={canEdit} isAdmin={isAdmin} sessionUserId={sessionUserId} />
      ) : null}
      {subTab === "dealer_cards" ? <DealerCardsPanel /> : null}
    </section>
  );
}
