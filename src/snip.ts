// html2canvas-pro snip helper — extracted from CRM's bug-report-fab.
// Renders the FULL document via html2canvas-pro then crops to a drag rect.
// Cropping client-side is more reliable than html2canvas-pro's x/y/width/
// height options (which behave inconsistently across versions).
//
// Skips DOM nodes tagged with data-brf-skip="1" so the FAB itself + the
// snip-arm overlay don't appear in the captured screenshot.

export type Rect = { x: number; y: number; w: number; h: number };

export async function captureRectAsFile(rect: Rect): Promise<File> {
  const mod = await import("html2canvas-pro");
  const html2canvas = (mod as { default?: typeof import("html2canvas-pro").default }).default ?? mod;

  const dpr = window.devicePixelRatio || 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullCanvas: HTMLCanvasElement = await (html2canvas as any)(document.documentElement, {
    backgroundColor: null,
    scale: dpr,
    logging: false,
    useCORS: true,
    allowTaint: true,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
    ignoreElements: (el: Element) => {
      const he = el as HTMLElement;
      return he?.dataset?.brfSkip === "1";
    },
  });

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.round(rect.w * dpr));
  cropCanvas.height = Math.max(1, Math.round(rect.h * dpr));
  const ctx = cropCanvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");
  ctx.drawImage(
    fullCanvas,
    Math.round((rect.x + window.scrollX) * dpr),
    Math.round((rect.y + window.scrollY) * dpr),
    Math.round(rect.w * dpr),
    Math.round(rect.h * dpr),
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // Try PNG; if it overflows 5MB (common on retina) fall back to JPEG q=0.85.
  const pngBlob = await new Promise<Blob | null>((resolve) =>
    cropCanvas.toBlob((b) => resolve(b), "image/png", 0.95),
  );
  if (!pngBlob) throw new Error("toBlob returned null");

  if (pngBlob.size <= 5 * 1024 * 1024) {
    return new File([pngBlob], `cuplikan-${stamp}.png`, { type: "image/png" });
  }

  const jpegBlob = await new Promise<Blob | null>((resolve) =>
    cropCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
  );
  if (!jpegBlob) throw new Error("toBlob jpeg returned null");
  return new File([jpegBlob], `cuplikan-${stamp}.jpg`, { type: "image/jpeg" });
}
