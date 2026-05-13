import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

function appBasePath() {
  const raw = import.meta.env.BASE ?? "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** SVG path — front view, viewBox 0 0 200 260 */
const TSHIRT_PATH =
  "M100 28c-8 0-15 2-20 6l-8 6H55c-6 0-11 4-13 10l-6 22-18 6 4 28 20-2 6 4v128h104V102l6-4 20 2 4-28-18-6-6-22c-2-6-7-10-13-10H128l-8-6c-5-4-12-6-20-6z";

/** Left profile (sleeve / body silhouette), viewBox 0 0 200 260 — “Right” mirrors this. */
const SIDE_SHIRT_LEFT_PATH =
  "M122 40 L96 48 L86 64 L80 128 L82 208 L88 226 L108 234 L138 228 L152 210 L158 128 L152 64 L142 48 Z";

const VIEW_LABEL = { front: "Front", back: "Back", left: "Left", right: "Right" };

/** Base names in `public/mockups/` — tries `.svg` first, then `.png`. */
const REFERENCE_BASE = {
  front: "Front-reference",
  back: "Back-reference",
  left: "Left-reference",
  right: "Right-reference"
};

function referenceAssetUrl(view, ext) {
  const slug = REFERENCE_BASE[view] ?? REFERENCE_BASE.front;
  return `${appBasePath()}mockups/${slug}.${ext}`;
}

/** Canvas export: png before svg to reduce tainted-canvas risk. */
async function loadReferenceImageForCanvas(view) {
  for (const ext of ["png", "svg"]) {
    try {
      return await loadImage(referenceAssetUrl(view, ext));
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Image failed"));
    im.src = src;
  });
}

/** SVG from blob often has naturalWidth/naturalHeight 0 until laid out; <img> still paints. Parse viewBox for export. */
async function parseSvgViewBoxFromBlob(blob) {
  if (!blob?.slice) return null;
  try {
    const head = await blob.slice(0, 98304).text();
    const t = head.trimStart();
    if (!t.startsWith("<")) return null;
    const m =
      t.match(/\bviewBox\s*=\s*["']([^"']+)["']/i) || t.match(/\bviewBox\s*=\s*([^\s>]+)/i);
    if (!m) return null;
    const parts = m[1]
      .trim()
      .replace(/,/g, " ")
      .split(/\s+/)
      .map(parseFloat)
      .filter((n) => !Number.isNaN(n));
    if (parts.length >= 4) {
      const vw = parts[2];
      const vh = parts[3];
      if (vw > 0 && vh > 0) return { w: vw, h: vh };
    }
    const wm = t.match(/\bwidth\s*=\s*["']([\d.]+)\s*(?:px)?["']/i);
    const hm = t.match(/\bheight\s*=\s*["']([\d.]+)\s*(?:px)?["']/i);
    if (wm && hm) {
      const w = parseFloat(wm[1]);
      const h = parseFloat(hm[1]);
      if (w > 0 && h > 0) return { w, h };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * drawable + aspect for “contain” in placement box.
 * drawMode "full" = use drawImage(el, dx,dy,dw,dh) (needed when natural size is 0, e.g. SVG blob).
 */
async function loadDesignForCanvas(fileUrl) {
  let blob = null;
  try {
    const res = await fetch(fileUrl);
    if (res.ok) blob = await res.blob();
  } catch {
    /* ignore */
  }

  if (blob && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp.width > 0 && bmp.height > 0) {
        return { drawable: bmp, fitW: bmp.width, fitH: bmp.height, drawMode: "intrinsic" };
      }
      bmp.close?.();
    } catch {
      /* e.g. SVG or odd type — fall through to <img> */
    }
  }

  const fromImageElement = async (img) => {
    if (img.decode) await img.decode().catch(() => {});
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw > 0 && nh > 0) {
      return { drawable: img, fitW: nw, fitH: nh, drawMode: "intrinsic" };
    }
    const parsed = blob ? await parseSvgViewBoxFromBlob(blob) : null;
    if (parsed) {
      return { drawable: img, fitW: parsed.w, fitH: parsed.h, drawMode: "full" };
    }
    return { drawable: img, fitW: 300, fitH: 150, drawMode: "full" };
  };

  try {
    const img = await loadImage(fileUrl);
    return await fromImageElement(img);
  } catch {
    /* try data URL path */
  }

  if (!blob) throw new Error("Design load failed");

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(blob);
  });
  const img = await loadImage(dataUrl);
  return await fromImageElement(img);
}

function drawableIntrinsicSize(d) {
  if (d instanceof ImageBitmap) return { w: d.width, h: d.height };
  return { w: d.naturalWidth, h: d.naturalHeight };
}

function dataUrlToPngBlob(dataUrl) {
  try {
    const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) return null;
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: "image/png" });
  } catch {
    return null;
  }
}

