import datetime
import os
import sqlite3
from typing import List, Optional

import numpy as np
import pandas as pd

try:
    import fastf1
except Exception:
    fastf1 = None

from .paths import CACHE_DIR, DB_PATH

TABLE = 'real_race_telemetry'
CIRCUIT_TABLE = 'circuit_telemetry'
APEX_TABLE = 'circuit_apexes'

# Columns FastF1 exposes at the lap level without a full telemetry-channel download.
# Everything here is real session data - no field is estimated or synthesized.
LAP_COLUMNS = [
    'Driver', 'DriverNumber', 'Team', 'LapNumber', 'Position', 'Stint',
    'Compound', 'TyreLife', 'FreshTyre', 'TrackStatus',
    'Time', 'LapTime', 'Sector1Time', 'Sector2Time', 'Sector3Time',
    'SpeedFL', 'SpeedST',
]
# 'Time' is FastF1's own cumulative session-elapsed-time at lap completion - the
# authoritative source for gap/interval math. Re-deriving it by summing LapTime
# ourselves would silently drift under safety cars, pit stops, and red flags.
TIMEDELTA_COLUMNS = ['Time', 'LapTime', 'Sector1Time', 'Sector2Time', 'Sector3Time']
STRING_COLUMNS = ['Driver', 'DriverNumber', 'Compound', 'TrackStatus', 'Team']
# Race identity columns, injected from session.event rather than the laps table -
# these are what let one table hold every track instead of just one.
EVENT_COLUMNS = ['Year', 'EventName', 'RoundNumber', 'Country', 'Location']
# Real weather channels FastF1 publishes (~1 sample/minute), joined onto each lap by
# nearest session time. These are genuine measurements, not modeled estimates.
WEATHER_COLUMNS = ['AirTemp', 'TrackTemp', 'Humidity', 'Pressure', 'WindSpeed', 'Rainfall']
# The real Pirelli compounds FastF1 reports. Anything else (missing/unset) is
# dropped rather than stored, so "nan" never becomes a modelled tyre compound.
VALID_COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET']


def ensure_dirs():
    base = os.path.dirname(DB_PATH)
    os.makedirs(base, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)


def _attach_weather(laps_df: pd.DataFrame, session) -> pd.DataFrame:
    """Join the nearest real weather reading onto each lap by session time.

    FastF1 samples weather roughly once a minute, so an exact join would miss;
    merge_asof takes the most recent sample at or before each lap's completion.
    If a session has no weather data the columns are added as NaN rather than
    failing the ingest - a missing channel shouldn't cost us the whole race.
    """
    weather = getattr(session, 'weather_data', None)
    if weather is None or weather.empty or 'Time' not in laps_df.columns:
        for col in WEATHER_COLUMNS:
            laps_df[col] = pd.NA
        return laps_df

    available = ['Time'] + [c for c in WEATHER_COLUMNS if c in weather.columns]
    merged = pd.merge_asof(
        laps_df.sort_values('Time'),
        weather[available].sort_values('Time'),
        on='Time',
        direction='backward',
    )
    if 'Rainfall' in merged.columns:
        merged['Rainfall'] = merged['Rainfall'].astype(float)
    return merged


def _require_fastf1():
    if fastf1 is None:
        raise RuntimeError("fastf1 is not installed or failed to import. Install via pip install fastf1")
    ensure_dirs()
    fastf1.Cache.enable_cache(CACHE_DIR)


def fetch_and_store_real_f1_data(
    year=2024, grand_prix="Silverstone", session_type="R", db_path=None, if_exists='replace',
):
    """Fetch one session and store its lap-level telemetry into SQLite.

    `if_exists='replace'` (the default, and the CLI's behavior) rebuilds the table
    from just this one race - use 'append' when adding a race to a table that
    already holds others (see fetch_and_store_season_range).
    """
    if db_path is None:
        db_path = DB_PATH

    _require_fastf1()

    print(f"Loading session: {year} {grand_prix} {session_type}...")
    session = fastf1.get_session(year, grand_prix, session_type)
    # Lap + weather channels only - skipping position/car telemetry and race-control
    # messages cuts load time substantially, which matters across dozens of races.
    session.load(telemetry=False, weather=True, messages=False)

    laps = session.laps
    if laps is None or laps.empty:
        raise RuntimeError("No lap data found for the session")

    keep = [c for c in LAP_COLUMNS if c in laps.columns]
    clean = laps[keep].copy()

    # Join the nearest weather sample to each lap before Time is converted to
    # seconds - merge_asof needs both sides sorted on the same timedelta key.
    clean = _attach_weather(clean, session)

    for col in TIMEDELTA_COLUMNS:
        if col in clean.columns:
            clean[f'{col}Seconds'] = clean[col].dt.total_seconds()
            clean.drop(columns=[col], inplace=True)

    clean = clean.dropna(subset=['LapTimeSeconds']).copy()

    # Drop laps with no recorded compound. astype(str) below would otherwise turn
    # NaN/None into the literal strings "nan"/"None", which then become junk
    # one-hot features in the model and junk options in the sandbox dropdown.
    if 'Compound' in clean.columns:
        clean = clean[clean['Compound'].isin(VALID_COMPOUNDS)].copy()

    for col in STRING_COLUMNS:
        if col in clean.columns:
            clean[col] = clean[col].astype(str)

    event_date = session.event['EventDate']
    clean['Year'] = event_date.year if hasattr(event_date, 'year') else int(year)
    clean['EventName'] = str(session.event['EventName'])
    clean['RoundNumber'] = int(session.event['RoundNumber'])
    clean['Country'] = str(session.event['Country'])
    clean['Location'] = str(session.event['Location'])

    conn = sqlite3.connect(db_path)
    try:
        clean.to_sql(TABLE, conn, if_exists=if_exists, index=False)
    finally:
        conn.close()

    print(f"Wrote {len(clean)} rows for {clean['Year'].iloc[0]} {clean['EventName'].iloc[0]} -> table {TABLE}")
    return len(clean)


