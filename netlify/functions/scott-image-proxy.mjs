// Proxies Scott product images so they can be served over HTTPS.
//
// WHY THIS EXISTS: Scott's staging host is plain http://, and the production Scott host's
// images are referenced by http:// URLs in some payloads. A browser on an https:// page
// blocks those as mixed content, so the image silently fails to render. The client rewriter
// in `src/scott/scottImage.js` turns such URLs into `/api/scott-image-proxy?url=<encoded>`;
// this function is what answers that path. Without it every Scott image 404s in production.
//
// Ported from the original ScottOne Vercel function (api/scott-image-proxy.ts). The host
// allowlist is the security boundary — it stops this becoming an open proxy — and must stay
// in sync with SCOTT_IMAGE_ALLOWED_HOSTS in src/scott/scottImage.js.

const ALLOWED = new Set(["64.227.186.227", "leaderboard.sagarfab.com"]);

export default async function handler(request) {
  const raw = new URL(request.url).searchParams.get("url");

  if (!raw) return new Response("Missing url", { status: 400 });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (!ALLOWED.has(target.hostname)) return new Response("Host not allowed", { status: 403 });
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new Response("Invalid protocol", { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: { Accept: "image/*,*/*;q=0.8" },
      redirect: "follow"
    });
  } catch {
    return new Response("Upstream unreachable", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800"
    }
  });
}

// Serve at the same path the original used, so the client constant needs no change.
export const config = { path: "/api/scott-image-proxy" };