function blobFromCanvas(canvas) {
  return new Promise((resolve) => {
    const fallback = () => {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        resolve(dataUrlToPngBlob(dataUrl));
      } catch {
        resolve(null);
      }
    };
    try {
      canvas.toBlob((b) => {
        if (b && b.size > 0) resolve(b);
        else {
          try {
            canvas.toBlob((b2) => {
              if (b2 && b2.size > 0) resolve(b2);
              else fallback();
            }, "image/png");
          } catch {
            fallback();
          }
        }
      }, "image/png", 0.92);
    } catch {
      fallback();
    }
  });
}

/** 2×2 sheet: top Front | Back, bottom Left | Right */
const GRID_VIEWS = [
  ["front", "back"],
  ["left", "right"]
];

/** Match preview CSS: 200×260 frame + object-fit contain (no non-uniform stretch). */
function paintReferenceContained(ctx, refImg, rw, rh) {
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, 200, 260);
  if (rw <= 0 || rh <= 0) {
    ctx.drawImage(refImg, 0, 0, 200, 260);
    return;
  }
  const s = Math.min(200 / rw, 260 / rh);
  const dw = rw * s;
  const dh = rh * s;
  const ox = (200 - dw) / 2;
  const oy = (260 - dh) / 2;
  ctx.drawImage(refImg, 0, 0, rw, rh, ox, oy, dw, dh);
}

function paintGarmentInMockCoords(ctx, view, garmentHex, refImg, scaleToCanvas) {
  if (refImg) {
    const { w: rw, h: rh } = drawableIntrinsicSize(refImg);
    paintReferenceContained(ctx, refImg, rw, rh);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = garmentHex;
    ctx.fillRect(0, 0, 200, 260);
    ctx.globalAlpha = 1;
  } else {
    ctx.save();
    if (view === "right") {
      ctx.translate(200, 0);
      ctx.scale(-1, 1);
    }
    const pathD = garmentPathForView(view);
    const path = new Path2D(pathD);
    ctx.fillStyle = garmentHex;
    ctx.fill(path);
    ctx.strokeStyle = "rgba(15,23,42,0.14)";
    ctx.lineWidth = 1.2 / scaleToCanvas;
    ctx.stroke(path);
    ctx.restore();
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** cx,cy,w,h in 0–1 garment fractions (same basis as PLACEMENT_LAYOUT); rot in degrees */
function paintOneDesignLayerInMockCoords(ctx, design, cx, cy, w, h, rotDeg) {
  const pw = w * 200;
  const ph = h * 260;
  const cjx = cx * 200;
  const cjy = cy * 260;
  ctx.save();
  ctx.translate(cjx, cjy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  try {
    const d = design.drawable;
    const { fitW, fitH, drawMode } = design;
    const scaleFit = Math.min(pw / fitW, ph / fitH);
    const dw = fitW * scaleFit;
    const dh = fitH * scaleFit;
    if (drawMode === "full") {
      ctx.drawImage(d, -dw / 2, -dh / 2, dw, dh);
    } else {
      const sw = d instanceof ImageBitmap ? d.width : d.naturalWidth;
      const sh = d instanceof ImageBitmap ? d.height : d.naturalHeight;
      if (sw > 0 && sh > 0) {
        ctx.drawImage(d, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
      } else {
        ctx.drawImage(d, -dw / 2, -dh / 2, dw, dh);
      }
    }
  } catch {
    /* ignore */
  }
  ctx.restore();
}

function paintAllDesignLayersInMockCoords(ctx, loadedSorted) {
  for (const L of loadedSorted) {
    paintOneDesignLayerInMockCoords(ctx, L.design, L.cx, L.cy, L.w, L.h, L.rot);
  }
}

function renderGridMockupCanvas({ garmentHex, loadedByView, refByView }) {
  const OUT_W = 1280;
  const OUT_H = 960;
  const pad = 20;
  const labelH = 22;
  const cols = 2;
  const rows = 2;
  const cellW = (OUT_W - pad * (cols + 1)) / cols;
  const cellH = (OUT_H - pad * (rows + 1) - labelH * rows) / rows;

  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  ctx.fillStyle = "#e8eef5";
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const view = GRID_VIEWS[r][c];
      const x = pad + c * (cellW + pad);
      const yTop = pad + r * (cellH + pad + labelH);
      const y = yTop + labelH;
      const refImg = refByView[view] ?? null;
      const cellDesigns = loadedByView[view] ?? [];

      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x, y, cellW, cellH, 10);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeRect(x, y, cellW, cellH);
      }

      ctx.fillStyle = "#475569";
      ctx.font = "600 13px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(VIEW_LABEL[view], x + 10, yTop + 16);

      const innerPad = 10;
      const innerW = cellW - innerPad * 2;
      const innerH = cellH - innerPad * 2;
      const scale = Math.min(innerW / 200, innerH / 260) * 0.9;
      const ox = x + innerPad + (innerW - 200 * scale) / 2;
      const oy = y + innerPad + (innerH - 260 * scale) / 2;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      paintGarmentInMockCoords(ctx, view, garmentHex, refImg, scale);
      if (cellDesigns.length) {
        paintAllDesignLayersInMockCoords(ctx, cellDesigns);
      }
      ctx.restore();
    }
  }

  return canvas;
}

