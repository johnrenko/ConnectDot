# ConnectDot MVP

ConnectDot turns an uploaded image into a printable **connect-the-dots / dot-to-dot worksheet**. The MVP is intentionally practical: it extracts a usable SVG path, generates numbered dots, lets you manually correct dot and label placement, and exports an A4 worksheet.

The interaction model is inspired by [`cuSTEMized/Connect-The-Dots-Generator`](https://github.com/cuSTEMized/Connect-The-Dots-Generator), which is MIT licensed. This project does not vendor that source; it implements its own modular TypeScript/Python pipeline while preserving the useful product idea of SVG path dots with draggable points and labels.

## Structure

```text
apps/web        Next.js + TypeScript frontend
apps/api        FastAPI + OpenCV vectorization service
packages/shared Shared types, path sampling, dot generation, label placement
```

## Setup

```bash
npm install
npm run build
npm run test
npm run dev
```

In another terminal, run the optional but recommended vectorization API:

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn main:app --reload --port 8000
```

If the API is not running, raster uploads use a browser fallback so the MVP remains usable. SVG uploads are handled fully in the browser.

## Implemented MVP features

- Upload PNG, JPG, JPEG, WebP, or SVG with type/size validation.
- Original image preview.
- Preprocessing controls: threshold, invert, blur, edge mode, small detail removal, simplify.
- FastAPI vectorization route using grayscale, blur, threshold/Canny, contour extraction, contour simplification, and SVG path conversion.
- SVG path extraction for SVG uploads.
- Dot generation from SVG path length with deterministic sampling.
- Basic automatic label placement with collision warnings.
- Manual SVG editor:
  - drag dots,
  - drag labels,
  - select/delete dots,
  - add dots by clicking the editor background,
  - reverse order,
  - reset labels,
  - toggle outline and helper connection line.
- A4 portrait worksheet preview with title, name field, instructions, border, dots, labels, optional outline, and optional helper line.
- Export SVG, PNG, and PDF/print dialog.
- Save/load project JSON in local browser files.
- Unit tests for path sampling, dot generation count, simple label collision avoidance, and serialization.

## Rough edges

- Browser fallback vectorization is deliberately simple and works best on high-contrast silhouettes.
- FastAPI vectorization selects the largest external contours; complex photos still need manual cleanup or future segmentation.
- PDF export uses the browser print dialog so users can save as PDF; a server-side PDF renderer would be more deterministic.
- Undo/redo state is not implemented yet, but editor state is centralized so it can be added.
- SVG input currently expects real `<path d="...">` elements; conversion from SVG shapes to paths can be improved.

## Recommended next improvements

1. Add undo/redo history for all dot and label edits.
2. Add path splitting/merging and multi-path dot sequencing.
3. Improve label placement with spatial indexing and edge-aware offsets.
4. Add Potrace/VTracer strategy adapters behind the FastAPI service.
5. Add a real PDF renderer such as Playwright/Puppeteer in a server export path.
6. Add example fixtures and visual regression tests for worksheet output.
