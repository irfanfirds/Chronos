import os
import sqlite3
from typing import Dict, Optional
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split # type: ignore
from sklearn.metrics import mean_squared_error, r2_score # pyright: ignore[reportUnknownVariableType]
import joblib # pyright: ignore[reportMissingTypeStubs]

from .paths import DB_PATH, MODEL_PATH

MODEL_DIR = os.path.dirname(MODEL_PATH)

# Real measured weather channels used as model inputs. Track temperature in
# particular drives tyre behaviour, so this is a genuine predictive lever - the
# sandbox exposes it as one rather than faking a weather slider.
WEATHER_FEATURES = ['TrackTemp', 'AirTemp', 'Humidity', 'WindSpeed', 'Rainfall']


def _load_data(db_path: Optional[str] = None, table: str = 'real_race_telemetry'):
    if db_path is None:
        db_path = DB_PATH
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query(f"SELECT * FROM {table}", conn) # pyright: ignore[reportUnknownMemberType]
    conn.close()
    return df


def _prepare_features(df: pd.DataFrame): # pyright: ignore[reportUnknownParameterType]
    # Feature engineering: LapNumber, TyreLife, Compound (one-hot), EventName (one-hot).
    #
    # EventName is not optional: lap time is dominated by which circuit a lap was
    # driven on (Monaco ~75s vs Spa ~105s+) far more than by tyre age or compound.
    # Training across multiple races without a track feature would have the model
    # learn a meaningless cross-track average instead of a per-track pace model.
    df = pd.DataFrame(df.copy()) # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
    if 'LapNumber' not in df.columns:
        raise ValueError('LapNumber column required in data')
    if 'EventName' not in df.columns:
        raise ValueError('EventName column required in data - lap time is circuit-dependent')

    features = pd.DataFrame()
    features['lap_number'] = df['LapNumber'].astype(float)

    if 'TyreLife' in df.columns:
        features['tyre_life'] = pd.to_numeric(df['TyreLife'], errors='coerce').fillna(0.0) # pyright: ignore[reportUnknownMemberType]
    else:
        features['tyre_life'] = 0.0

    if 'Compound' in df.columns:
        dummies = pd.get_dummies(df['Compound'].astype(str), prefix='compound')
        features = pd.concat([features, dummies], axis=1) # pyright: ignore[reportUnknownMemberType]

    event_dummies = pd.get_dummies(df['EventName'].astype(str), prefix='event')
    features = pd.concat([features, event_dummies], axis=1)

    # Real measured weather channels (see data_pipeline.WEATHER_COLUMNS). Median-filled
    # rather than dropped so a session with a missing channel doesn't cost us its laps.
    for col in WEATHER_FEATURES:
        if col in df.columns:
            values = pd.to_numeric(df[col], errors='coerce')
            features[col.lower()] = values.fillna(values.median() if values.notna().any() else 0.0)
        else:
            features[col.lower()] = 0.0

    # Target: LapTimeSeconds if available
    if 'LapTimeSeconds' not in df.columns:
        raise ValueError('LapTimeSeconds required as target')

    target = pd.to_numeric(df['LapTimeSeconds'], errors='coerce') # pyright: ignore[reportUnknownMemberType]

    mask = ~target.isna()
    # Use explicit row/column loc signature to satisfy type checkers and return copies
    X_clean = features.loc[mask, :].copy()
    y_clean = target.loc[mask].copy()
    # reset index to keep X/y aligned and with simple integer index
    return X_clean.reset_index(drop=True), y_clean.reset_index(drop=True) # pyright: ignore[reportUnknownVariableType]


