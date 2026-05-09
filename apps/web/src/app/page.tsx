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
  type EraserStroke,
  type OriginalImageMode,
  type VectorizeOptions
} from "@connectdot/shared";
import { buildWorksheetSvg, downloadText, downloadWorksheetPng, printWorksheetPdf } from "@/lib/export";
import { validateUpload, vectorizeFile } from "@/lib/vectorize";

type DragTarget = { kind: "dot" | "label"; id: string } | null;
type EditorMode = "dots" | "erase";

export default function Home() {
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [options, setOptions] = useState<VectorizeOptions>(defaultVectorizeOptions);
  const [project, setProject] = useState<DotProject>(() => createDefaultProject());
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("dots");
  const [erasingStrokeId, setErasingStrokeId] = useState<string | null>(null);
  const editorRef = useRef<SVGSVGElement | null>(null);
  const worksheet = useMemo(() => buildWorksheetSvg(project), [project]);
  const selectedPath = project.paths.find((path) => path.id === project.selectedPathId) ?? project.paths[0];
  const sourceClipId = "editor-source-clip";
  const sourceMaskId = "editor-source-mask";
  const originalImageMode = getOriginalImageMode(project);

  async function handleFile(file: File) {
    setError(null);
    setWarnings([]);
    const validation = validateUpload(file);
    if (validation) {
      setError(validation);
      return;
    }
    const sourceImageDataUrl = await readFileDataUrl(file);
    setSourceFile(file);
    setFilePreview(sourceImageDataUrl);
    setBusy(true);
    try {
      const result = await vectorizeFile(file, options);
      setWarnings(result.warnings);
      const next = createDefaultProject({
        title: titleFromFileName(file.name),
        sourceImageName: file.name,
        sourceImageDataUrl,
        svgWidth: result.svgWidth,
        svgHeight: result.svgHeight,
        paths: result.paths,
        selectedPathId: result.selectedPathId,
        eraserStrokes: [],
        settings: { ...defaultDotSettings, numberOfDots: 35, originalImageMode: "full", originalImageOpacity: 1, keepOutlineVisible: false }
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

  async function applyOutlineCleanup() {
    const file = sourceFile ?? await fileFromProject(project);
    if (!file) {
      setError("Upload the original image again before applying outline cleanup.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await vectorizeFile(file, options);
      setWarnings(result.warnings);
      setProject((current) => {
        const path = result.paths.find((candidate) => candidate.id === result.selectedPathId) ?? result.paths[0];
        return {
          ...current,
          svgWidth: result.svgWidth,
          svgHeight: result.svgHeight,
          paths: result.paths,
          selectedPathId: result.selectedPathId,
          dots: path ? generateDotsForPath(path, current.settings) : []
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply outline cleanup.");
    } finally {
      setBusy(false);
    }
  }

  function selectPath(pathId: string) {
    const path = project.paths.find((candidate) => candidate.id === pathId);
    if (!path) return;
    setProject((current) => ({
      ...current,
      selectedPathId: pathId,
      dots: generateDotsForPath(path, current.settings)
    }));
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
      dots: [...current.dots].reverse().map((dot, i) => ({ ...dot, id: `dot-${i + 1}`, index: current.settings.startIndex + i })),
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
    if (erasingStrokeId) {
      const point = pointFromEvent(event);
      if (!point) return;
      setProject((current) => ({
        ...current,
        eraserStrokes: current.eraserStrokes.map((stroke) => {
          if (stroke.id !== erasingStrokeId) return stroke;
          const last = stroke.points.at(-1);
          if (last && Math.hypot(last.x - point.x, last.y - point.y) < 3) return stroke;
          return { ...stroke, points: [...stroke.points, point] };
        })
      }));
      return;
    }
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

  function handleEditorPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (editorMode === "erase") {
      event.preventDefault();
      const point = pointFromEvent(event);
      if (!point || !project.sourceImageDataUrl || originalImageMode === "none") return;
      const id = `erase-${Date.now()}`;
      event.currentTarget.setPointerCapture(event.pointerId);
      setErasingStrokeId(id);
      setProject((current) => ({
        ...current,
        eraserStrokes: [...current.eraserStrokes, { id, radius: current.settings.eraserRadius, points: [point] }]
      }));
      return;
    }
    const tag = (event.target as Element).tagName.toLowerCase();
    if (event.target !== editorRef.current && tag !== "rect") return;
    const point = pointFromEvent(event);
    if (!point) return;
    setProject((current) => ({
      ...current,
      dots: reorder([...current.dots, { id: "new", index: 0, x: point.x, y: point.y, labelX: point.x + 14, labelY: point.y - 14 }], current.settings.startIndex)
    }));
  }

  function undoErase() {
    setProject((current) => ({ ...current, eraserStrokes: current.eraserStrokes.slice(0, -1) }));
  }

  function clearErase() {
    setProject((current) => ({ ...current, eraserStrokes: [] }));
  }

  function loadProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text()
      .then((text) => setProject(createDefaultProject(deserializeProject(text) as Partial<DotProject>)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Invalid JSON project."));
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <h1>ConnectDot</h1>
          <p>Turn a simple image into a printable connect-the-dots worksheet with big, clear numbers for young kids.</p>
        </div>
        <div className="row">
          <button className="button secondary" onClick={() => downloadText("connectdot-project.json", serializeProject(project), "application/json")}>Save JSON</button>
          <label className="button secondary">Load JSON<input hidden type="file" accept="application/json" onChange={loadProject} /></label>
        </div>
      </section>

      <div className="grid">
        <aside className="panel stack">
          <div className="drop">
            <strong>1. Choose a picture</strong>
            <p className="small">Best with simple animals, toys, shapes, or coloring-page art. PNG, JPG, WebP, or SVG up to 10 MB.</p>
            <input data-testid="image-upload" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
          </div>
          {filePreview && <img className="filePreview" src={filePreview} alt="Original upload preview" />}
          {error && <div className="error">{error}</div>}
          {warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}

          <Controls
            options={options}
            setOptions={setOptions}
            project={project}
            setProject={setProject}
            updateSetting={updateSetting}
            selectPath={selectPath}
            editorMode={editorMode}
            setEditorMode={setEditorMode}
            undoErase={undoErase}
            clearErase={clearErase}
            applyOutlineCleanup={applyOutlineCleanup}
            busy={busy}
          />
          <div className="row">
            <button className="button" disabled={busy || !selectedPath} onClick={generateDots}>{busy ? "Making worksheet..." : "Update dots"}</button>
            <button className="button secondary" onClick={resetLabels}>Reset labels</button>
            <button className="button secondary" onClick={reverseDots}>Reverse order</button>
            <button className="button danger" disabled={!selectedDotId} onClick={deleteSelected}>Delete selected</button>
          </div>
          <div className="row">
            <button className="button" onClick={() => downloadText("connectdot-worksheet.svg", worksheet, "image/svg+xml")}>Export SVG</button>
            <button className="button secondary" onClick={() => void downloadWorksheetPng(project)}>Export PNG</button>
            <button className="button secondary" onClick={() => printWorksheetPdf(project)}>Export PDF</button>
          </div>
          <p className="small">Tip: use fewer dots for younger kids, then drag any number or dot that needs a cleaner spot before printing.</p>
        </aside>

        <section className="panel stack">
          <div className="tabs"><span className="tab active">2. Edit dots</span><span className="tab">3. Print preview below</span></div>
          <svg
            ref={editorRef}
            data-testid="dot-editor"
            className="editorSvg"
            viewBox={`0 0 ${project.svgWidth} ${project.svgHeight}`}
            onPointerMove={onPointerMove}
            onPointerUp={() => { setDragging(null); setErasingStrokeId(null); }}
            onPointerLeave={() => { setDragging(null); setErasingStrokeId(null); }}
            onPointerDown={handleEditorPointerDown}
          >
            <rect width={project.svgWidth} height={project.svgHeight} fill="#fff" />
            {project.sourceImageDataUrl && originalImageMode !== "none" && (
              <>
                <defs>
                  <mask id={sourceMaskId} maskUnits="userSpaceOnUse">
                    <rect width={project.svgWidth} height={project.svgHeight} fill="#fff" />
                    {project.eraserStrokes.map((stroke) => <path key={stroke.id} d={eraserStrokePath(stroke)} fill="none" stroke="#000" strokeWidth={stroke.radius * 2} strokeLinecap="round" strokeLinejoin="round" />)}
                  </mask>
                </defs>
                {selectedPath && originalImageMode === "inside-outline" && (
                  <defs>
                    <clipPath id={sourceClipId}>
                      <path d={selectedPath.d} />
                    </clipPath>
                  </defs>
                )}
                <image
                  href={project.sourceImageDataUrl}
                  width={project.svgWidth}
                  height={project.svgHeight}
                  preserveAspectRatio="none"
                  opacity={project.settings.originalImageOpacity}
                  clipPath={selectedPath && originalImageMode === "inside-outline" ? `url(#${sourceClipId})` : undefined}
                  mask={project.eraserStrokes.length > 0 ? `url(#${sourceMaskId})` : undefined}
                  pointerEvents="none"
                />
              </>
            )}
            {selectedPath && project.settings.keepOutlineVisible && <path d={selectedPath.d} fill="none" stroke="#94a3b8" strokeWidth={2} />}
            {project.settings.showConnectionHelperLine && <polyline points={project.dots.map((dot) => `${dot.x},${dot.y}`).join(" ")} fill="none" stroke="#cbd5e1" strokeDasharray="5 6" />}
            {project.dots.map((dot) => (
              <g key={dot.id}>
                <circle className={`dot ${selectedDotId === dot.id ? "selected" : ""}`} cx={dot.x} cy={dot.y} r={project.settings.dotRadius + 2} fill="#111827" onPointerDown={(event) => { event.stopPropagation(); setSelectedDotId(dot.id); setDragging({ kind: "dot", id: dot.id }); }} />
                <text className="labelText" x={dot.labelX} y={dot.labelY} fontSize={project.settings.labelFontSize} fill={dot.labelWarning ? "#ea580c" : "#111827"} stroke="#fff" strokeWidth={3} paintOrder="stroke" onPointerDown={(event) => { event.stopPropagation(); setSelectedDotId(dot.id); setDragging({ kind: "label", id: dot.id }); }}>{dot.index}</text>
              </g>
            ))}
          </svg>
          <div className="previewWrap"><div className="worksheet" data-testid="worksheet-preview" dangerouslySetInnerHTML={{ __html: worksheet }} /></div>
        </section>
      </div>
    </main>
  );
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  if (!base || /^[a-f0-9-]{24,}$/i.test(base)) return "Connect the dots";
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
}

async function fileFromProject(project: DotProject): Promise<File | null> {
  if (!project.sourceImageDataUrl) return null;
  const response = await fetch(project.sourceImageDataUrl);
  const blob = await response.blob();
  return new File([blob], project.sourceImageName ?? "source-image", { type: blob.type || "image/png" });
}

function getOriginalImageMode(project: DotProject): OriginalImageMode {
  if (project.settings.originalImageMode) return project.settings.originalImageMode;
  return project.settings.keepOriginalImageInside ? "inside-outline" : "none";
}

function eraserStrokePath(stroke: EraserStroke): string {
  return stroke.points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function Controls({ options, setOptions, project, setProject, updateSetting, selectPath, editorMode, setEditorMode, undoErase, clearErase, applyOutlineCleanup, busy }: {
  options: VectorizeOptions;
  setOptions: (options: VectorizeOptions) => void;
  project: DotProject;
  setProject: (project: DotProject) => void;
  updateSetting: <K extends keyof DotProject["settings"]>(key: K, value: DotProject["settings"][K]) => void;
  selectPath: (pathId: string) => void;
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
  undoErase: () => void;
  clearErase: () => void;
  applyOutlineCleanup: () => void;
  busy: boolean;
}) {
  return <div className="stack">
    <strong>2. Make it kid friendly</strong>
    {project.paths.length > 1 && <label className="label">Outline<select value={project.selectedPathId} onChange={(event) => selectPath(event.target.value)}>{project.paths.map((path) => <option key={path.id} value={path.id}>{path.label ?? path.id}</option>)}</select></label>}
    <label className="label">Title<input value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} /></label>
    <label className="label">Number of dots<input type="number" min="2" max="300" value={project.settings.numberOfDots} onChange={(event) => updateSetting("numberOfDots", Number(event.target.value))} /></label>
    <label className="label">Minimum distance<input type="number" min="0" value={project.settings.minimumDistance} onChange={(event) => updateSetting("minimumDistance", Number(event.target.value))} /></label>
    <label className="label">Dot radius<input type="number" min="1" value={project.settings.dotRadius} onChange={(event) => updateSetting("dotRadius", Number(event.target.value))} /></label>
    <label className="label">Label font size<input type="number" min="6" value={project.settings.labelFontSize} onChange={(event) => updateSetting("labelFontSize", Number(event.target.value))} /></label>
    <label className="label">Start index<input type="number" value={project.settings.startIndex} onChange={(event) => updateSetting("startIndex", Number(event.target.value))} /></label>
    <label className="label">Original image<select data-testid="original-image-mode" value={getOriginalImageMode(project)} disabled={!project.sourceImageDataUrl} onChange={(event) => {
      const mode = event.target.value as OriginalImageMode;
      setProject({ ...project, settings: { ...project.settings, originalImageMode: mode, keepOriginalImageInside: mode === "inside-outline" } });
    }}><option value="full">Full original drawing</option><option value="inside-outline">Inside selected outline</option><option value="none">Off</option></select></label>
    {getOriginalImageMode(project) !== "none" && <label className="label">Original image opacity {Math.round(project.settings.originalImageOpacity * 100)}%<input type="range" min="10" max="100" value={Math.round(project.settings.originalImageOpacity * 100)} onChange={(event) => updateSetting("originalImageOpacity", Number(event.target.value) / 100)} /></label>}
    <div className="segmented" aria-label="Editor mode">
      <button type="button" className={editorMode === "dots" ? "active" : ""} onClick={() => setEditorMode("dots")}>Dots</button>
      <button type="button" className={editorMode === "erase" ? "active" : ""} disabled={!project.sourceImageDataUrl || getOriginalImageMode(project) === "none"} onClick={() => setEditorMode("erase")}>Erase image</button>
    </div>
    {editorMode === "erase" && <label className="label">Eraser size {project.settings.eraserRadius}<input type="range" min="4" max="80" value={project.settings.eraserRadius} onChange={(event) => updateSetting("eraserRadius", Number(event.target.value))} /></label>}
    <div className="row">
      <button type="button" className="button secondary" disabled={project.eraserStrokes.length === 0} onClick={undoErase}>Undo last erase</button>
      <button type="button" className="button secondary" disabled={project.eraserStrokes.length === 0} onClick={clearErase}>Clear eraser</button>
    </div>
    <label className="row"><input type="checkbox" checked={project.settings.keepOutlineVisible} onChange={(event) => updateSetting("keepOutlineVisible", event.target.checked)} /> Keep outline visible</label>
    <label className="row"><input type="checkbox" checked={project.settings.showConnectionHelperLine} onChange={(event) => updateSetting("showConnectionHelperLine", event.target.checked)} /> Show helper line</label>
    <details className="advanced">
      <summary>Advanced outline cleanup</summary>
      <label className="label">Mode<select value={options.mode} onChange={(event) => setOptions({ ...options, mode: event.target.value as VectorizeOptions["mode"] })}><option value="threshold">Threshold</option><option value="canny">Edge detect</option><option value="svg">SVG input</option></select></label>
      <label className="label">Threshold {options.threshold}<input type="range" min="1" max="254" value={options.threshold} onChange={(event) => setOptions({ ...options, threshold: Number(event.target.value) })} /></label>
      <label className="label">Smoothing {options.blur}<input type="range" min="0" max="10" value={options.blur} onChange={(event) => setOptions({ ...options, blur: Number(event.target.value) })} /></label>
      <label className="label">Remove small details {options.removeSmallDetails}<input type="range" min="1" max="100" value={options.removeSmallDetails} onChange={(event) => setOptions({ ...options, removeSmallDetails: Number(event.target.value) })} /></label>
      <label className="label">Simplify outline {options.simplify}<input type="range" min="1" max="20" value={options.simplify} onChange={(event) => setOptions({ ...options, simplify: Number(event.target.value) })} /></label>
      <label className="row"><input type="checkbox" checked={options.invert} onChange={(event) => setOptions({ ...options, invert: event.target.checked })} /> Invert image</label>
      <button type="button" className="button" disabled={busy || !project.sourceImageDataUrl} onClick={applyOutlineCleanup}>{busy ? "Applying..." : "Apply cleanup"}</button>
    </details>
  </div>;
}
