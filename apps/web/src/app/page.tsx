"use client";

import { ChangeEvent, PointerEvent, useMemo, useRef, useState } from "react";
import {
  createDefaultProject,
  defaultDotSettings,
  defaultVectorizeOptions,
  deserializeProject,
  generateDotsForPath,
  placeLabels,
  serializeProject,
  type Dot,
  type DotProject,
  type VectorizeOptions
} from "@connectdot/shared";
import { buildWorksheetSvg, downloadText, downloadWorksheetPng, printWorksheetPdf } from "@/lib/export";
import { validateUpload, vectorizeFile } from "@/lib/vectorize";

type DragTarget = { kind: "dot" | "label"; id: string } | null;

export default function Home() {
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [options, setOptions] = useState<VectorizeOptions>(defaultVectorizeOptions);
  const [project, setProject] = useState<DotProject>(() => createDefaultProject());
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);
  const editorRef = useRef<SVGSVGElement | null>(null);
  const worksheet = useMemo(() => buildWorksheetSvg(project), [project]);
  const selectedPath = project.paths.find((path) => path.id === project.selectedPathId) ?? project.paths[0];

  async function handleFile(file: File) {
    setError(null);
    setWarnings([]);
    const validation = validateUpload(file);
    if (validation) {
      setError(validation);
      return;
    }
    setFilePreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const result = await vectorizeFile(file, options);
      setWarnings(result.warnings);
      const next = createDefaultProject({
        title: file.name.replace(/\.[^.]+$/, "") || "Connect the dots",
        sourceImageName: file.name,
        svgWidth: result.svgWidth,
        svgHeight: result.svgHeight,
        paths: result.paths,
        selectedPathId: result.selectedPathId,
        settings: { ...defaultDotSettings, numberOfDots: 50 }
      });
      const path = result.paths.find((candidate) => candidate.id === result.selectedPathId) ?? result.paths[0];
      next.dots = path ? generateDotsForPath(path, next.settings) : [];
      setProject(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not vectorize this image.");
    } finally {
      setBusy(false);
    }
  }

  function updateSetting<K extends keyof DotProject["settings"]>(key: K, value: DotProject["settings"][K]) {
    setProject((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  function generateDots() {
    if (!selectedPath) return;
    setProject((current) => ({ ...current, dots: generateDotsForPath(selectedPath, current.settings) }));
  }

  function resetLabels() {
    setProject((current) => ({
      ...current,
      dots: placeLabels(current.dots, current.settings.labelFontSize, current.settings.dotRadius, current.settings.startIndex).map((label, i) => {
        const source = current.dots[i] ?? label;
        return { ...source, labelX: label.labelX, labelY: label.labelY, labelWarning: label.labelWarning };
      })
    }));
  }

  function reverseDots() {
    setProject((current) => ({
      ...current,
      dots: current.dots.toReversed().map((dot, i) => ({ ...dot, id: `dot-${i + 1}`, index: current.settings.startIndex + i })),
      settings: { ...current.settings, reverseOrder: !current.settings.reverseOrder }
    }));
  }

  function reorder(dots: Dot[], start = project.settings.startIndex): Dot[] {
    return dots.map((dot, i) => ({ ...dot, id: `dot-${i + 1}`, index: start + i }));
  }

  function deleteSelected() {
    if (!selectedDotId) return;
    setProject((current) => ({ ...current, dots: reorder(current.dots.filter((dot) => dot.id !== selectedDotId), current.settings.startIndex) }));
    setSelectedDotId(null);
  }

  function pointFromEvent(event: PointerEvent<SVGSVGElement>) {
    const svg = editorRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setProject((current) => ({
      ...current,
      dots: current.dots.map((dot) => dot.id === dragging.id
        ? dragging.kind === "dot" ? { ...dot, x: point.x, y: point.y } : { ...dot, labelX: point.x, labelY: point.y }
        : dot)
    }));
  }

  function addDot(event: PointerEvent<SVGSVGElement>) {
    const tag = (event.target as Element).tagName.toLowerCase();
    if (event.target !== editorRef.current && tag !== "rect") return;
    const point = pointFromEvent(event);
    if (!point) return;
    setProject((current) => ({
      ...current,
      dots: reorder([...current.dots, { id: "new", index: 0, x: point.x, y: point.y, labelX: point.x + 14, labelY: point.y - 14 }], current.settings.startIndex)
    }));
  }

  function loadProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setProject(deserializeProject(text) as DotProject)).catch((cause) => setError(cause instanceof Error ? cause.message : "Invalid JSON project."));
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <h1>ConnectDot MVP</h1>
          <p>Upload an image, extract an outline, generate numbered dots, fine tune manually, then export a printable A4 worksheet.</p>
        </div>
        <div className="row">
          <button className="button secondary" onClick={() => downloadText("connectdot-project.json", serializeProject(project), "application/json")}>Save JSON</button>
          <label className="button secondary">Load JSON<input hidden type="file" accept="application/json" onChange={loadProject} /></label>
        </div>
      </section>

      <div className="grid">
        <aside className="panel stack">
          <div className="drop">
            <strong>Step 1 — Upload</strong>
            <p className="small">PNG, JPG, JPEG, WebP, or SVG · max 10 MB</p>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
          </div>
          {filePreview && <img className="filePreview" src={filePreview} alt="Original upload preview" />}
          {error && <div className="error">{error}</div>}
          {warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}

          <Controls options={options} setOptions={setOptions} project={project} setProject={setProject} updateSetting={updateSetting} />
          <div className="row">
            <button className="button" disabled={busy || !selectedPath} onClick={generateDots}>{busy ? "Vectorizing…" : "Generate dots"}</button>
            <button className="button secondary" onClick={resetLabels}>Reset labels</button>
            <button className="button secondary" onClick={reverseDots}>Reverse order</button>
            <button className="button danger" disabled={!selectedDotId} onClick={deleteSelected}>Delete selected</button>
          </div>
          <div className="row">
            <button className="button" onClick={() => downloadText("connectdot-worksheet.svg", worksheet, "image/svg+xml")}>Export SVG</button>
            <button className="button secondary" onClick={() => void downloadWorksheetPng(project)}>Export PNG</button>
            <button className="button secondary" onClick={() => printWorksheetPdf(project)}>Export PDF</button>
          </div>
          <p className="small">Inspired by the MIT-licensed cuSTEMized generator: SVG paths become draggable dots and labels. This app keeps the implementation modular for raster vectorization and A4 exports.</p>
        </aside>

        <section className="panel stack">
          <div className="tabs"><span className="tab active">Editor</span><span className="tab">A4 export preview below</span></div>
          <svg
            ref={editorRef}
            className="editorSvg"
            viewBox={`0 0 ${project.svgWidth} ${project.svgHeight}`}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
            onPointerDown={addDot}
          >
            <rect width={project.svgWidth} height={project.svgHeight} fill="#fff" />
            {selectedPath && project.settings.keepOutlineVisible && <path d={selectedPath.d} fill="none" stroke="#94a3b8" strokeWidth={2} />}
            {project.settings.showConnectionHelperLine && <polyline points={project.dots.map((dot) => `${dot.x},${dot.y}`).join(" ")} fill="none" stroke="#cbd5e1" strokeDasharray="5 6" />}
            {project.dots.map((dot) => (
              <g key={dot.id}>
                <circle className={`dot ${selectedDotId === dot.id ? "selected" : ""}`} cx={dot.x} cy={dot.y} r={project.settings.dotRadius + 2} fill="#111827" onPointerDown={(event) => { event.stopPropagation(); setSelectedDotId(dot.id); setDragging({ kind: "dot", id: dot.id }); }} />
                <text className="labelText" x={dot.labelX} y={dot.labelY} fontSize={project.settings.labelFontSize} fill={dot.labelWarning ? "#ea580c" : "#111827"} onPointerDown={(event) => { event.stopPropagation(); setSelectedDotId(dot.id); setDragging({ kind: "label", id: dot.id }); }}>{dot.index}</text>
              </g>
            ))}
          </svg>
          <div className="previewWrap"><div className="worksheet" dangerouslySetInnerHTML={{ __html: worksheet }} /></div>
        </section>
      </div>
    </main>
  );
}

