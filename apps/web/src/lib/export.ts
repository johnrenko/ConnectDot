import type { DotProject } from "@connectdot/shared";

export const A4 = { width: 794, height: 1123 };

export function buildWorksheetSvg(project: DotProject): string {
  const selected = project.paths.find((path) => path.id === project.selectedPathId) ?? project.paths[0];
  const drawingX = 72;
  const drawingY = 180;
  const drawingW = 650;
  const drawingH = 820;
  const scale = Math.min(drawingW / project.svgWidth, drawingH / project.svgHeight);
  const offsetX = drawingX + (drawingW - project.svgWidth * scale) / 2;
  const offsetY = drawingY + (drawingH - project.svgHeight * scale) / 2;
  const line = project.settings.showConnectionHelperLine
    ? `<polyline points="${project.dots.map((d) => `${offsetX + d.x * scale},${offsetY + d.y * scale}`).join(" ")}" fill="none" stroke="#b9c0cc" stroke-width="1" stroke-dasharray="4 6"/>`
    : "";
  const outline = selected && project.settings.keepOutlineVisible
    ? `<path d="${selected.d}" transform="translate(${offsetX} ${offsetY}) scale(${scale})" fill="none" stroke="#d5dae3" stroke-width="${1 / scale}"/>`
    : "";
  const dots = project.dots.map((dot) => `
    <circle cx="${offsetX + dot.x * scale}" cy="${offsetY + dot.y * scale}" r="${project.settings.dotRadius}" fill="#111827"/>
    <text x="${offsetX + dot.labelX * scale}" y="${offsetY + dot.labelY * scale}" font-family="Arial, sans-serif" font-size="${project.settings.labelFontSize}" fill="#111827">${dot.index}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${A4.width}" height="${A4.height}" viewBox="0 0 ${A4.width} ${A4.height}">
  <rect x="24" y="24" width="746" height="1075" fill="white" stroke="#111827" stroke-width="2"/>
  <text x="72" y="82" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#111827">${escapeXml(project.title)}</text>
  <text x="72" y="128" font-family="Arial, sans-serif" font-size="18" fill="#111827">Name: __________________________</text>
  <text x="510" y="110" font-family="Arial, sans-serif" font-size="16" fill="#111827">Connect the dots from ${project.settings.startIndex} to ${project.settings.startIndex + project.dots.length - 1}</text>
  <text x="510" y="136" font-family="Arial, sans-serif" font-size="16" fill="#111827">Color the picture</text>
  ${line}
  ${outline}
  ${dots}
</svg>`;
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadWorksheetPng(project: DotProject): Promise<void> {
  const svg = buildWorksheetSvg(project);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not render SVG to PNG."));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = A4.width * 2;
  canvas.height = A4.height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is not available.");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const png = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = png;
  a.download = "connectdot-worksheet.png";
  a.click();
}

export function printWorksheetPdf(project: DotProject): void {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Popup blocked. Allow popups to export PDF.");
  win.document.write(`<!doctype html><title>${escapeXml(project.title)}</title><style>@page{size:A4;margin:0}body{margin:0}</style>${buildWorksheetSvg(project)}<script>window.onload=()=>setTimeout(()=>window.print(),100)</script>`);
  win.document.close();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[char] ?? char);
}