def list_completed_events(years: List[int]) -> List[dict]:
    """Real F1 calendar events (fastf1.get_event_schedule) that have already happened."""
    _require_fastf1()
    today = datetime.datetime.now(datetime.timezone.utc)
    events = []
    for year in years:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        for _, row in schedule.iterrows():
            event_date = row['EventDate']
            if event_date.tzinfo is None:
                event_date = event_date.tz_localize('UTC')
            if event_date <= today:
                events.append({
                    'year': year,
                    'event_name': row['EventName'],
                    'round': int(row['RoundNumber']),
                    'event_date': event_date,
                })
    events.sort(key=lambda e: e['event_date'])
    return events


def fetch_and_store_season_range(years: List[int], session_type='R', db_path=None) -> dict:
    """Ingest every completed race in `years` into one table, keyed by (Year, EventName).

    Failures on individual races (session not yet available, no lap data, etc.) are
    logged and skipped rather than aborting the whole run - a 30+ race batch pull
    over a real network should not lose all progress because one round 404s.
    """
    if db_path is None:
        db_path = DB_PATH

    events = list_completed_events(years)
    succeeded, failed = [], []

    for i, event in enumerate(events):
        label = f"{event['year']} {event['event_name']}"
        try:
            rows = fetch_and_store_real_f1_data(
                year=event['year'], grand_prix=event['event_name'], session_type=session_type,
                db_path=db_path, if_exists='replace' if i == 0 else 'append',
            )
            succeeded.append({**event, 'rows': rows})
        except Exception as exc:
            print(f"SKIPPED {label}: {exc}")
            failed.append({**event, 'error': str(exc)})

    print(f"Season ingest complete: {len(succeeded)} succeeded, {len(failed)} failed/skipped.")
    return {'succeeded': succeeded, 'failed': failed}


def _find_local_minima(speed: np.ndarray, min_gap: int = 15) -> List[int]:
    """Corner apexes = local minima in the speed trace. No SciPy dependency -
    a simple windowed-minimum scan is enough for this many samples per lap."""
    minima = []
    n = len(speed)
    for i in range(min_gap, n - min_gap):
        window = speed[i - min_gap:i + min_gap + 1]
        if speed[i] == window.min() and (not minima or i - minima[-1] >= min_gap):
            minima.append(i)
    return minima


def fetch_circuit_telemetry(year: int, grand_prix: str, session_type='R', db_path=None) -> dict:
    """Real X/Y position + speed trace for the fastest lap of one race, plus
    detected corner apexes (local speed minima). Fetched on demand per race
    rather than for all 37+ events up front - full telemetry is much heavier
    than lap data, so this only runs for whichever race the UI is displaying.
    """
    if db_path is None:
        db_path = DB_PATH

    _require_fastf1()

    session = fastf1.get_session(year, grand_prix, session_type)
    session.load(telemetry=True, weather=False, messages=False)

    # Position data occasionally fails to load for a specific driver even when
    # session.load(telemetry=True) otherwise succeeds (a real, observed FastF1/
    # data-source gap, not a bug in this code). Try the next-fastest laps rather
    # than failing the whole circuit map because the single fastest lap's driver
    # happened to be one with a gap.
    candidates = session.laps.sort_values('LapTime').head(5)
    tel, fastest, errors = None, None, []
    for lap_row in candidates.itertuples():
        try:
            candidate_lap = session.laps.loc[lap_row.Index]
            candidate_tel = candidate_lap.get_telemetry()
            if candidate_tel is not None and not candidate_tel.empty:
                tel, fastest = candidate_tel, candidate_lap
                break
        except Exception as exc:
            errors.append(f"{lap_row.Driver}: {exc}")
    if tel is None or fastest is None:
        raise RuntimeError(
            f"No telemetry available for {year} {grand_prix} after trying "
            f"{len(candidates)} fastest laps: {'; '.join(errors) or 'no laps with lap times'}"
        )

    track = pd.DataFrame({
        'Year': year,
        'EventName': str(session.event['EventName']),
        'Distance': tel['Distance'].astype(float),
        'X': tel['X'].astype(float),
        'Y': tel['Y'].astype(float),
        'Speed': tel['Speed'].astype(float),
    })

    apex_idx = _find_local_minima(track['Speed'].to_numpy())
    apexes = track.iloc[apex_idx].copy()
    apexes.insert(0, 'ApexNumber', range(1, len(apexes) + 1))

    event_name = track['EventName'].iloc[0]
    conn = sqlite3.connect(db_path)
    try:
        existing_tables = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)",
                (CIRCUIT_TABLE, APEX_TABLE),
            )
        }
        if CIRCUIT_TABLE in existing_tables:
            conn.execute(f"DELETE FROM {CIRCUIT_TABLE} WHERE Year = ? AND EventName = ?", (year, event_name))
        if APEX_TABLE in existing_tables:
            conn.execute(f"DELETE FROM {APEX_TABLE} WHERE Year = ? AND EventName = ?", (year, event_name))
        track.to_sql(CIRCUIT_TABLE, conn, if_exists='append', index=False)
        apexes.to_sql(APEX_TABLE, conn, if_exists='append', index=False)
        conn.commit()
    finally:
        conn.close()

    print(f"Stored circuit map for {year} {grand_prix}: {len(track)} points, {len(apexes)} apexes")
    return {'points': len(track), 'apexes': len(apexes), 'fastest_driver': fastest['Driver']}


if __name__ == '__main__':
    fetch_and_store_real_f1_data()