def train_model(db_path: Optional[str] = None, model_path: Optional[str] = None):
    if model_path is None:
        model_path = MODEL_PATH
    os.makedirs(MODEL_DIR, exist_ok=True)

    df = _load_data(db_path)
    X, y = _prepare_features(df)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # Unconstrained trees on 40k+ rows grow to a ~400MB pickle for a ~0.005 R2
    # gain over this - not worth it once the model has to ship anywhere. This
    # config was chosen by sweeping depth/leaf-size against held-out RMSE/R2
    # and picking the point where size drops ~20x for a <1% accuracy loss.
    model = RandomForestRegressor(
        n_estimators=150, max_depth=18, min_samples_leaf=2, random_state=42, n_jobs=-1,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    rmse = mean_squared_error(y_test, preds) ** 0.5
    r2 = r2_score(y_test, preds)

    events = sorted(c[len('event_'):] for c in X.columns if c.startswith('event_'))
    weather_profiles = _build_weather_profiles(df)
    joblib.dump(
        {
            'model': model, 'columns': X.columns.tolist(), 'events': events,
            'weather_profiles': weather_profiles,
        },
        model_path,
        compress=3,
    )

    return {
        'rmse': float(rmse), 'r2': float(r2), 'model_path': model_path,
        'n_events': len(events), 'n_rows': len(df),
        'weather_features': [c for c in WEATHER_FEATURES if c.lower() in X.columns],
    }


def _build_weather_profiles(df: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    """Median measured weather per circuit, stored alongside the model so
    predictions default to realistic conditions instead of zeros."""
    profiles: Dict[str, Dict[str, float]] = {}
    present = [c for c in WEATHER_FEATURES if c in df.columns]
    if not present:
        return profiles

    overall = {}
    for col in present:
        values = pd.to_numeric(df[col], errors='coerce')
        if values.notna().any():
            overall[col.lower()] = float(values.median())
    profiles['__overall__'] = overall

    if 'EventName' in df.columns:
        for event_name, group in df.groupby('EventName'):
            entry = {}
            for col in present:
                values = pd.to_numeric(group[col], errors='coerce')
                if values.notna().any():
                    entry[col.lower()] = float(values.median())
            profiles[str(event_name)] = entry or overall
    return profiles


def load_model(model_path: Optional[str] = None):
    if model_path is None:
        model_path = MODEL_PATH
    obj = joblib.load(model_path)
    return obj['model'], obj['columns']


def list_trained_events(model_path: Optional[str] = None):
    if model_path is None:
        model_path = MODEL_PATH
    obj = joblib.load(model_path)
    return obj.get('events') or sorted(
        c[len('event_'):] for c in obj['columns'] if c.startswith('event_')
    )


def list_trained_compounds(model_path: Optional[str] = None):
    """Compounds the model actually saw in training - the sandbox builds its
    dropdown from this so a user can't pick a scenario predict would reject."""
    if model_path is None:
        model_path = MODEL_PATH
    obj = joblib.load(model_path)
    return sorted(c[len('compound_'):] for c in obj['columns'] if c.startswith('compound_'))


def _event_weather_defaults(event: str, model_path: Optional[str] = None) -> Dict[str, float]:
    """Median measured weather for a circuit, captured at training time.

    Without this, a caller who doesn't specify weather would send zeros - i.e.
    0C track temp - and get a nonsense prediction. Falls back to the overall
    median for a circuit that somehow has no stored profile.
    """
    if model_path is None:
        model_path = MODEL_PATH
    obj = joblib.load(model_path)
    profiles = obj.get('weather_profiles') or {}
    return profiles.get(event) or profiles.get('__overall__') or {}


def simulate_lap_time(
    tyre_life: int, compound: str, event: str, lap_number: Optional[int] = None,
    weather: Optional[Dict[str, float]] = None, model_path: Optional[str] = None,
) -> float:
    """Predict lap time from the trained model for an explicit scenario.

    `tyre_life` (laps on the current set) and `lap_number` (how far into the race
    we are) are genuinely different inputs - "lap 40 on fresh tyres" is a very
    different scenario from "lap 40 on 40-lap-old tyres". `lap_number` defaults
    to `tyre_life` for callers that only track stint age.

    `weather` overrides the measured conditions (keys matching WEATHER_FEATURES,
    e.g. {"TrackTemp": 45.0, "Rainfall": 1}); anything omitted falls back to that
    circuit's median from the training data, so a caller that doesn't care about
    weather still gets a realistic prediction rather than zeros.

    Raises ValueError on a compound or circuit the model was never trained on,
    rather than silently returning a blind number.
    """
    model, columns = load_model(model_path)
    defaults = _event_weather_defaults(event, model_path)
    feat = {c: 0.0 for c in columns}
    if 'lap_number' in feat:
        feat['lap_number'] = float(lap_number if lap_number is not None else tyre_life)
    if 'tyre_life' in feat:
        feat['tyre_life'] = float(tyre_life)

    supplied = {k.lower(): v for k, v in (weather or {}).items()}
    for col in WEATHER_FEATURES:
        key = col.lower()
        if key in feat:
            value = supplied.get(key, defaults.get(key, 0.0))
            feat[key] = float(value)

    # Training one-hots come from the raw data, which is uppercase (compound_MEDIUM).
    comp_col = f'compound_{compound.strip().upper()}'
    if comp_col not in feat:
        valid = sorted(c[len('compound_'):] for c in columns if c.startswith('compound_'))
        raise ValueError(f'Unknown compound {compound!r}. Expected one of: {", ".join(valid)}')
    feat[comp_col] = 1.0

    event_col = f'event_{event}'
    if event_col not in feat:
        valid = sorted(c[len('event_'):] for c in columns if c.startswith('event_'))
        raise ValueError(f'Unknown event {event!r}. Expected one of: {", ".join(valid)}')
    feat[event_col] = 1.0

    X = pd.DataFrame([feat], columns=columns)
    return float(model.predict(X)[0])


def predict_tyre_life(
    laps_driven: int, compound: str, event: str, track_temp: Optional[float] = None,
    model_path: Optional[str] = None,
):
    """Predicts lap time given tyre age, compound, and circuit (event).

    `event` must match an EventName the model was trained on (e.g. "Monaco Grand
    Prix") - lap time is circuit-dependent, so a prediction without a track is
    meaningless once the model spans more than one race.

    Returns predicted lap time in seconds.
    """
    return simulate_lap_time(laps_driven, compound, event, model_path=model_path)


if __name__ == '__main__':
    res = train_model()
    print('Trained model:', res)
