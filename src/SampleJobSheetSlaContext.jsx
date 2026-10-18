import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_SAMPLE_JOB_SHEET_SLA } from "./sampleJobSheetSlaUtils";
import { fetchSampleJobSheetSettings } from "./sampleJobSheetSettings";

const SampleJobSheetSlaContext = createContext({
  policy: DEFAULT_SAMPLE_JOB_SHEET_SLA,
  setPolicy: () => {}
});

export function SampleJobSheetSlaProvider({ children }) {
  const [policy, setPolicy] = useState(DEFAULT_SAMPLE_JOB_SHEET_SLA);

  useEffect(() => {
    let cancelled = false;
    fetchSampleJobSheetSettings()
      .then((next) => {
        if (!cancelled) setPolicy(next);
      })
      .catch((err) => {
        console.warn("sample SLA settings:", err?.message || err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ policy, setPolicy }), [policy]);
  return <SampleJobSheetSlaContext.Provider value={value}>{children}</SampleJobSheetSlaContext.Provider>;
}

export function useSampleJobSheetSla() {
  return useContext(SampleJobSheetSlaContext);
}
