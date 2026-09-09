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

`render.yaml` (at the repo root, one level above `chronos-ai/`) + `Dockerfile` are ready to go.
It targets Render's **free plan on purpose - no credit card required at signup**:

1. Push this repo to GitHub.
2. In the Render dashboard: **New > Blueprint**, point it at the repo. Render
   reads `render.yaml` and provisions a free web service (Docker runtime).
3. Set the two secrets Render will prompt for (marked `sync: false` in
   `render.yaml`, so they're not committed):
   - `GEMINI_API_KEY` - your key from https://aistudio.google.com/apikey
   - `CONSOLE_ORIGINS` - the console's deployed URL once you have it (step
     below) e.g. `https://chronos.vercel.app`. Leave it blank/localhost during
     initial testing and come back to it.
4. Deploy. The image already has `data/chronos.db` and `models/model.pkl`
   baked in, so the 37-race dataset and trained model are there immediately -
   nothing to upload.

**The free-plan tradeoff:** there's no persistent disk on this plan, so
`CHRONOS_DB_PATH`/`MODEL_PATH` are left unset in `render.yaml` and the app just
reads the image's baked-in copies. Those are fine - they're part of the image,
not the (ephemeral) container filesystem. What does *not* survive a
restart/redeploy: engineer notes added via the Decision page, and any
re-ingestion you run against the live container, since both write into that
same ephemeral filesystem. The free plan also sleeps after ~15 min idle, so
the first request after a quiet spell takes ~30-60s to wake up.

**Upgrading to persistent notes later:** bump `plan: free` to `plan: starter`,
add back a `disk:` block (`name`, `mountPath: /data`, `sizeGB: 1`), and set
`CHRONOS_DB_PATH=/data/chronos.db` / `CHRONOS_MODEL_PATH=/data/model.pkl` /
`CHRONOS_CACHE_DIR=/data/f1_cache` as env vars. `docker-entrypoint.sh` already
handles seeding a freshly-mounted empty disk from the image on first boot -
no other changes needed. This does require a paid plan (and therefore a card).

**Other hosts:** the `Dockerfile` is plain Docker, so Railway, Fly.io, a VPS,
or an Oracle Cloud Always Free VM all work the same way - the only
Render-specific piece is `render.yaml` itself.

**Ingesting more races post-deploy:** the on-demand `/api/circuit` fetch is
already live. To pull additional seasons, exec into the running container (or
run the same image locally against the same disk, if you're on a plan with
one) and run `python app.py ingest-season --years 2027`.

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
