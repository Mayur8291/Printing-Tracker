import { supabase } from "./supabaseClient";
import {
  clampSampleSlaDays,
  clampSampleSlaHours,
  clampSampleSlaWarnHours,
  DEFAULT_SAMPLE_JOB_SHEET_SLA
} from "./sampleJobSheetSlaUtils";

export function mapSampleJobSheetSettingsRow(row) {
  if (!row) return { ...DEFAULT_SAMPLE_JOB_SHEET_SLA };
  return {
    defaultSlaDays: clampSampleSlaDays(row.default_sla_days),
    defaultSlaHours: clampSampleSlaHours(row.default_sla_hours),
    warnHours: clampSampleSlaWarnHours(row.warn_hours),
    urgentHours: clampSampleSlaWarnHours(row.urgent_hours)
  };
}

export async function fetchSampleJobSheetSettings() {
  const { data, error } = await supabase
    .from("sample_job_sheet_settings")
    .select("default_sla_days, default_sla_hours, warn_hours, urgent_hours")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return mapSampleJobSheetSettingsRow(data);
}

export async function saveSampleJobSheetSettings(policy, userId) {
  const payload = {
    id: 1,
    default_sla_days: clampSampleSlaDays(policy.defaultSlaDays),
    default_sla_hours: clampSampleSlaHours(policy.defaultSlaHours),
    warn_hours: clampSampleSlaWarnHours(policy.warnHours),
    urgent_hours: clampSampleSlaWarnHours(policy.urgentHours),
    updated_at: new Date().toISOString(),
    updated_by: userId || null
  };
  const { data, error } = await supabase
    .from("sample_job_sheet_settings")
    .upsert(payload)
    .select("default_sla_days, default_sla_hours, warn_hours, urgent_hours")
    .single();
  if (error) throw error;
  return mapSampleJobSheetSettingsRow(data);
}
