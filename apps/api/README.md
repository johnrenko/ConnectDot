# ConnectDot API

FastAPI raster vectorization service used by the web app.

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn main:app --reload --port 8000
```

The web app proxies `/api/vectorize` to `http://127.0.0.1:8000/vectorize`.
