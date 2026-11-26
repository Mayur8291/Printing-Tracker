function slugifyFilename(name) {
  return String(name ?? "dealer")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "dealer";
}

async function captureElementAsPngFile(element, filename) {
  if (!element) throw new Error("Card not found.");
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#ffffff"
  });
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: "image/png" });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
}

function pngFileFromDataUrl(dataUrl, filename) {
  const comma = String(dataUrl).indexOf(",");
  const binary = atob(String(dataUrl).slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: "image/png" });
}

function sharePageHtml(dataUrl, filename, title) {
  const name = JSON.stringify(filename);
  const src = JSON.stringify(dataUrl);
  const heading = JSON.stringify(title || "Product received");
  const safeTitle = String(title || "Product received").replace(/[<>&"]/g, "");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;background:#111;color:#fff;font-family:sans-serif">
  <header style="position:sticky;top:0;z-index:2;display:flex;align-items:center;height:52px;padding:0 8px;background:#fff;border-bottom:1px solid #e2e8f0">
    <button id="back" type="button" style="min-height:44px;padding:0 12px;border:0;background:transparent;color:#0f172a;font-size:17px">← Back</button>
  </header>
  <img alt=${heading} src=${src} style="display:block;width:100%;height:auto;background:#fff">
  <button id="share" type="button" style="position:fixed;left:16px;right:16px;bottom:24px;height:48px;border:0;border-radius:12px;background:#b91c1c;color:#fff;font-size:17px">Share</button>
  <p id="hint" style="position:fixed;left:16px;right:16px;bottom:80px;margin:0;text-align:center;font-size:14px"></p>
  <script>
    document.getElementById("back").addEventListener("click", function () {
      if (window.opener && !window.opener.closed) window.close();
      history.back();
    });
    document.getElementById("share").addEventListener("click", async function () {
      const hint = document.getElementById("hint");
      try {
        const response = await fetch(${src});
        const blob = await response.blob();
        const file = new File([blob], ${name}, { type: "image/png" });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ files: [file], title: ${heading} });
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      hint.textContent = "Press and hold the image, then choose Share.";
    });
  </script>
</body>
</html>`;
}

function openShareTab(dataUrl, filename, title) {
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("Allow pop-ups so the image can open in a new tab.");
  tab.document.open();
  tab.document.write(sharePageHtml(dataUrl, filename, title));
  tab.document.close();
}

/**
 * Ask the phone where to send the image. If that sheet is not available,
 * open the image in a new tab instead of the file-download preview.
 */
export function presentPngShare(dataUrl, filename, title = "Product received") {
  const file = pngFileFromDataUrl(dataUrl, filename);
  openShareTab(dataUrl, filename, title);
  const canShareFiles =
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }));
  if (!canShareFiles) return Promise.resolve({ method: "tab" });
  return navigator
    .share({ files: [file], title })
    .then(() => ({ method: "share" }))
    .catch((err) => {
      if (err?.name === "AbortError") return { method: "share" };
      return { method: "tab" };
    });
}

/** Share a PNG file. On a phone the share sheet can send it straight to WhatsApp. */
export async function sharePngFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return { method: "share" };
  }

  downloadFile(file);
  window.open("https://web.whatsapp.com/", "_blank", "noopener,noreferrer");
  return { method: "download" };
}

export function canvasToPngFile(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("The image could not be prepared."));
      else resolve(new File([blob], filename, { type: "image/png" }));
    }, "image/png");
  });
}

/** Share a card image. On a phone the share sheet can send it straight to WhatsApp. */
export async function shareElementImage(element, filename) {
  const file = await captureElementAsPngFile(element, filename);
  return sharePngFile(file);
}

/** Share dealer card image — prefers native share (pick WhatsApp); image only, no caption. */
export async function shareDealerCardViaWhatsApp(element, dealerLabel) {
  return shareElementImage(element, `${slugifyFilename(dealerLabel)}-dealer-card.png`);
}
