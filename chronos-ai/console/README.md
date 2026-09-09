# Chronos Console

The pitwall dashboard frontend for [Chronos](../README.md) — React + Vite + Three.js,
talking to the FastAPI backend at `../api/main.py` over HTTP. No API key lives here; the
console never calls Gemini or SQLite directly.

## Run locally

Start the backend first (from `chronos-ai/`, one level up):

```bash
uvicorn api.main:app --reload --port 8000
```

Then, from this directory:

```bash
npm install
npm run dev
```

By default the console expects the API at `http://localhost:8000` — override with
`VITE_API_BASE_URL` (see `.env.example`) if you're running the backend elsewhere.
