import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { buildDealerCardModels, formatDealerCompactINR } from "./dealerCardUtils";
import { shareDealerCardViaWhatsApp } from "./dealerCardShare";
import { fetchEntriesForPeriodRange } from "./dealerReportExport";
import {
  capRangeToToday,
  formatQuarterLabel,
  quarterFromISODate,
  quarterRange,
  yearFromISODate
} from "./dealerReportPeriodUtils";
import {
  DEALERS_SELECT,
  normalizeAllDealerRows,
  todayLocalISODate
} from "./dealerReportUtils";

export default function DealerCardsPanel() {
  const [dealers, setDealers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState(() => yearFromISODate(todayLocalISODate()));
  const [filterQuarter, setFilterQuarter] = useState(() => quarterFromISODate(todayLocalISODate()));
  const [sharingKey, setSharingKey] = useState("");
  const cardRefs = useRef({});

  const quarterContext = useMemo(() => {
    const range = quarterRange(filterYear, filterQuarter);
    const capped = capRangeToToday(range.from, range.to);
    return {
      year: filterYear,
      quarter: filterQuarter,
      label: formatQuarterLabel(filterYear, filterQuarter),
      range: capped,
      quarterStart: range.from,
      quarterEnd: range.to
    };
  }, [filterYear, filterQuarter]);

  const loadDealers = useCallback(async () => {
    const { data, error } = await supabase
      .from("dealers")
      .select(DEALERS_SELECT)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error(error.message);
      return [];
    }
    return normalizeAllDealerRows(data);
  }, []);

  const loadQuarterEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEntriesForPeriodRange(
        supabase,
        quarterContext.range.from,
        quarterContext.range.to
      );
      setEntries(data);
    } catch (err) {
      console.error(err?.message ?? err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [quarterContext.range.from, quarterContext.range.to]);

  const reloadAll = useCallback(async () => {
    const list = await loadDealers();
    setDealers(list);
    await loadQuarterEntries();
  }, [loadDealers, loadQuarterEntries]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    const channel = supabase
      .channel("dealer-cards-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dealer_daily_reports" },
        () => {
          void loadQuarterEntries();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dealer_daily_reports" },
        () => {
          void loadQuarterEntries();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dealers" },
        () => {
          void reloadAll();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadQuarterEntries, reloadAll]);

  const activeDealers = useMemo(() => dealers.filter((d) => d.isActive), [dealers]);
  const cards = useMemo(
    () => buildDealerCardModels(activeDealers, entries, quarterContext),
    [activeDealers, entries, quarterContext]
  );
  const cardsWithTarget = cards.filter((c) => c.quarterlyTarget > 0);

  async function handleShareCard(card) {
    const element = cardRefs.current[card.key];
    if (!element) return;
    setSharingKey(card.key);
    try {
      const result = await shareDealerCardViaWhatsApp(element, card.label);
      if (result.method === "download") {
        alert(
          `Card image saved for ${card.label}. WhatsApp Web opened — attach the downloaded PNG to send the card image.`
        );
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        alert(err?.message ?? "Could not share card image.");
      }
    } finally {
      setSharingKey("");
    }
  }

  return (
    <div className="dealer-cards-panel">
      <header className="dealer-cards-head">
        <div>
          <h3>Dealer cards</h3>
          <p className="dealer-cards-lead">
            Quarterly target vs achieved — updates live when daily reports are saved.
          </p>
        </div>
        <div className="dealer-cards-filters">
          <label className="coordinator-report-field dealer-progress-year">
            <span className="coordinator-report-label">Fiscal year</span>
            <input
              type="number"
              min={2020}
              max={2100}
              value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value) || yearFromISODate(todayLocalISODate()))}
            />
          </label>
          <div className="coordinator-report-group">
            <span className="coordinator-report-label">Quarter</span>
            <div className="coordinator-report-segment" role="group" aria-label="Quarter">
              {[1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  className={filterQuarter === q ? "is-active" : ""}
                  onClick={() => setFilterQuarter(q)}
                >
                  Q{q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {loading ? (
        <p className="dealer-cards-empty">Loading dealer cards…</p>
      ) : cardsWithTarget.length === 0 ? (
        <p className="dealer-cards-empty">
          No quarterly targets set yet. Admin must set annual targets in Dealer Report → Set Target.
        </p>
      ) : (
        <div className="dealer-cards-grid">
          {cardsWithTarget.map((card) => (
            <div key={card.key} className="dealer-card-wrap">
              <article
                ref={(node) => {
                  cardRefs.current[card.key] = node;
                }}
                className="dealer-card"
              >
                <div className="dealer-card-top">
                  <p className="dealer-card-period">THIS QUARTER · {card.periodLabel}</p>
                  <h4 className="dealer-card-name">{card.label}</h4>
                  <div className="dealer-card-metrics-row">
                    <p className="dealer-card-amounts">
                      <strong>{formatDealerCompactINR(card.achieved)}</strong>
                      <span> / {formatDealerCompactINR(card.quarterlyTarget)}</span>
                    </p>
                    <span className="dealer-card-pct">{card.percent}%</span>
                  </div>
                  <div
                    className="dealer-card-bar"
                    role="progressbar"
                    aria-valuenow={Math.min(100, card.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${card.label} quarterly progress`}
                  >
                    <div
                      className={`dealer-card-bar-fill${card.met ? " is-met" : ""}`}
                      style={{ width: `${Math.min(100, card.percent)}%` }}
                    />
                  </div>
                </div>
                <div className="dealer-card-reminder">
                  <p className="dealer-card-reminder-label">TO HIT TARGET, SELL</p>
                  <p className="dealer-card-reminder-rate">
                    {card.remaining > 0 ? `${formatDealerCompactINR(card.sellPerWeek)}/week` : "—"}
                  </p>
                  {card.met ? (
                    <p className="dealer-card-status is-met">Target met</p>
                  ) : card.behindBy > 0 ? (
                    <p className="dealer-card-status is-behind">
                      behind by {formatDealerCompactINR(card.behindBy)}
                    </p>
                  ) : (
                    <p className="dealer-card-status is-on-track">On track</p>
                  )}
                </div>
              </article>
              <button
                type="button"
                className="dealer-card-share-btn"
                disabled={sharingKey === card.key}
                onClick={() => void handleShareCard(card)}
              >
                {sharingKey === card.key ? "Preparing…" : "Share on WhatsApp"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
