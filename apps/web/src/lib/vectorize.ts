import type { SvgPath, VectorizeOptions, VectorizeResponse } from "@connectdot/shared";

const supportedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);
const maxBytes = 10 * 1024 * 1024;

export function validateUpload(file: File): string | null {
  if (!supportedTypes.has(file.type) && !file.name.toLowerCase().endsWith(".svg")) {
    return "Unsupported file type. Please upload PNG, JPG, JPEG, WebP, or SVG.";
  }
  if (file.size > maxBytes) return "File is too large. The MVP limit is 10 MB.";
  return null;
}

export async function vectorizeFile(file: File, options: VectorizeOptions): Promise<VectorizeResponse> {
  const validation = validateUpload(file);
  if (validation) throw new Error(validation);
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    return vectorizeSvg(await file.text());
  }

  const form = new FormData();
  form.append("image", file);
  form.append("options", JSON.stringify(options));
  try {
    const response = await fetch("/api/vectorize", { method: "POST", body: form });
    if (response.ok) return (await response.json()) as VectorizeResponse;
  } catch {
    // Browser fallback below keeps the MVP usable without the Python service.
  }
  return vectorizeRasterInBrowser(file, options);
}

function getSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return { width: viewBox[2] ?? 800, height: viewBox[3] ?? 600 };
  const width = parseFloat(svg.getAttribute("width") ?? "800");
  const height = parseFloat(svg.getAttribute("height") ?? "600");
  return { width: Number.isFinite(width) ? width : 800, height: Number.isFinite(height) ? height : 600 };
}

export function vectorizeSvg(svgText: string): VectorizeResponse {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("Invalid SVG file.");
  const paths: SvgPath[] = Array.from(doc.querySelectorAll("path[d]")).map((path, i) => ({
    id: `path-${i + 1}`,
    d: path.getAttribute("d") ?? "",
    label: path.getAttribute("id") ?? `Path ${i + 1}`,
    stroke: path.getAttribute("stroke") ?? undefined,
    fill: path.getAttribute("fill") ?? undefined
  })).filter((path) => path.d.trim().length > 0);
  if (paths.length === 0) throw new Error("This SVG does not contain path elements yet. Convert shapes to paths first.");
  const { width, height } = getSvgSize(svg as unknown as SVGSVGElement);
  return { svgWidth: width, svgHeight: height, paths, selectedPathId: paths[0]?.id ?? "", warnings: [] };
}

async function vectorizeRasterInBrowser(file: File, options: VectorizeOptions): Promise<VectorizeResponse> {
  const image = await createImageBitmap(file);
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available for browser vectorization.");
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    const gray = data.data[offset] * 0.299 + data.data[offset + 1] * 0.587 + data.data[offset + 2] * 0.114;
    const on = options.mode === "canny" ? gray < options.threshold || gray > 255 - options.threshold / 2 : gray < options.threshold;
    mask[i] = options.invert ? (on ? 0 : 1) : (on ? 1 : 0);
  }
  const points: { x: number; y: number }[] = [];
  const step = Math.max(1, Math.round(options.removeSmallDetails / 10));
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const i = y * width + x;
      if (!mask[i]) continue;
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) points.push({ x, y });
    }
  }
  if (points.length < 3) throw new Error("Could not extract a clear outline. Try invert/threshold controls or a simpler image.");
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const stride = Math.max(1, Math.round(options.simplify));
  const simplified = points.filter((_, i) => i % stride === 0).slice(0, 1200);
  const d = simplified.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";
  return {
    svgWidth: width,
    svgHeight: height,
    paths: [{ id: "browser-outline", d, label: "Browser outline" }],
    selectedPathId: "browser-outline",
    warnings: ["Used browser fallback vectorization. For cleaner contours, run the FastAPI service."]
  };
}
