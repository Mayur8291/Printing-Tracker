/**
 * Reads public/app-icon.png (RGB or RGBA), writes public/app-icon-rgba.png
 * with near-black pixels made transparent. Use that file for favicon / PWA.
 *
 * npm run icons:transparent
 */
import { Jimp } from "jimp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "public");
const srcPath = path.join(root, "app-icon.png");
const outPath = path.join(root, "app-icon-rgba.png");

const img = await Jimp.read(srcPath);
const thresh = 22;
const { data, width, height } = img.bitmap;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (width * y + x) * 4;
    if (data[idx] <= thresh && data[idx + 1] <= thresh && data[idx + 2] <= thresh) {
      data[idx + 3] = 0;
    }
  }
}
await img.write(outPath);
console.log("Wrote", outPath);
