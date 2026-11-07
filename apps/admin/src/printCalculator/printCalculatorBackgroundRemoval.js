/** Mask refine + alpha smooth (ported from DTF Calculator). */

import { pixelsToInches } from "./printCalculatorUtils";

function refineMask(imageData, w, h) {
  const d = imageData.data;
  const out = new Uint8ClampedArray(d.length);
  out.set(d);
  const radius = 1;
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      let maxA = 0;
      let minA = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const i = ((y + dy) * w + (x + dx)) * 4 + 3;
          maxA = Math.max(maxA, d[i]);
          minA = Math.min(minA, d[i]);
        }
      }
      const i = (y * w + x) * 4 + 3;
      const a = d[i];
      if (a < 128) out[i] = Math.min(a, minA + 40);
      else out[i] = Math.max(a, maxA - 40);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = out[i];
}

function alphaMatteSmoothing(imageData, w, h, radius = 2) {
  const d = imageData.data;
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = d[i * 4 + 3];
  const out = new Float32Array(w * h);
  const size = (2 * radius + 1) ** 2;
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          sum += alpha[(y + dy) * w + (x + dx)];
        }
      }
      out[y * w + x] = sum / size;
    }
  }
  for (let i = 0; i < w * h; i++) d[i * 4 + 3] = Math.round(out[i]);
}

/** Tight box around non-transparent pixels in the PNG alpha channel. */
function opaqueBoundingBox(imageData, width, height, alphaMin = 8) {
  const d = imageData.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function cropCanvasToBox(sourceCanvas, box) {
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    sourceCanvas,
    box.minX,
    box.minY,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height
  );
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Remove background; crop to opaque pixels; return PNG + print dimensions from result pixels.
 * @param {{ file?: File, previewUrl: string }} artwork
 * @param {(message: string) => void} [onStatus]
 * @returns {Promise<{ dataUrl: string, widthPx: number, heightPx: number, widthInches: string, heightInches: string }>}
 */
export async function removeArtworkBackground(artwork, onStatus) {
  const { removeBackground } = await import("@imgly/background-removal");

  onStatus?.("Loading model…");

  const imageInput =
    artwork.file ||
    (await (async () => {
      const resp = await fetch(artwork.previewUrl);
      return resp.blob();
    })());

  onStatus?.("Removing background…");
  const blob = await removeBackground(imageInput, {
    output: { format: "image/png", type: "foreground" },
    progress: (key, current, total) => {
      if (key.startsWith("fetch") && total > 0) {
        onStatus?.(`Downloading model… ${Math.round((current / total) * 100)}%`);
      }
    }
  });

  const segUrl = URL.createObjectURL(blob);
  try {
    const segImg = await loadImage(segUrl);
    const w = segImg.naturalWidth;
    const h = segImg.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(segImg, 0, 0, w, h);

    onStatus?.("Refining edges…");
    let imageData = ctx.getImageData(0, 0, w, h);
    refineMask(imageData, w, h);
    ctx.putImageData(imageData, 0, 0);

    onStatus?.("Smoothing alpha…");
    imageData = ctx.getImageData(0, 0, w, h);
    alphaMatteSmoothing(imageData, w, h, 2);
    ctx.putImageData(imageData, 0, 0);

    onStatus?.("Measuring artwork size…");
    imageData = ctx.getImageData(0, 0, w, h);
    const box = opaqueBoundingBox(imageData, w, h);
    const finalCanvas = box ? cropCanvasToBox(canvas, box) : canvas;
    const widthPx = box?.width ?? w;
    const heightPx = box?.height ?? h;

    onStatus?.("Done");
    return {
      dataUrl: finalCanvas.toDataURL("image/png"),
      widthPx,
      heightPx,
      widthInches: pixelsToInches(widthPx),
      heightInches: pixelsToInches(heightPx)
    };
  } finally {
    URL.revokeObjectURL(segUrl);
  }
}
