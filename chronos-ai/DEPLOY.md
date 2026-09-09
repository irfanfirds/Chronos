# Deploying Chronos

Two independent pieces to deploy: the **API** (`api/main.py` + `src/`, a real
Python process) and the **console** (`console/`, a static build). They can live
on completely different hosts as long as the console knows the API's URL.

## Before you deploy: what changed to make this possible

- `models/model.pkl` was **412MB** (unconstrained RandomForest trees + no
  compression) - too large for GitHub's 100MB file limit and most container
  platforms. Constraining tree depth (`max_depth=18, min_samples_leaf=2`) and
  enabling `joblib` compression brought it to **21MB** for a ~1% RMSE increase
  (3.14s vs 3.01s). Re-run `python app.py train` if you ever need to regenerate it.
- `DB_PATH`/`MODEL_PATH`/`CACHE_DIR` are now read from environment variables
  (`src/paths.py`), defaulting to the paths inside the repo. A deployment sets
  these to point at a mounted persistent disk instead - see below for why that
  matters.
- `requirements-api.txt` is a lean subset of `requirements.txt` for the
  container image - it drops `streamlit`, which is only used by the standalone
  `streamlit_app.py` demo and isn't part of the API's import graph.

## API: Render (the config in this repo targets it)

`render.yaml` (at the repo root, one level above `chronos-ai/`) + `Dockerfile` are ready to go:

1. Push this repo to GitHub.
2. In the Render dashboard: **New > Blueprint**, point it at the repo. Render
   reads `render.yaml` and provisions a web service + a 1GB persistent disk
   mounted at `/data`.
3. Set the two secrets Render will prompt for (marked `sync: false` in
   `render.yaml`, so they're not committed):
   - `GEMINI_API_KEY` - your key from https://aistudio.google.com/apikey
   - `CONSOLE_ORIGINS` - the console's deployed URL once you have it (step
     below) e.g. `https://chronos.vercel.app`. Leave it blank/localhost during
     initial testing and come back to it.
4. Deploy. First boot seeds the empty disk from the image's baked-in
   `data/chronos.db` and `models/model.pkl` (via `docker-entrypoint.sh`) - you
   don't need to upload anything manually.

**Why the persistent disk matters:** engineer notes (added via the Decision
page) are written into the same SQLite file the telemetry lives in. Most
container platforms wipe the filesystem on every redeploy - without a mounted
disk, your notes (and any re-ingested data) vanish the next time you push a
change. The disk is what makes them durable.

**Other hosts:** the `Dockerfile` is plain Docker, so Railway, Fly.io, or a
VPS all work the same way - the only Render-specific piece is `render.yaml`
itself. On any of them, set `CHRONOS_DB_PATH`/`CHRONOS_MODEL_PATH` to a path on
that platform's persistent volume equivalent, and re-run `docker-entrypoint.sh`'s
seed logic (already baked into the image's `ENTRYPOINT`).

**Ingesting more races post-deploy:** the on-demand `/api/circuit` fetch is
already live. To pull additional seasons, exec into the running container (or
run the same image locally against the same disk) and run
`python app.py ingest-season --years 2027`.

## Console: Vercel (or any static host)

The console is a **static Vite build with hash routing**
(`createHashRouter` - routes look like `/#/car`, not `/car`), so it needs zero
server-side rewrite rules. Any static host works.

1. In Vercel: **New Project**, import the repo, set **Root Directory** to
   `chronos-ai/console`. `console/vercel.json` supplies the build command and
   output directory.
2. Set the environment variable `VITE_API_BASE_URL` to your deployed API's URL
   (from the Render step above), e.g. `https://chronos-api.onrender.com`.
   This is a **build-time** variable (Vite inlines it), so redeploy after
   setting it.
3. Deploy. Then go back to the API host and set `CONSOLE_ORIGINS` to this
   Vercel URL so CORS allows it.

Netlify/Cloudflare Pages work the same way: build command `npm run build` in
`chronos-ai/console`, publish directory `dist`, same `VITE_API_BASE_URL` env var.

## Verifying a deployment

```bash
# API
curl https://your-api-host/api/health
curl https://your-api-host/api/events   # should list 37 races

# Console
# Open the deployed URL, confirm the race/driver selectors populate and the
# leaderboard shows real data. Check the browser console for CORS errors -
# that means CONSOLE_ORIGINS on the API doesn't match the console's origin.
```

## What's still local-only

- `streamlit_app.py` is a local demo entrypoint (`streamlit run streamlit_app.py`)
  and isn't part of either deployment target above.
- The Gemini free tier's daily quota is shared across whoever uses your
  deployed instance - a public deployment will exhaust it faster than solo
  local testing did.
