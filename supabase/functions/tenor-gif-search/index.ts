// Deploy: supabase functions deploy tenor-gif-search
// Secret: supabase secrets set TENOR_API_KEY=your_google_cloud_tenor_api_key
//
// Proxies Tenor v2 (tenor.googleapis.com) server-side — browser cannot call Tenor directly (no CORS).
// See https://developers.google.com/tenor/guides/endpoints#search

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const CLIENT_KEY = "scott_dashboard";
const TENOR_BASE = "https://tenor.googleapis.com/v2";

type TenorGifResult = {
  id: string;
  url: string;
  preview: string;
};

function mapTenorResults(json: Record<string, unknown>): TenorGifResult[] {
  const results = (json.results ?? []) as Array<Record<string, unknown>>;
  return results
    .map((item) => {
      const formats = (item.media_formats ?? {}) as Record<string, { url?: string }>;
      const url = formats.gif?.url || formats.tinygif?.url || formats.mediumgif?.url || "";
      const preview = formats.tinygif?.url || formats.nanogif?.url || formats.gif?.url || url;
      return { id: String(item.id ?? ""), url, preview };
    })
    .filter((g) => g.url);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = (Deno.env.get("TENOR_API_KEY") ?? "").trim();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Tenor API key not configured on server. Set TENOR_API_KEY in Supabase Edge Function secrets."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let q = "hello";
    let limit = 20;
    let mode: "search" | "featured" = "search";

    if (req.method === "GET") {
      const url = new URL(req.url);
      q = (url.searchParams.get("q") ?? "").trim() || "hello";
      limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
      mode = url.searchParams.get("mode") === "featured" ? "featured" : "search";
    } else {
      const body = await req.json().catch(() => ({}));
      q = String(body.q ?? "").trim() || "hello";
      limit = Math.min(50, Math.max(1, Number(body.limit ?? 20) || 20));
      mode = body.mode === "featured" ? "featured" : "search";
    }

    const endpoint = mode === "featured" ? `${TENOR_BASE}/featured` : `${TENOR_BASE}/search`;
    const params = new URLSearchParams({
      key: apiKey,
      client_key: CLIENT_KEY,
      limit: String(limit),
      media_filter: "tinygif,gif",
      locale: "en_US"
    });
    if (mode === "search") {
      params.set("q", q);
    }

    const tenorRes = await fetch(`${endpoint}?${params.toString()}`);
    const tenorJson = await tenorRes.json().catch(() => ({}));

    if (!tenorRes.ok) {
      const message =
        (tenorJson as { error?: { message?: string } })?.error?.message ||
        `Tenor API error (${tenorRes.status})`;
      return new Response(JSON.stringify({ error: message, results: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ results: mapTenorResults(tenorJson as Record<string, unknown>) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message, results: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
