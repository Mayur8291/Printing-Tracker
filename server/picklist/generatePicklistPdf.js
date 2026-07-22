import puppeteer from "puppeteer";
import { buildPicklistHtmlDocument } from "../../src/picklist/buildPicklistHtml.js";
import {
  generateBarcodeDataUri,
  loadPicklistCss,
  loadScottBrandLogoDataUri
} from "./picklistAssets.js";

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }
  return browserPromise;
}

/**
 * @param {import('../../src/picklist/picklistTypes.js').PicklistData} data
 * @returns {Promise<Buffer>}
 */
export async function generatePicklistPdf(data) {
  const barcodeDataUri = await generateBarcodeDataUri(`*${data.picklistNo}*`);
  const logoSrc = loadScottBrandLogoDataUri();
  const cssText = loadPicklistCss();
  const html = buildPicklistHtmlDocument(data, {
    barcodeDataUri,
    logoSrc,
    cssText
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    return Buffer.from(pdfBytes);
  } finally {
    await page.close();
  }
}

export async function closePicklistBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}
