# Backend (api/main.py) container. The console (console/) is a separate static
# build and does not run in this image - see console/README.md.
FROM python:3.11-slim

WORKDIR /app

# System deps for scientific-Python wheels that occasionally need to compile.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

COPY src/ ./src/
COPY api/ ./api/

# Baked-in fallback copies of the data and model, so the image runs standalone
# even with no volume mounted. In production, mount a persistent disk at
# CHRONOS_DB_PATH/CHRONOS_MODEL_PATH's directory instead - see DEPLOY.md -
# otherwise engineer notes (written into the same SQLite file) are lost on
# every redeploy, since a container's own filesystem is ephemeral.
COPY data/ ./data/
COPY models/ ./models/

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
