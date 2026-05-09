export type EdgeMode = "threshold" | "canny" | "svg";

export type SvgPath = {
  id: string;
  d: string;
  label?: string;
  stroke?: string;
  fill?: string;
  length?: number;
};

export type VectorizeOptions = {
  threshold: number;
  invert: boolean;
  blur: number;
  mode: EdgeMode;
  simplify: number;
  removeSmallDetails: number;
};

export type VectorizeRequest = {
  image: File;
  options: VectorizeOptions;
};

export type VectorizeResponse = {
  svgWidth: number;
  svgHeight: number;
  paths: SvgPath[];
  selectedPathId: string;
  warnings: string[];
};

export type Dot = {
  id: string;
  index: number;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  locked?: boolean;
  labelWarning?: boolean;
};

export type OriginalImageMode = "none" | "inside-outline" | "full";

export type EraserStroke = {
  id: string;
  radius: number;
  points: Array<{ x: number; y: number }>;
};

export type DotSettings = {
  numberOfDots: number;
  minimumDistance: number;
  dotRadius: number;
  labelFontSize: number;
  startIndex: number;
  reverseOrder: boolean;
  keepOutlineVisible: boolean;
  showConnectionHelperLine: boolean;
  originalImageMode: OriginalImageMode;
  keepOriginalImageInside: boolean;
  originalImageOpacity: number;
  eraserRadius: number;
};

export type DotProject = {
  id: string;
  title: string;
  sourceImageName?: string;
  sourceImageDataUrl?: string;
  svgWidth: number;
  svgHeight: number;
  paths: SvgPath[];
  selectedPathId: string;
  dots: Dot[];
  eraserStrokes: EraserStroke[];
  settings: DotSettings;
};

export const defaultVectorizeOptions: VectorizeOptions = {
  threshold: 150,
  invert: false,
  blur: 1,
  mode: "threshold",
  simplify: 2,
  removeSmallDetails: 30
};

export const defaultDotSettings: DotSettings = {
  numberOfDots: 35,
  minimumDistance: 10,
  dotRadius: 3,
  labelFontSize: 12,
  startIndex: 1,
  reverseOrder: false,
  keepOutlineVisible: true,
  showConnectionHelperLine: false,
  originalImageMode: "none",
  keepOriginalImageInside: false,
  originalImageOpacity: 0.55,
  eraserRadius: 24
};

export const createDefaultProject = (input?: Partial<DotProject>): DotProject => {
  const settings = {
    ...defaultDotSettings,
    ...input?.settings,
    originalImageMode: input?.settings?.originalImageMode ?? (input?.settings?.keepOriginalImageInside ? "inside-outline" : defaultDotSettings.originalImageMode)
  };
  return {
    id: input?.id ?? `project-${Date.now()}`,
    title: input?.title ?? "Connect the dots",
    svgWidth: input?.svgWidth ?? 800,
    svgHeight: input?.svgHeight ?? 600,
    paths: input?.paths ?? [],
    selectedPathId: input?.selectedPathId ?? "",
    dots: input?.dots ?? [],
    eraserStrokes: input?.eraserStrokes ?? [],
    settings,
    sourceImageName: input?.sourceImageName,
    sourceImageDataUrl: input?.sourceImageDataUrl
  };
};
export { deserializeProject, distance, filterByMinimumDistance, generateDotsForPath, placeLabels, samplePath, serializeProject } from "./path";
