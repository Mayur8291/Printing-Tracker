const GIPHY_KEY = (import.meta.env.VITE_GIPHY_API_KEY ?? "").trim();
const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

function mapGiphyItem(item) {
  const images = item?.images ?? {};
  const url =
    images.downsized_medium?.url ||
    images.fixed_height?.url ||
    images.original?.url ||
    "";
  const preview =
    images.fixed_height_small?.url ||
    images.preview_gif?.url ||
    images.downsized_small?.url ||
    url;

  return {
    id: String(item?.id ?? ""),
    url,
    preview
  };
}

async function giphyRequest(path, params) {
  if (!GIPHY_KEY) {
    throw new Error("VITE_GIPHY_API_KEY missing in .env");
  }

  const search = new URLSearchParams({
    api_key: GIPHY_KEY,
    limit: String(params.limit ?? 20),
    rating: "pg",
    ...params.extra
  });

  const res = await fetch(`${GIPHY_BASE}/${path}?${search.toString()}`);
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = json?.message || `Giphy request failed (${res.status})`;
    throw new Error(message);
  }

  return (json.data ?? []).map(mapGiphyItem).filter((g) => g.url);
}

/** Search Giphy by keyword — https://developers.giphy.com/docs/api/endpoint/#search */
export async function searchGiphyGifs(query, { limit = 20 } = {}) {
  const q = String(query ?? "").trim();
  if (!q) {
    return fetchGiphyTrending({ limit });
  }

  return giphyRequest("search", {
    limit,
    extra: { q }
  });
}

/** Trending GIFs when search box empty — https://developers.giphy.com/docs/api/endpoint/#trending */
export async function fetchGiphyTrending({ limit = 20 } = {}) {
  return giphyRequest("trending", { limit });
}
