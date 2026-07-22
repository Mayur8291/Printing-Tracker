import { useEffect, useState } from "react";
import PicklistTemplate from "./PicklistTemplate.jsx";
import { SAMPLE_PICKLIST_DATA } from "./picklistTypes.js";

const PREVIEW_API = "/api/picklist/preview-assets";

/**
 * Eyeball page — renders the same template as the Puppeteer PDF pipeline.
 * Barcode + logo assets come from the picklist API server.
 */
export default function PicklistPreviewPage() {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${PREVIEW_API}?picklistNo=${encodeURIComponent(SAMPLE_PICKLIST_DATA.picklistNo)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Preview assets failed (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setAssets(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e?.message ||
              "Picklist API not running. Start with: npm run dev:picklist (or npm run dev:all)."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Picklist preview</h1>
          <p className="text-xs text-slate-600">
            Compare against reference PDF — sample data from picklistTypes.js
          </p>
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
            href="/api/picklist/preview"
            target="_blank"
            rel="noreferrer"
          >
            Open HTML preview
          </a>
          <a
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            href="/api/picklist/pdf/sample"
            target="_blank"
            rel="noreferrer"
          >
            Download sample PDF
          </a>
        </div>
      </div>

      {error ? (
        <p className="mx-auto max-w-[210mm] px-4 text-sm text-red-600">{error}</p>
      ) : !assets ? (
        <p className="mx-auto max-w-[210mm] px-4 text-sm text-slate-600">Loading preview assets…</p>
      ) : (
        <div className="mx-auto max-w-[210mm] border border-slate-300 bg-white shadow-sm">
          <PicklistTemplate data={SAMPLE_PICKLIST_DATA} assets={assets} />
        </div>
      )}
    </div>
  );
}