function Controls({ options, setOptions, project, setProject, updateSetting }: {
  options: VectorizeOptions;
  setOptions: (options: VectorizeOptions) => void;
  project: DotProject;
  setProject: (project: DotProject) => void;
  updateSetting: <K extends keyof DotProject["settings"]>(key: K, value: DotProject["settings"][K]) => void;
}) {
  return <div className="stack">
    <strong>Step 2 — Outline controls</strong>
    <label className="label">Mode<select value={options.mode} onChange={(event) => setOptions({ ...options, mode: event.target.value as VectorizeOptions["mode"] })}><option value="threshold">Threshold</option><option value="canny">Canny-ish edges</option><option value="svg">SVG input</option></select></label>
    <label className="label">Threshold {options.threshold}<input type="range" min="1" max="254" value={options.threshold} onChange={(event) => setOptions({ ...options, threshold: Number(event.target.value) })} /></label>
    <label className="label">Blur / smoothing {options.blur}<input type="range" min="0" max="10" value={options.blur} onChange={(event) => setOptions({ ...options, blur: Number(event.target.value) })} /></label>
    <label className="label">Remove small details {options.removeSmallDetails}<input type="range" min="1" max="100" value={options.removeSmallDetails} onChange={(event) => setOptions({ ...options, removeSmallDetails: Number(event.target.value) })} /></label>
    <label className="label">Simplify contour {options.simplify}<input type="range" min="1" max="20" value={options.simplify} onChange={(event) => setOptions({ ...options, simplify: Number(event.target.value) })} /></label>
    <label className="row"><input type="checkbox" checked={options.invert} onChange={(event) => setOptions({ ...options, invert: event.target.checked })} /> Invert image</label>
    <strong>Step 3 — Dot settings</strong>
    <label className="label">Title<input value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} /></label>
    <label className="label">Number of dots<input type="number" min="2" max="300" value={project.settings.numberOfDots} onChange={(event) => updateSetting("numberOfDots", Number(event.target.value))} /></label>
    <label className="label">Minimum distance<input type="number" min="0" value={project.settings.minimumDistance} onChange={(event) => updateSetting("minimumDistance", Number(event.target.value))} /></label>
    <label className="label">Dot radius<input type="number" min="1" value={project.settings.dotRadius} onChange={(event) => updateSetting("dotRadius", Number(event.target.value))} /></label>
    <label className="label">Label font size<input type="number" min="6" value={project.settings.labelFontSize} onChange={(event) => updateSetting("labelFontSize", Number(event.target.value))} /></label>
    <label className="label">Start index<input type="number" value={project.settings.startIndex} onChange={(event) => updateSetting("startIndex", Number(event.target.value))} /></label>
    <label className="row"><input type="checkbox" checked={project.settings.keepOutlineVisible} onChange={(event) => updateSetting("keepOutlineVisible", event.target.checked)} /> Keep outline visible</label>
    <label className="row"><input type="checkbox" checked={project.settings.showConnectionHelperLine} onChange={(event) => updateSetting("showConnectionHelperLine", event.target.checked)} /> Show helper line</label>
  </div>;
}
