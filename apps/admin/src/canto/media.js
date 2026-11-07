// Signed links are generated only for the current dashboard administrator.
// Keep permanent object references in the database; never persist signed URLs.
export async function resolveMedia(value, client) {
  const paths = new Set();
  function walk(node, transform) {
    if (Array.isArray(node)) return node.map(v => walk(v, transform));
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, transform)]));
    return transform(node);
  }
  const prefix = "canto-media://canto-media/";
  walk(value, node => {
    if (typeof node === "string" && node.startsWith(prefix)) paths.add(node.slice(prefix.length));
    return node;
  });
  if (!paths.size) return value;
  const urls = new Map();
  const all = [...paths];
  for (let offset = 0; offset < all.length; offset += 100) {
    const { data, error } = await client.storage.from("canto-media").createSignedUrls(all.slice(offset, offset + 100), 3600);
    if (error) throw new Error("Unable to load migrated media. Please retry.");
    for (const result of data) {
      if (result.error || !result.signedUrl) throw new Error("A migrated file is unavailable. Check Data Refresh for details.");
      urls.set(result.path, result.signedUrl);
    }
  }
  return walk(value, node => typeof node === "string" && node.startsWith(prefix) ? urls.get(node.slice(prefix.length)) : node);
}