function garmentPathForView(view) {
  if (view === "left" || view === "right") return SIDE_SHIRT_LEFT_PATH;
  /* Front + back use same flat outline until placement-reference.png supplies a true back panel. */
  return TSHIRT_PATH;
}

/** Fixed tint for reference + vector fallback (was garment color picker). */
const DEFAULT_GARMENT_HEX = "#f8fafc";

/** Normalized positions inside shirt viewBox 0–200 (w) × 0–260 (h), design center + size */
const PLACEMENT_LAYOUT = {
  front_left_chest: { cx: 0.65, cy: 0.34, w: 0.08, h: 0.2, rot: 0 },
  front_center: { cx: 0.51, cy: 0.48, w: 0.3, h: 0.34, rot: 0 },
  left_sleeve: { cx: 0.50, cy: 0.39, w: 0.06, h: 0.16, rot: -28 },
  right_sleeve: { cx: 0.49, cy: 0.38, w: 0.06, h: 0.16, rot: 28 },
  back_center: { cx: 0.496, cy: 0.39, w: 0.44, h: 0.30, rot: 0 },
  neck_label: { cx: 0.5, cy: 0.2, w: 0.04, h: 0.1, rot: 0 }
};

async function loadDesignsForLayerList(layers) {
  const sorted = [...layers].filter((l) => l.visible !== false).sort((a, b) => a.z - b.z);
  const out = [];
  for (const layer of sorted) {
    const design = await loadDesignForCanvas(layer.url);
    out.push({
      design,
      cx: layer.cx,
      cy: layer.cy,
      w: layer.w,
      h: layer.h,
      rot: layer.rot
    });
  }
  return out;
}

