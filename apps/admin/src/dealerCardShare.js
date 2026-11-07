function slugifyFilename(name) {
  return String(name ?? "dealer")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "dealer";
}

async function captureElementAsPngFile(element, filenameBase) {
  if (!element) throw new Error("Card not found.");
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#ffffff"
  });
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], `${slugifyFilename(filenameBase)}-dealer-card.png`, { type: "image/png" });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Share dealer card image — prefers native share (pick WhatsApp); image only, no caption. */
export async function shareDealerCardViaWhatsApp(element, dealerLabel) {
  const file = await captureElementAsPngFile(element, dealerLabel);

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return { method: "share" };
  }

  downloadFile(file);
  window.open("https://web.whatsapp.com/", "_blank", "noopener,noreferrer");
  return { method: "download" };
}
