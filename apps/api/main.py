from __future__ import annotations

import json
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="ConnectDot Vectorization API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VectorizeOptions(BaseModel):
    threshold: int = Field(150, ge=1, le=254)
    invert: bool = False
    blur: int = Field(1, ge=0, le=25)
    mode: Literal["threshold", "canny", "svg"] = "threshold"
    simplify: float = Field(2, ge=0.1, le=50)
    removeSmallDetails: float = Field(30, ge=0, le=10000)


def contour_to_path(contour: np.ndarray) -> str:
    points = contour.reshape(-1, 2)
    if len(points) < 2:
        return ""
    commands = [f"M{points[0][0]:.1f} {points[0][1]:.1f}"]
    commands.extend(f"L{x:.1f} {y:.1f}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


def odd_kernel_size(value: float) -> int:
    size = max(3, round(value))
    return size if size % 2 == 1 else size + 1


def outer_silhouette_contour(processed: np.ndarray, width: int, height: int) -> np.ndarray | None:
    bridge_size = odd_kernel_size(max(width, height) / 34)
    cleanup_size = odd_kernel_size(max(width, height) / 120)
    bridge_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bridge_size, bridge_size))
    cleanup_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cleanup_size, cleanup_size))
    silhouette = cv2.dilate(processed, bridge_kernel, iterations=1)
    silhouette = cv2.morphologyEx(silhouette, cv2.MORPH_CLOSE, bridge_kernel, iterations=2)
    silhouette = cv2.morphologyEx(silhouette, cv2.MORPH_OPEN, cleanup_kernel, iterations=1)
    contours, _ = cv2.findContours(silhouette, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < max(100, width * height * 0.01):
        return None
    return contour


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/vectorize")
async def vectorize(image: UploadFile = File(...), options: str = Form(...)) -> dict:
    try:
        parsed = VectorizeOptions.model_validate(json.loads(options))
    except Exception as exc:  # noqa: BLE001 - return a clear API error for malformed form data
        raise HTTPException(status_code=400, detail=f"Invalid options: {exc}") from exc

    if image.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=415, detail="FastAPI vectorization accepts PNG, JPG, JPEG, or WebP raster files.")

    content = await image.read()
    arr = np.frombuffer(content, np.uint8)
    decoded = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if decoded is None:
        raise HTTPException(status_code=400, detail="Could not decode uploaded image.")

    height, width = decoded.shape[:2]
    max_side = 1200
    scale = min(1.0, max_side / max(width, height))
    if scale < 1:
        decoded = cv2.resize(decoded, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        height, width = decoded.shape[:2]

    gray = cv2.cvtColor(decoded, cv2.COLOR_BGR2GRAY)
    if parsed.blur > 0:
        kernel = parsed.blur * 2 + 1
        gray = cv2.GaussianBlur(gray, (kernel, kernel), 0)

    if parsed.mode == "canny":
        processed = cv2.Canny(gray, max(1, parsed.threshold // 2), parsed.threshold)
    else:
        threshold_type = cv2.THRESH_BINARY_INV if not parsed.invert else cv2.THRESH_BINARY
        _, processed = cv2.threshold(gray, parsed.threshold, 255, threshold_type)

    outer_path = None
    warnings: list[str] = []
    outer = outer_silhouette_contour(processed, width, height)
    if outer is not None:
        epsilon = max(2.0, parsed.simplify / 700 * cv2.arcLength(outer, True))
        simplified_outer = cv2.approxPolyDP(outer, epsilon, True)
        d = contour_to_path(simplified_outer)
        if d:
            outer_path = {"id": "outer-silhouette", "d": d, "label": "Outer silhouette", "length": float(cv2.arcLength(simplified_outer, True))}

    contours, _ = cv2.findContours(processed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    min_area = max(1.0, parsed.removeSmallDetails)
    candidates = [c for c in contours if cv2.contourArea(c) >= min_area and cv2.arcLength(c, True) > 10]
    if not candidates:
        raise HTTPException(status_code=422, detail="No usable contour found. Try changing threshold, invert, or blur.")

    candidates.sort(key=lambda c: cv2.contourArea(c) + cv2.arcLength(c, True), reverse=True)
    paths = []
    for index, contour in enumerate(candidates[:8], start=1):
        epsilon = parsed.simplify / 1000 * cv2.arcLength(contour, True)
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        d = contour_to_path(simplified)
        if d:
            paths.append({"id": f"contour-{index}", "d": d, "label": f"Contour {index}", "length": float(cv2.arcLength(simplified, True))})

    if outer_path is not None:
        paths.append(outer_path)

    if not paths:
        raise HTTPException(status_code=422, detail="Contours were detected but could not be converted to paths.")
    if len(candidates) > len(paths):
        warnings.append(f"Kept the {len(paths)} largest contours and ignored smaller details.")

    return {"svgWidth": width, "svgHeight": height, "paths": paths, "selectedPathId": paths[0]["id"], "warnings": warnings}
