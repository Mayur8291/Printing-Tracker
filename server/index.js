import express from "express";
import { buildPicklistHtmlDocument } from "../src/picklist/buildPicklistHtml.js";
import { SAMPLE_PICKLIST_DATA } from "../src/picklist/picklistTypes.js";
import {
  closePicklistBrowser,
  generatePicklistPdf
} from "./picklist/generatePicklistPdf.js";
import {
  generateBarcodeDataUri,
  loadPicklistCss,
  loadScottBrandLogoDataUri
} from "./picklist/picklistAssets.js";
import { validatePicklistData } from "./picklist/validatePicklistData.js";

const app = express();
const PORT = Number(process.env.PICKLIST_API_PORT || 3001);

app.use(express.json({ limit: "1mb" }));

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.options("/api/picklist/pdf", (_req, res) => {
  res.status(204).end();
});

async function buildAssetsForPicklistNo(picklistNo) {
  const barcodeDataUri = await generateBarcodeDataUri(`*${picklistNo}*`);
  return {
    barcodeDataUri,
    logoSrc: loadScottBrandLogoDataUri()
  };
}

/** JSON assets for React preview page */
app.get("/api/picklist/preview-assets", async (req, res) => {
  try {
    const picklistNo = String(req.query.picklistNo ?? SAMPLE_PICKLIST_DATA.picklistNo).trim();
    const assets = await buildAssetsForPicklistNo(picklistNo);
    res.json(assets);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/** HTML eyeball preview — same renderer as PDF */
app.get("/api/picklist/preview", async (_req, res) => {
  try {
    const assets = await buildAssetsForPicklistNo(SAMPLE_PICKLIST_DATA.picklistNo);
    const html = buildPicklistHtmlDocument(SAMPLE_PICKLIST_DATA, {
      ...assets,
      cssText: loadPicklistCss()
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/** Quick sample PDF download */
app.get("/api/picklist/pdf/sample", async (_req, res) => {
  try {
    const pdf = await generatePicklistPdf(SAMPLE_PICKLIST_DATA);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${SAMPLE_PICKLIST_DATA.picklistNo}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/** POST /api/picklist/pdf — validated PicklistData → application/pdf */
app.post("/api/picklist/pdf", async (req, res) => {
  const parsed = validatePicklistData(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const pdf = await generatePicklistPdf(parsed.data);
    const filename = `${parsed.data.picklistNo}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "picklist-api" });
});

const server = app.listen(PORT, () => {
  console.log(`Picklist API listening on http://localhost:${PORT}`);
  console.log(`  Preview HTML: http://localhost:${PORT}/api/picklist/preview`);
  console.log(`  Sample PDF:   http://localhost:${PORT}/api/picklist/pdf/sample`);
});

async function shutdown() {
  server.close();
  await closePicklistBrowser();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
