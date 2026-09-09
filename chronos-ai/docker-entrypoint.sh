#!/bin/sh
# A freshly-provisioned persistent disk mounts empty - if CHRONOS_DB_PATH/
# CHRONOS_MODEL_PATH point onto it (as render.yaml sets them to do), the app
# would find nothing there on first boot even though the image has a baked-in
# copy at data/chronos.db and models/model.pkl. Seed the disk from the image
# once; on every later boot the disk already has the (possibly note-updated)
# files, so this is a no-op.
set -e

seed() {
  src="$1"
  dest="$2"
  if [ -n "$dest" ] && [ ! -f "$dest" ] && [ -f "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
    echo "Seeded $dest from image default ($src)"
  fi
}

seed "/app/data/chronos.db" "$CHRONOS_DB_PATH"
seed "/app/models/model.pkl" "$CHRONOS_MODEL_PATH"

exec "$@"
