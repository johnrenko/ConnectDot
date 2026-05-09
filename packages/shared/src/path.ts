import type { Dot, DotSettings, SvgPath } from "./index";

export type Point = { x: number; y: number };
type Segment = { from: Point; to: Point; length: number };

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const commandRe = /[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;
const isCommand = (token: string | undefined): token is string => !!token && /^[a-zA-Z]$/.test(token);

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const mt = 1 - t;
  return { x: mt ** 3 * a.x + 3 * mt ** 2 * t * b.x + 3 * mt * t ** 2 * c.x + t ** 3 * d.x, y: mt ** 3 * a.y + 3 * mt ** 2 * t * b.y + 3 * mt * t ** 2 * c.y + t ** 3 * d.y };
}

function quad(a: Point, b: Point, c: Point, t: number): Point {
  const mt = 1 - t;
  return { x: mt ** 2 * a.x + 2 * mt * t * b.x + t ** 2 * c.x, y: mt ** 2 * a.y + 2 * mt * t * b.y + t ** 2 * c.y };
}

export function flattenPath(d: string): Point[] {
  const tokens = d.match(commandRe) ?? [];
  const points: Point[] = [];
  let i = 0;
  let cmd = "M";
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  const read = () => Number(tokens[i++]);
  const add = (point: Point) => { points.push(point); current = point; };
  while (i < tokens.length) {
    if (isCommand(tokens[i])) cmd = tokens[i++] ?? cmd;
    const relative = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    const abs = (x: number, y: number) => relative ? { x: current.x + x, y: current.y + y } : { x, y };
    if (c === "M") {
      const p = abs(read(), read());
      add(p); start = p; cmd = relative ? "l" : "L";
    } else if (c === "L") {
      add(abs(read(), read()));
    } else if (c === "H") {
      const x = read(); add({ x: relative ? current.x + x : x, y: current.y });
    } else if (c === "V") {
      const y = read(); add({ x: current.x, y: relative ? current.y + y : y });
    } else if (c === "C") {
      const from = current;
      const p1 = abs(read(), read()); const p2 = abs(read(), read()); const p3 = abs(read(), read());
      for (let step = 1; step <= 16; step++) add(cubic(from, p1, p2, p3, step / 16));
    } else if (c === "Q") {
      const from = current;
      const p1 = abs(read(), read()); const p2 = abs(read(), read());
      for (let step = 1; step <= 12; step++) add(quad(from, p1, p2, step / 12));
    } else if (c === "Z") {
      add(start);
    } else {
      break;
    }
  }
  return points;
}

function segmentsForPath(d: string): Segment[] {
  const points = flattenPath(d);
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const length = distance(from, to);
    if (length > 0) segments.push({ from, to, length });
  }
  return segments;
}

export function samplePath(d: string, count: number, reverse = false): Point[] {
  if (count <= 0) return [];
  const segments = segmentsForPath(d);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= 0) return [];
  const atLength = (target: number): Point => {
    let walked = 0;
    for (const segment of segments) {
      if (walked + segment.length >= target) {
        const t = (target - walked) / segment.length;
        return { x: segment.from.x + (segment.to.x - segment.from.x) * t, y: segment.from.y + (segment.to.y - segment.from.y) * t };
      }
      walked += segment.length;
    }
    return segments.at(-1)?.to ?? { x: 0, y: 0 };
  };
  if (count === 1) return [atLength(reverse ? total : 0)];
  return Array.from({ length: count }, (_, i) => atLength(reverse ? total * (1 - i / (count - 1)) : total * (i / (count - 1))));
}

export function filterByMinimumDistance(points: Point[], minimumDistance: number): Point[] {
  if (minimumDistance <= 0) return points;
  const kept: Point[] = [];
  for (const point of points) if (kept.every((candidate) => distance(candidate, point) >= minimumDistance)) kept.push(point);
  return kept;
}

type CollisionBox = { x: number; y: number; width: number; height: number };
const intersects = (a: CollisionBox, b: CollisionBox): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function placeLabels(points: Point[], fontSize: number, dotRadius: number, startIndex = 1): Dot[] {
  const boxes: CollisionBox[] = [];
  const offsets = [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
  return points.map((point, i) => {
    const label = String(startIndex + i);
    const width = Math.max(fontSize * 0.65 * label.length, fontSize);
    const height = fontSize;
    let warning = true;
    let chosen = { x: point.x + dotRadius + 8, y: point.y - dotRadius - 8 };
    for (const [ox, oy] of offsets) {
      const candidate = { x: point.x + (ox ?? 1) * (dotRadius + 10), y: point.y + (oy ?? -1) * (dotRadius + 10) };
      const box = { x: candidate.x - 2, y: candidate.y - height, width: width + 4, height: height + 4 };
      const dotBox = { x: point.x - dotRadius * 2, y: point.y - dotRadius * 2, width: dotRadius * 4, height: dotRadius * 4 };
      if (!intersects(box, dotBox) && boxes.every((existing) => !intersects(existing, box))) { chosen = candidate; boxes.push(box); warning = false; break; }
    }
    if (warning) boxes.push({ x: chosen.x - 2, y: chosen.y - height, width: width + 4, height: height + 4 });
    return { id: `dot-${i + 1}`, index: startIndex + i, x: point.x, y: point.y, labelX: chosen.x, labelY: chosen.y, labelWarning: warning } satisfies Dot;
  });
}

export function generateDotsForPath(path: SvgPath, settings: DotSettings): Dot[] {
  const oversampleCount = Math.max(settings.numberOfDots * 3, settings.numberOfDots);
  const sampled = samplePath(path.d, oversampleCount, settings.reverseOrder);
  const filtered = filterByMinimumDistance(sampled, settings.minimumDistance).slice(0, settings.numberOfDots);
  const target = filtered.length >= settings.numberOfDots ? filtered : samplePath(path.d, settings.numberOfDots, settings.reverseOrder);
  return placeLabels(target, settings.labelFontSize, settings.dotRadius, settings.startIndex);
}

export function serializeProject(project: unknown): string { return JSON.stringify(project, null, 2); }
export function deserializeProject(json: string): unknown {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid project JSON");
  return parsed;
}
