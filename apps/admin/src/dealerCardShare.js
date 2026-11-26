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
