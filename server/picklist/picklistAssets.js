import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bwipjs from "bwip-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

let cssCache = null;
let brandLogoDataUriCache = null;

export function loadPicklistCss() {
  if (!cssCache) {
    cssCache = fs.readFileSync(path.join(ROOT, "src/picklist/picklist.css"), "utf8");
  }
  return cssCache;
}

export function loadScottBrandLogoDataUri() {
  if (!brandLogoDataUriCache) {
    const logoPath = path.join(ROOT, "public/brand-logo.png");
    const png = fs.readFileSync(logoPath);
    brandLogoDataUriCache = `data:image/png;base64,${png.toString("base64")}`;
  }
  return brandLogoDataUriCache;
}

/** @deprecated Use loadScottBrandLogoDataUri */
export const loadUnicommerceLogoDataUri = loadScottBrandLogoDataUri;

/**
 * Code 128 barcode as PNG data URI (~170x38 via scale/height options).
 * @param {string} text e.g. *PK39506*
 */
export async function generateBarcodeDataUri(text) {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: String(text),
    scale: 2,
    height: 12,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function picklistAssetsRoot() {
  return ROOT;
}
