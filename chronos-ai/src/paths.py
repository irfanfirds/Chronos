"""Single source of truth for on-disk paths, overridable via environment
variables so a deployment can point them at a mounted persistent volume
instead of the source tree (where a container's own filesystem is usually
wiped on every redeploy).
"""
import os

_PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..")

DB_PATH = os.environ.get(
    'CHRONOS_DB_PATH', os.path.join(_PROJECT_ROOT, "data", "chronos.db")
)
MODEL_PATH = os.environ.get(
    'CHRONOS_MODEL_PATH', os.path.join(_PROJECT_ROOT, "models", "model.pkl")
)
CACHE_DIR = os.environ.get(
    'CHRONOS_CACHE_DIR', os.path.join(_PROJECT_ROOT, "f1_cache")
)
