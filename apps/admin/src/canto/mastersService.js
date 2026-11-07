import { urlToScottFile } from "../scott/scottClient";
import { cantoRpc, getCantoClient, getCantoTarget } from "./target";

const writeQueues = new Map();
const relationName = (resource, action) => action === "update_categories" ? (resource === "rmp_brands" ? "rmp_categories" : "categories") : action.replace(/^update_/, "");
export function createSupabaseMastersService(config) {
  const environment = getCantoTarget().environment;
  const resource = config.resource;
  const cfg = { ...config, labelSingular: config.labelSingular || config.label.replace(/s$/, "") };
  function normalize(row) {
    if (!row) return null;
    // Resolve legacy upload paths against the dashboard's selected environment.
    const sourceHost = environment === "production" ? "https://leaderboard.sagarfab.com" : "http://64.227.186.227";
    const resolved = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && value.startsWith("/uploads/") ? sourceHost + value : value]));
    return { ...config.normalize(resolved), updated_at: row.updated_at, _source: row };
  }
  function request(action, payload = {}) {
    const execute = () => cantoRpc("masters", { resource, action, payload }, environment);
    if (["list", "get"].includes(action)) return execute();
    // Existing CSV/grid callers use parallel batches. Serialize this browser's writes
    // so they do not contend with each other for the database's publication lock.
    const pending = (writeQueues.get(environment) || Promise.resolve()).then(execute);
    writeQueues.set(environment, pending.then(() => undefined, () => undefined));
    return pending;
  }
  async function listPage({ page = 1, items, pageSize = 100, search = "", includeInactive = false, ...rest } = {}) {
    const filters = Object.fromEntries((config.serverFilters || []).filter(k => rest[k] != null && rest[k] !== "").map(k => [k, rest[k]]));
    const result = await request("list", { page, items: items || pageSize, search, includeInactive, filters });
    return { ...result, data: result.data.map(normalize) };
  }
  async function listAll(filters = {}) {
    const rows = [];
    for (let page = 1; ; page++) {
      const result = await listPage({ ...filters, page, items: 1000 });
      rows.push(...result.data);
      if (page >= result.totalPages) return rows;
      if (page >= 1000) throw new Error("This export is too large. Narrow the filters.");
    }
  }
  async function uploadFiles(payload) {
    const values = {};
    const uploaded = [];
    try {
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) continue;
        if (value?.__base64File) {
          const raw = atob(value.data);
          if (raw.length > 8 * 1024 * 1024) throw new Error("Images must be smaller than 8 MB.");
          const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
          const extension = String(value.filename || "").split(".").pop().toLowerCase();
          const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[extension];
          if (!mime) throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
          const client = getCantoClient(environment);
          const { data: { session } } = await client.auth.getSession();
          if (!session) throw new Error("Sign in before uploading.");
          const path = `${session.user.id}/${resource}/${crypto.randomUUID()}.${extension}`;
          const { error } = await client.storage.from("canto-masters").upload(path, bytes, { contentType: mime, upsert: false });
          if (error) throw error;
          uploaded.push(path);
          values[key] = client.storage.from("canto-masters").getPublicUrl(path).data.publicUrl;
        } else values[key] = value;
      }
      return { values, uploaded };
    } catch (error) {
      if (uploaded.length) await getCantoClient(environment).storage.from("canto-masters").remove(uploaded);
      throw error;
    }
  }
  async function getById(id) { return normalize(await request("get", { id: String(id) })); }
  async function save(action, id, form, previous, relationPlan = []) {
    const current = previous || (id ? await getById(id) : undefined);
    const payload = await (action === "create" ? config.toCreatePayload(form) : config.toUpdatePayload(form, current));
    // Rails ignores these presentation aliases; Supabase deliberately rejects unknown fields.
    delete payload.status; delete payload.logo_url; delete payload.image_url;
    if (resource === "asset_infos") {
      for (const [ui, column] of Object.entries({ dx: "dX", dy: "dY", mirror_dx: "mirrorDX", asset_height_resp_to_box: "assetHeightRespToBox" })) {
        if (ui in payload) { payload[column] = payload[ui]; delete payload[ui]; }
      }
    }
    const relations = Object.fromEntries(relationPlan.map(r => [relationName(resource, r.action), r.ids]));
    if (resource === "fabrics") {
      if (payload.fabric_type != null) payload.fabric_type = String(payload.fabric_type).toLowerCase().replace(/ /g, "_");
      for (const key of Object.keys(payload)) if (/^color_ids\[/.test(key)) delete payload[key];
      if (form.color_ids !== undefined) relations.colors = form.color_ids.map(String);
    }
    async function imageValue(value, previous, wire) {
      if (payload[wire]?.__base64File) return;
      if ((value === "" || value === null) && previous) { payload[wire] = null; return; }
      if (typeof value !== "string" || !value || value === previous) return;
      const imageUrl = new URL(value);
      if (!["https:", "http:"].includes(imageUrl.protocol)) throw new Error("Choose an image file or a readable image URL.");
      const project = environment === "production" ? "levwrmvqdntngeasrtnb" : "scvojtvgnkmbupvyslmb";
      if (imageUrl.origin === `https://${project}.supabase.co` && imageUrl.pathname.startsWith("/storage/v1/object/public/canto-masters/")) payload[wire] = value;
      else {
        try { payload[wire] = await urlToScottFile(value, `${wire}.png`); }
        catch { throw new Error("This image URL cannot be read. Download the image and choose it as a file."); }
      }
    }
    for (const field of config.fields || []) {
      if (field.type === "image" && Object.hasOwn(form, field.key)) await imageValue(form[field.key], current?.[field.key], field.wire || field.key);
      if (field.type === "image-slots" && form[field.key]) for (const [slot, value] of Object.entries(form[field.key])) if (value === null) payload[slot] = null;
    }
    for (const slot of config.imageSlots || []) if (Object.hasOwn(form, slot)) await imageValue(form[slot], current?.[slot], slot);
    const { values, uploaded } = await uploadFiles(payload);
    try {
      return normalize(await request(action, { id: id == null ? undefined : String(id), values, relations, expectedUpdatedAt: current?.updated_at }));
    } catch (error) {
      if (uploaded.length) await getCantoClient(environment).storage.from("canto-masters").remove(uploaded);
      throw error;
    }
  }
  return {
    config: cfg, key: config.key, resource, source: "supabase", supportsAtomicRelations: true,
    listPage, listAll, listAllForImport: () => listAll({ includeInactive: true }),
    listAllIds: async filters => (await listAll(filters)).map(r => r.id), getById,
    create: (form, relations) => save("create", undefined, form, undefined, relations),
    update: (id, form, previous, relations) => save("update", id, form, previous, relations),
    remove: id => request("delete", { id: String(id) }),
    bulkDelete: ids => request("bulk_delete", { ids: ids.map(String) }),
    updateRelation: (action, id, ids) => request("relations", { id: String(id), relations: { [relationName(resource, action)]: ids.map(String) } })
  };
}
