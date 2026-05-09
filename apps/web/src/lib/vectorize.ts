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
    if (response.ok) {
      const payload = await response.json() as VectorizeResponse | { fallback?: string };
      if ("fallback" in payload) return vectorizeRasterInBrowser(file, options);
      if (!("paths" in payload)) return vectorizeRasterInBrowser(file, options);
      return payload;
    }
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
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    const offset = i * 4;
    const gray = data.data[offset] * 0.299 + data.data[offset + 1] * 0.587 + data.data[offset + 2] * 0.114;
    const on = options.mode === "canny" ? gray < options.threshold || gray > 255 - options.threshold / 2 : gray < options.threshold;
    ink[i] = options.invert ? (on ? 0 : 1) : (on ? 1 : 0);
  }
  const silhouette = buildSilhouetteMask(ink, width, height);
  const outline = traceSilhouetteOutline(silhouette, width, height);
  if (outline.length < 3) throw new Error("Could not extract a clear outline. Try invert/threshold controls or a simpler image.");
  const simplified = simplifyPoints(outline, Math.max(1, options.simplify)).slice(0, 1200);
  const d = simplified.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";
  return {
    svgWidth: width,
    svgHeight: height,
    paths: [{ id: "browser-outline", d, label: "Browser outline" }],
    selectedPathId: "browser-outline",
    warnings: ["Used browser fallback vectorization. For cleaner contours, run the FastAPI service."]
  };
}

function buildSilhouetteMask(ink: Uint8Array, width: number, height: number): Uint8Array {
  const radius = Math.max(2, Math.round(Math.max(width, height) / 160));
  const barrier = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) barrier[ny * width + nx] = 1;
        }
      }
    }
  }

  const exterior = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (x: number, y: number) => {
    const i = y * width + x;
    if (barrier[i] || exterior[i]) return;
    exterior[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const x = i % width;
    const y = Math.floor(i / width);
    if (x > 0) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
  }

  const silhouette = new Uint8Array(width * height);
  for (let i = 0; i < silhouette.length; i++) silhouette[i] = exterior[i] ? 0 : 1;
  return silhouette;
}

type OutlinePoint = { x: number; y: number };

function traceSilhouetteOutline(mask: Uint8Array, width: number, height: number): OutlinePoint[] {
  const edge = (name: "top" | "right" | "bottom" | "left", x: number, y: number): string => {
    if (name === "top") return `${2 * x + 1},${2 * y}`;
    if (name === "right") return `${2 * x + 2},${2 * y + 1}`;
    if (name === "bottom") return `${2 * x + 1},${2 * y + 2}`;
    return `${2 * x},${2 * y + 1}`;
  };
  const table: Record<number, Array<[string, string]>> = {
    1: [["left", "top"]], 2: [["top", "right"]], 3: [["left", "right"]],
    4: [["right", "bottom"]], 5: [["left", "top"], ["right", "bottom"]], 6: [["top", "bottom"]],
    7: [["left", "bottom"]], 8: [["bottom", "left"]], 9: [["top", "bottom"]],
    10: [["top", "right"], ["bottom", "left"]], 11: [["right", "bottom"]],
    12: [["left", "right"]], 13: [["top", "right"]], 14: [["left", "top"]]
  };
  const adjacency = new Map<string, Set<string>>();
  const unused = new Set<string>();
  const addSegment = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
    unused.add(segmentKey(a, b));
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const state = (mask[y * width + x] ? 1 : 0)
        + (mask[y * width + x + 1] ? 2 : 0)
        + (mask[(y + 1) * width + x + 1] ? 4 : 0)
        + (mask[(y + 1) * width + x] ? 8 : 0);
      for (const [a, b] of table[state] ?? []) addSegment(edge(a as "top", x, y), edge(b as "top", x, y));
    }
  }
  let best: string[] = [];
  while (unused.size > 0) {
    const first = unused.values().next().value as string;
    const [a, b] = first.split("|");
    const path = [a ?? "", b ?? ""];
    unused.delete(first);
    extendPath(path, adjacency, unused, true);
    extendPath(path, adjacency, unused, false);
    if (path.length > best.length) best = path;
  }
  return best.map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x: (x ?? 0) / 2, y: (y ?? 0) / 2 };
  });
}

function segmentKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function extendPath(path: string[], adjacency: Map<string, Set<string>>, unused: Set<string>, atEnd: boolean): void {
  while (true) {
    const current = atEnd ? path.at(-1) : path[0];
    if (!current) return;
    const next = Array.from(adjacency.get(current) ?? []).find((candidate) => unused.has(segmentKey(current, candidate)));
    if (!next) return;
    unused.delete(segmentKey(current, next));
    if (atEnd) path.push(next);
    else path.unshift(next);
  }
}

function simplifyPoints(points: OutlinePoint[], tolerance: number): OutlinePoint[] {
  if (points.length <= 2) return points;
  const step = Math.max(1, Math.round(tolerance));
  const sampled = points.filter((_, i) => i % step === 0);
  return sampled.length >= 3 ? sampled : points;
}