async function buildGridMockupBlob({ layersBySide, garmentHex }) {
  const frontLayers = [...(layersBySide.front ?? [])].filter((l) => l.visible !== false).sort((a, b) => a.z - b.z);
  const neckLayers = [...(layersBySide.neck ?? [])].filter((l) => l.visible !== false).sort((a, b) => a.z - b.z);
  const mergedFrontCell = [...frontLayers, ...neckLayers];

  const loadedByView = {
    front: await loadDesignsForLayerList(mergedFrontCell),
    back: await loadDesignsForLayerList(layersBySide.back ?? []),
    left: await loadDesignsForLayerList(layersBySide.left ?? []),
    right: await loadDesignsForLayerList(layersBySide.right ?? [])
  };

  async function loadRefMap(useRaster) {
    const refByView = {};
    for (const row of GRID_VIEWS) {
      for (const view of row) {
        if (useRaster) {
          refByView[view] = await loadReferenceImageForCanvas(view);
        } else {
          refByView[view] = null;
        }
      }
    }
    return refByView;
  }

  let refByView = await loadRefMap(true);
  for (let pass = 0; pass < 2; pass++) {
    const canvas = renderGridMockupCanvas({ garmentHex, loadedByView, refByView });
    const blob = await blobFromCanvas(canvas);
    if (blob) return blob;
    refByView = await loadRefMap(false);
  }

  throw new Error("Export failed");
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ly-${Date.now()}-${Math.random()}`;
}

function makeLayerFromPlacement(url, placementId, z) {
  const L = PLACEMENT_LAYOUT[placementId] ?? PLACEMENT_LAYOUT.front_center;
  const n = z * 0.014;
  return {
    id: newId(),
    url,
    cx: clamp(L.cx + n, 0.06, 0.94),
    cy: clamp(L.cy + n * 0.55, 0.06, 0.94),
    w: Math.max(0.04, L.w),
    h: Math.max(0.04, L.h),
    rot: L.rot,
    z,
    visible: true
  };
}

/** Garment side tabs (UI) → default print slot on that side */
const SIDE_TABS = [
  { id: "front", label: "Fr", title: "Front" },
  { id: "back", label: "B", title: "Back" },
  { id: "left", label: "LS", title: "Left sleeve" },
  { id: "right", label: "RS", title: "Right sleeve" },
  { id: "neck", label: "NL", title: "Neck label" }
];

const SIDE_DEFAULT_PLACEMENT = {
  front: "front_center",
  back: "back_center",
  left: "left_sleeve",
  right: "right_sleeve",
  neck: "neck_label"
};

function garmentRefViewForSide(sideId) {
  return sideId === "neck" ? "front" : sideId;
}

function emptyLayersBySide() {
  return { front: [], back: [], left: [], right: [], neck: [] };
}

function makeLayerForSide(url, sideKey, zIndex) {
  const pid = SIDE_DEFAULT_PLACEMENT[sideKey] ?? "front_center";
  return makeLayerFromPlacement(url, pid, zIndex);
}

function GarmentOutlineSvg({ view, garmentHex, className }) {
  const stroke = "#0f172a";
  if (view === "right") {
    return (
      <svg viewBox="0 0 200 260" className={className} aria-hidden>
        <g transform="translate(200,0) scale(-1,1)">
          <path
            d={SIDE_SHIRT_LEFT_PATH}
            fill={garmentHex}
            fillOpacity={0.9}
            stroke={stroke}
            strokeWidth="1.15"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    );
  }
  const d = garmentPathForView(view);
  return (
    <svg viewBox="0 0 200 260" className={className} aria-hidden>
      <path
        d={d}
        fill={garmentHex}
        fillOpacity={0.9}
        stroke={stroke}
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlacementReferenceGraphic({ view, garmentHex, className, overrideSrc }) {
  const [src, setSrc] = useState(() => overrideSrc || referenceAssetUrl(view, "svg"));
  const [useVectorFallback, setUseVectorFallback] = useState(false);
  const loadPhaseRef = useRef(0);

  useEffect(() => {
    loadPhaseRef.current = 0;
    if (overrideSrc) {
      setSrc(overrideSrc);
      setUseVectorFallback(false);
      return;
    }
    setSrc(referenceAssetUrl(view, "svg"));
    setUseVectorFallback(false);
  }, [view, overrideSrc]);

  if (useVectorFallback) {
    return <GarmentOutlineSvg view={view} garmentHex={garmentHex} className={className} />;
  }

  return (
    <div className={`mockup-ref-raster-wrap ${className ?? ""}`}>
      <div className="mockup-ref-raster-tint" style={{ backgroundColor: garmentHex }} aria-hidden />
      <img
        src={src}
        alt=""
        className="mockup-ref-raster-img"
        onError={() => {
          if (overrideSrc) {
            setUseVectorFallback(true);
            return;
          }
          const phase = loadPhaseRef.current;
          if (phase === 0) {
            loadPhaseRef.current = 1;
            setSrc(referenceAssetUrl(view, "png"));
          } else {
            setUseVectorFallback(true);
          }
        }}
      />
    </div>
  );
}

async function duplicateObjectUrl(srcUrl) {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error("Library copy failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function MockupLayerStack({ containerRef, layers, setLayers, selectedLayerId, setSelectedLayerId }) {
  const updateLayer = useCallback((id, patch) => {
    setLayers((prev) => prev.map((L) => (L.id === id ? { ...L, ...patch } : L)));
  }, [setLayers]);

  const sortedBottomFirst = useMemo(
    () => [...layers].filter((L) => L.visible !== false).sort((a, b) => a.z - b.z),
    [layers]
  );

  const attachDrag = useCallback(
    (e, layer, mode) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedLayerId(layer.id);
      const el = containerRef?.current;
      if (!el) return;
      const sx = e.clientX;
      const sy = e.clientY;
      const scx = layer.cx;
      const scy = layer.cy;
      const sw = layer.w;
      const sh = layer.h;
      const id = layer.id;
      const onMove = (ev) => {
        const rect = el.getBoundingClientRect();
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (mode === "move") {
          updateLayer(id, {
            cx: clamp(scx + dx / rect.width, 0.02, 0.98),
            cy: clamp(scy + dy / rect.height, 0.02, 0.98)
          });
        } else {
          const scale = clamp(1 + (dx + dy) / (rect.width * 0.55), 0.2, 6);
          updateLayer(id, {
            w: clamp(sw * scale, 0.02, 1.35),
            h: clamp(sh * scale, 0.02, 1.35)
          });
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [containerRef, setSelectedLayerId, updateLayer]
  );

  return (
    <div className="mockup-layers-root">
      <div
        className="mockup-layers-deselect"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setSelectedLayerId(null);
        }}
        aria-hidden
      />
      {sortedBottomFirst.map((layer) => {
        const selected = selectedLayerId === layer.id;
        return (
          <div
            key={layer.id}
            className={`mockup-layer ${selected ? "is-selected" : ""}`}
            style={{
              left: `${layer.cx * 100}%`,
              top: `${layer.cy * 100}%`,
              width: `${layer.w * 100}%`,
              height: `${layer.h * 100}%`,
              transform: `translate(-50%, -50%) rotate(${layer.rot}deg)`,
              zIndex: 10 + layer.z
            }}
            onPointerDown={(e) => {
              if (e.target.closest(".mockup-layer-handle")) return;
              attachDrag(e, layer, "move");
            }}
            onWheel={(e) => {
              if (!selected) return;
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06;
              updateLayer(layer.id, {
                w: clamp(layer.w * factor, 0.02, 1.35),
                h: clamp(layer.h * factor, 0.02, 1.35)
              });
            }}
          >
            <img src={layer.url} alt="" className="mockup-layer-img" draggable={false} />
            {selected ? (
              <button
                type="button"
                className="mockup-layer-handle mockup-layer-handle--se"
                title="Drag to scale"
                aria-label="Scale layer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  attachDrag(e, layer, "resize");
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function MockupStudio({ open, onClose }) {
  const inputId = useId();
  const tiltInputId = useId();
  const sideSelectId = useId();
  const fileRef = useRef(null);
  const previewInnerRef = useRef(null);
  const zoomScrollRef = useRef(null);
  const [layersBySide, setLayersBySide] = useState(emptyLayersBySide);
  const [activeSide, setActiveSide] = useState("front");
  const [library, setLibrary] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [dragOverUpload, setDragOverUpload] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 0.5–2.5 — scales mockup preview width (no stretch, same coords as export). */
  const [placementZoom, setPlacementZoom] = useState(1);

  const garmentHex = DEFAULT_GARMENT_HEX;
  const refView = garmentRefViewForSide(activeSide);
  const sideLayers = layersBySide[activeSide] ?? [];

  const setActiveSideLayers = useCallback(
    (updater) => {
      setLayersBySide((prev) => {
        const cur = prev[activeSide] ?? [];
        const nextArr = typeof updater === "function" ? updater(cur) : updater;
        return { ...prev, [activeSide]: nextArr };
      });
    },
    [activeSide]
  );

  const selectedLayer = useMemo(
    () => sideLayers.find((L) => L.id === selectedLayerId) ?? null,
    [sideLayers, selectedLayerId]
  );

  const setSelectedLayerRot = useCallback(
    (rotDeg) => {
      if (!selectedLayerId) return;
      const r = clamp(Number(rotDeg) || 0, -180, 180);
      setActiveSideLayers((prev) =>
        prev.map((L) => (L.id === selectedLayerId ? { ...L, rot: r } : L))
      );
    },
    [selectedLayerId, setActiveSideLayers]
  );

  useEffect(() => {
    if (!open) {
      setLayersBySide((prev) => {
        for (const k of Object.keys(prev)) {
          (prev[k] ?? []).forEach((L) => URL.revokeObjectURL(L.url));
        }
        return emptyLayersBySide();
      });
      setLibrary((prev) => {
        prev.forEach((e) => URL.revokeObjectURL(e.url));
        return [];
      });
      setSelectedLayerId(null);
      setActiveSide("front");
      setPlacementZoom(1);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = zoomScrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.target.closest?.(".mockup-layer")) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setPlacementZoom((z) => clamp(Number((z + delta).toFixed(2)), 0.5, 2.5));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  const addFilesToLibrary = useCallback((fileList) => {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setLibrary((prev) => {
      const next = [...prev];
      for (const f of files) {
        next.push({ id: newId(), url: URL.createObjectURL(f) });
      }
      return next;
    });
  }, []);

  const addLayerFromLibraryUrl = useCallback(
    async (libUrl) => {
      const side = activeSide;
      let newLayerId = null;
      try {
        const layerUrl = await duplicateObjectUrl(libUrl);
        setLayersBySide((prev) => {
          const arr = prev[side] ?? [];
          const z = arr.length ? Math.max(...arr.map((p) => p.z)) + 1 : 0;
          const layer = makeLayerForSide(layerUrl, side, z);
          newLayerId = layer.id;
          return { ...prev, [side]: [...arr, layer] };
        });
      } catch (e) {
        console.error(e);
        alert("Could not add image from library.");
        return;
      }
      if (newLayerId) setSelectedLayerId(newLayerId);
    },
    [activeSide]
  );

  const onDropUpload = (e) => {
    e.preventDefault();
    setDragOverUpload(false);
    addFilesToLibrary(e.dataTransfer.files);
  };

  const removeLayer = (id) => {
    setActiveSideLayers((prev) => {
      const L = prev.find((x) => x.id === id);
      if (L) URL.revokeObjectURL(L.url);
      return prev.filter((x) => x.id !== id);
    });
    setSelectedLayerId((sid) => (sid === id ? null : sid));
  };

  const bumpLayerZ = (id, dir) => {
    setActiveSideLayers((prev) => {
      const sorted = [...prev].sort((a, b) => a.z - b.z);
      const i = sorted.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= sorted.length) return prev;
      const za = sorted[i].z;
      const zb = sorted[j].z;
      return prev.map((x) => {
        if (x.id === sorted[i].id) return { ...x, z: zb };
        if (x.id === sorted[j].id) return { ...x, z: za };
        return x;
      });
    });
  };

  const toggleLayerVisible = (id) => {
    setActiveSideLayers((prev) =>
      prev.map((L) => (L.id === id ? { ...L, visible: L.visible === false } : L))
    );
  };

  const layersTopFirst = useMemo(() => [...sideLayers].sort((a, b) => b.z - a.z), [sideLayers]);

  const hasExportableLayer = useMemo(
    () =>
      Object.values(layersBySide).some((arr) =>
        (arr ?? []).some((L) => L.visible !== false)
      ),
    [layersBySide]
  );

  const handleExport = async () => {
    if (!hasExportableLayer) return;
    setExporting(true);
    try {
      const blob = await buildGridMockupBlob({
        layersBySide,
        garmentHex
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "mockup-grid.png";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("Mockup export", err);
      const m = err?.message ?? "";
      if (/Design (load|decode)/i.test(m)) {
        alert("Could not read your design file. Try PNG or JPEG, or a smaller image.");
      } else if (/Export failed/i.test(m)) {
        alert(
          "Could not save the mockup image (browser blocked it). Try a PNG design, or add PNG reference files in public/mockups/."
        );
      } else {
        alert("Could not create mockup. Try another image format.");
      }
    } finally {
      setExporting(false);
    }
  };

  const selectSide = (sideId) => {
    setActiveSide(sideId);
    setSelectedLayerId(null);
  };

  if (!open) return null;

  return (
    <div className="image-modal-backdrop mockup-studio-backdrop" onClick={onClose}>
      <div className="mockup-studio-modal mockup-studio-modal--wire panel" onClick={(e) => e.stopPropagation()}>
        <div className="mockup-studio-head">
          <h2 className="mockup-studio-title">Mockup studio</h2>
          <button type="button" className="image-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="mockup-studio-grid mockup-studio-grid--wire">
          <div className="mockup-wire-row mockup-wire-row--top">
            <section className="mockup-studio-card mockup-upload-card">
              <h3 className="mockup-studio-card-title">Upload design</h3>
              <div
                className={`mockup-dropzone ${dragOverUpload ? "is-dragover" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverUpload(true);
                }}
                onDragLeave={() => setDragOverUpload(false)}
                onDrop={onDropUpload}
              >
                <span className="mockup-dropzone-icon" aria-hidden>
                  ☁
                </span>
                <p className="mockup-dropzone-text">Drop images here or browse</p>
                <button type="button" className="mockup-browse-btn" onClick={() => fileRef.current?.click()}>
                  Browse file
                </button>
                <input
                  ref={fileRef}
                  id={inputId}
                  type="file"
                  accept="image/*"
                  multiple
                  className="mockup-file-input"
                  onChange={(e) => {
                    addFilesToLibrary(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </section>

            <section className="mockup-studio-card mockup-library-card">
              <h3 className="mockup-studio-card-title">Uploaded images</h3>
              <div className="mockup-library-strip">
                {library.length === 0 ? (
                  <div className="mockup-library-empty">No files yet — upload above.</div>
                ) : (
                  library.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="mockup-library-thumb"
                      title="Add to current mockup side"
                      onClick={() => addLayerFromLibraryUrl(item.url)}
                    >
                      <img src={item.url} alt="" draggable={false} />
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="mockup-wire-row mockup-wire-row--bottom">
            <section className="mockup-studio-card mockup-mockup-card">
              <h3 className="mockup-studio-card-title">Mockup placement</h3>
              <div className="mockup-placement-toolbar">
                <div className="mockup-placement-toolbar-group">
                  <label className="mockup-side-select-label" htmlFor={sideSelectId}>
                    Garment side
                  </label>
                  <select
                    id={sideSelectId}
                    className="mockup-side-select"
                    value={activeSide}
                    onChange={(e) => selectSide(e.target.value)}
                  >
                    {SIDE_TABS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mockup-zoom-toolbar" title="Scroll wheel here zooms (not Ctrl)">
                  <span className="mockup-zoom-toolbar-label">Zoom</span>
                  <button
                    type="button"
                    className="mockup-zoom-btn"
                    aria-label="Zoom out"
                    onClick={() => setPlacementZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.5, 2.5))}
                  >
                    −
                  </button>
                  <input
                    className="mockup-zoom-range"
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={placementZoom}
                    onChange={(e) => setPlacementZoom(clamp(Number(e.target.value), 0.5, 2.5))}
                    aria-valuetext={`${Math.round(placementZoom * 100)} percent`}
                  />
                  <button
                    type="button"
                    className="mockup-zoom-btn"
                    aria-label="Zoom in"
                    onClick={() => setPlacementZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.5, 2.5))}
                  >
                    +
                  </button>
                  <span className="mockup-zoom-pct">{Math.round(placementZoom * 100)}%</span>
                  <button type="button" className="mockup-zoom-reset" onClick={() => setPlacementZoom(1)}>
                    Reset
                  </button>
                </div>
              </div>
              <div className="mockup-preview-stage mockup-preview-stage--wire" ref={zoomScrollRef}>
                <div
                  className="mockup-preview-inner mockup-preview-inner--wire"
                  ref={previewInnerRef}
                  style={{ maxWidth: `min(${Math.round(320 * placementZoom)}px, 100%)` }}
                >
                  <PlacementReferenceGraphic view={refView} garmentHex={garmentHex} className="mockup-shirt-svg" />
                  {sideLayers.length > 0 ? (
                    <MockupLayerStack
                      containerRef={previewInnerRef}
                      layers={sideLayers}
                      setLayers={setActiveSideLayers}
                      selectedLayerId={selectedLayerId}
                      setSelectedLayerId={setSelectedLayerId}
                    />
                  ) : (
                    <div className="mockup-design-placeholder">Choose side above, then click a library thumbnail</div>
                  )}
                </div>
              </div>
            </section>

            <section className="mockup-studio-card mockup-layers-panel-card">
              <h3 className="mockup-studio-card-title">Layers</h3>
              <p className="mockup-preview-sub">Layers for the garment side selected in placement. Eye hides from preview and export.</p>
              {sideLayers.length === 0 ? (
                <div className="mockup-library-empty">No layers on this side.</div>
              ) : (
                <ul className="mockup-layers-list mockup-layers-list--panel">
                  {layersTopFirst.map((L, idx) => (
                    <li key={L.id} className={`mockup-layers-list-item ${selectedLayerId === L.id ? "is-active" : ""}`}>
                      <button
                        type="button"
                        className={`mockup-layer-visibility ${L.visible === false ? "is-off" : ""}`}
                        title={L.visible === false ? "Show layer" : "Hide layer"}
                        aria-label={L.visible === false ? "Show layer" : "Hide layer"}
                        onClick={() => toggleLayerVisible(L.id)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                          {L.visible === false ? (
                            <>
                              <path
                                fill="currentColor"
                                d="M12 6c3.79 0 7.17 2.13 8.82 5.5-.59 1.22-1.42 2.32-2.44 3.24l1.42 1.42c1.35-1.26 2.45-2.76 3.2-4.46C17.09 5.47 14.72 4 12 4c-1.27 0-2.49.2-3.64.57l1.62 1.62C10.59 6.11 11.28 6 12 6zm-1.97 2.38L4 3.35 2.56 4.78l2.2 2.2C3.73 8.89 2.22 10.55 1 12.5 2.73 15.89 7 19 12 19c1.52 0 2.98-.29 4.32-.82l3.42 3.42 1.41-1.41L10.03 8.38zM12 9.5c.73 0 1.39.19 1.97.51L7.51 5.05C7.81 4.44 8.35 4 9 4c.83 0 1.5.67 1.5 1.5 0 .65-.44 1.19-1.05 1.49l2.55 2.51z"
                              />
                            </>
                          ) : (
                            <path
                              fill="currentColor"
                              d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                            />
                          )}
                        </svg>
                      </button>
                      <button type="button" className="mockup-layers-select" onClick={() => setSelectedLayerId(L.id)}>
                        Layer {sideLayers.length - idx}
                      </button>
                      <span className="mockup-layers-actions">
                        <button type="button" title="Forward" onClick={() => bumpLayerZ(L.id, +1)}>
                          ↑
                        </button>
                        <button type="button" title="Back" onClick={() => bumpLayerZ(L.id, -1)}>
                          ↓
                        </button>
                        <button type="button" className="mockup-layers-remove" title="Remove" onClick={() => removeLayer(L.id)}>
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {selectedLayer ? (
                <div className="mockup-tilt-row">
                  <label className="mockup-tilt-label" htmlFor={tiltInputId}>
                    Tilt (°)
                  </label>
                  <div className="mockup-tilt-controls">
                    <input
                      id={tiltInputId}
                      className="mockup-tilt-range"
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={Math.round(Number(selectedLayer.rot) || 0)}
                      onChange={(e) => setSelectedLayerRot(e.target.value)}
                    />
                    <input
                      className="mockup-tilt-number"
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      value={Math.round(Number(selectedLayer.rot) || 0)}
                      onChange={(e) => setSelectedLayerRot(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
              <p className="mockup-layer-hint">
                Drag layer on shirt to move. Corner handle scales. <strong>Ctrl + wheel</strong> on a selected layer resizes.
                Scroll the mockup area (no Ctrl) to zoom. Pick a layer to edit <strong>tilt</strong>.
              </p>
            </section>
          </div>

          <button
            type="button"
            className="btn-mockup mockup-create-wide mockup-create-wire"
            disabled={!hasExportableLayer || exporting}
            onClick={handleExport}
          >
            {exporting ? "Creating…" : "Create Mockup"}
          </button>
        </div>
      </div>
    </div>
  );
}
