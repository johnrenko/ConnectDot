import { describe, expect, it } from "vitest";
import { defaultDotSettings, type DotProject, type SvgPath } from "./index";
import { deserializeProject, generateDotsForPath, placeLabels, samplePath, serializeProject } from "./path";

const square: SvgPath = { id: "square", d: "M0 0 L100 0 L100 100 L0 100 Z" };

describe("path sampling", () => {
  it("samples deterministic points along a path", () => {
    const points = samplePath(square.d, 5);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]?.x).toBeCloseTo(100);
    expect(points[1]?.y).toBeCloseTo(0);
  });
});

describe("dot generation", () => {
  it("generates the requested count when possible", () => {
    const dots = generateDotsForPath(square, { ...defaultDotSettings, numberOfDots: 20, minimumDistance: 1 });
    expect(dots).toHaveLength(20);
    expect(dots[0]?.index).toBe(1);
  });
});

describe("label placement", () => {
  it("avoids simple label collisions", () => {
    const dots = placeLabels([{ x: 0, y: 0 }, { x: 40, y: 0 }], 12, 3, 1);
    expect(dots.some((dot) => dot.labelWarning)).toBe(false);
    expect(dots[0]?.labelX).not.toBe(dots[1]?.labelX);
  });
});

describe("project serialization", () => {
  it("round trips project JSON", () => {
    const project: DotProject = {
      id: "p1",
      title: "Test",
      svgWidth: 100,
      svgHeight: 100,
      paths: [square],
      selectedPathId: "square",
      dots: [],
      settings: defaultDotSettings
    };
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});
