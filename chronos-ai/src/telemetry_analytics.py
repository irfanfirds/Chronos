"""Read-only analytics over the ingested telemetry table.

Every function here either returns a value taken directly from FastF1's published
lap data, or a value derived from it by simple arithmetic (cumulative time, deltas).
Nothing here estimates a quantity FastF1 doesn't publish - see WEAR_REFERENCE_LAPS
below and its docstring for the one place this module produces a labeled estimate.

The table spans many real races (2025 season + 2026 season to date), so every
function that reads lap data takes a (year, event_name) scope - there is no
"the" race anymore. `latest_event()` picks a sane default when the caller
doesn't have a specific race in mind yet.
"""
import os
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .paths import DB_PATH

TABLE = 'real_race_telemetry'
CIRCUIT_TABLE = 'circuit_telemetry'
APEX_TABLE = 'circuit_apexes'

# Typical usable stint length per compound, in laps, at a normal degradation track.
# This is a published motorsport rule-of-thumb, not measured sensor data - it is
# ONLY used to turn "tyre age in laps" (real) into an illustrative wear percentage
# for the UI. Every consumer of estimate_wear_index() must label its output as
# estimated, never as sensor telemetry.
WEAR_REFERENCE_LAPS = {
    'SOFT': 18.0,
    'MEDIUM': 28.0,
    'HARD': 40.0,
    'INTERMEDIATE': 25.0,
    'WET': 30.0,
}


def _connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or DB_PATH
    return sqlite3.connect(f'file:{os.path.abspath(path)}?mode=ro', uri=True)


def _load_race(year: int, event_name: str, db_path: Optional[str] = None) -> pd.DataFrame:
    conn = _connect(db_path)
    try:
        return pd.read_sql_query(
            f'SELECT * FROM {TABLE} WHERE Year = ? AND EventName = ?', conn, params=(year, event_name),
        )
    finally:
        conn.close()


def list_events(db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """Every race actually ingested, newest first - powers the UI's race selector."""
    conn = _connect(db_path)
    try:
        df = pd.read_sql_query(
            f"""SELECT Year, EventName, RoundNumber, Country, Location, MAX(LapNumber) as LatestLap
                FROM {TABLE} GROUP BY Year, EventName, RoundNumber, Country, Location
                ORDER BY Year DESC, RoundNumber DESC""",
            conn,
        )
    finally:
        conn.close()
    return [
        {
            'year': int(r.Year), 'event_name': r.EventName, 'round': int(r.RoundNumber),
            'country': r.Country, 'location': r.Location, 'latest_lap': int(r.LatestLap),
        }
        for r in df.itertuples()
    ]


def latest_event(db_path: Optional[str] = None) -> Tuple[int, str]:
    """Most recently run race in the ingested table - the default scope for API calls
    that don't specify one."""
    events = list_events(db_path)
    if not events:
        raise sqlite3.OperationalError('No races ingested yet')
    return events[0]['year'], events[0]['event_name']


def latest_lap_number(year: int, event_name: str, db_path: Optional[str] = None) -> int:
    df = _load_race(year, event_name, db_path)
    return int(df['LapNumber'].max())


def get_leaderboard(
    year: int, event_name: str, lap: Optional[int] = None, db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Real standings as of `lap` (defaults to the latest ingested lap) for one race.

    Position and gap-to-leader both come from FastF1's own `Time` field - the
    session-elapsed time at which each driver completed the lap - rather than a
    hand-rolled sum of lap times, which would drift under safety cars and pit stops.
    """
    df = _load_race(year, event_name, db_path)
    if df.empty:
        return []
    if lap is None:
        lap = int(df['LapNumber'].max())

    at_lap = df[df['LapNumber'] == lap].dropna(subset=['TimeSeconds'])
    if at_lap.empty:
        return []
    leader_time = at_lap['TimeSeconds'].min()

    rows = []
    for row in at_lap.itertuples():
        rows.append({
            'driver_number': row.DriverNumber,
            'driver': row.Driver,
            'team': row.Team,
            'position': int(row.Position) if pd.notna(row.Position) else None,
            'compound': row.Compound,
            'tyre_life': float(row.TyreLife) if pd.notna(row.TyreLife) else None,
            'lap_time_seconds': float(row.LapTimeSeconds) if pd.notna(row.LapTimeSeconds) else None,
            'gap_to_leader_seconds': round(float(row.TimeSeconds - leader_time), 3),
        })

    rows.sort(key=lambda r: (r['position'] is None, r['position']))
    return rows


def get_degradation_series(
    year: int, event_name: str, driver_number: str, db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Actual (lap, lap_time, compound) history for one driver in one race - no modeling."""
    df = _load_race(year, event_name, db_path)
    driver_df = df[df['DriverNumber'] == str(driver_number)].sort_values('LapNumber')
    return [
        {
            'lap': int(r.LapNumber),
            'lap_time_seconds': float(r.LapTimeSeconds),
            'compound': r.Compound,
            'tyre_life': float(r.TyreLife) if pd.notna(r.TyreLife) else None,
        }
        for r in driver_df.itertuples()
    ]


def get_pace_delta(
    year: int, event_name: str, lap: int, driver_numbers: List[str], db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Real lap-time deltas between drivers at a given lap (fastest of the group = baseline)."""
    df = _load_race(year, event_name, db_path)
    at_lap = df[(df['LapNumber'] == lap) & (df['DriverNumber'].isin(driver_numbers))]
    if at_lap.empty:
        return []
    fastest = at_lap['LapTimeSeconds'].min()
    return [
        {
            'driver_number': r.DriverNumber,
            'driver': r.Driver,
            'lap_time_seconds': float(r.LapTimeSeconds),
            'delta_seconds': round(float(r.LapTimeSeconds - fastest), 3),
        }
        for r in at_lap.itertuples()
    ]


def get_car_telemetry(
    year: int, event_name: str, driver_number: str, lap: Optional[int] = None, db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Real per-lap sector times and speed-trap readings for one driver.

    FastF1 does not publish tyre temperature, carcass wear, or ERS/brake-bias data
    at the lap level - those are proprietary team telemetry. Sector times and speed
    traps ARE real published fields, and are what this backs the car-telemetry
    panel with instead.
    """
    df = _load_race(year, event_name, db_path)
    driver_df = df[df['DriverNumber'] == str(driver_number)]
    if driver_df.empty:
        raise LookupError(f'No telemetry for driver {driver_number} in {year} {event_name}')
    if lap is None:
        lap = int(driver_df['LapNumber'].max())
    row = driver_df[driver_df['LapNumber'] == lap]
    if row.empty:
        raise LookupError(f'No telemetry for driver {driver_number} at lap {lap}')
    r = row.iloc[0]
    return {
        'lap': lap,
        'sector_1_seconds': float(r['Sector1TimeSeconds']) if pd.notna(r['Sector1TimeSeconds']) else None,
        'sector_2_seconds': float(r['Sector2TimeSeconds']) if pd.notna(r['Sector2TimeSeconds']) else None,
        'sector_3_seconds': float(r['Sector3TimeSeconds']) if pd.notna(r['Sector3TimeSeconds']) else None,
        'speed_finish_line_kph': float(r['SpeedFL']) if pd.notna(r['SpeedFL']) else None,
        'speed_trap_kph': float(r['SpeedST']) if pd.notna(r['SpeedST']) else None,
    }


def get_sector_insights(
    year: int, event_name: str, lap: Optional[int] = None, db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Real per-driver sector times at one lap, ranked to show who is fastest where.

    Every number here is a directly ingested FastF1 field (Sector1/2/3TimeSeconds) -
    this is position/performance-by-sector, not a fabricated split.
    """
    df = _load_race(year, event_name, db_path)
    if df.empty:
        return {'lap': lap, 'drivers': []}
    if lap is None:
        lap = int(df['LapNumber'].max())

    at_lap = df[df['LapNumber'] == lap]
    sector_cols = ['Sector1TimeSeconds', 'Sector2TimeSeconds', 'Sector3TimeSeconds']
    best = {col: at_lap[col].min() for col in sector_cols if at_lap[col].notna().any()}

    drivers = []
    for r in at_lap.itertuples():
        sectors = {}
        for i, col in enumerate(sector_cols, start=1):
            value = getattr(r, col)
            if pd.isna(value):
                sectors[f'sector_{i}'] = None
                continue
            sectors[f'sector_{i}'] = {
                'seconds': round(float(value), 3),
                'is_fastest': col in best and float(value) == float(best[col]),
            }
        drivers.append({
            'driver_number': r.DriverNumber, 'driver': r.Driver, 'position': int(r.Position) if pd.notna(r.Position) else None,
            **sectors,
        })

    drivers.sort(key=lambda d: (d['position'] is None, d['position']))
    return {'lap': lap, 'drivers': drivers}


def get_circuit_map(year: int, event_name: str, db_path: Optional[str] = None) -> Dict[str, Any]:
    """Real X/Y track outline + detected corner apexes, if fetch_circuit_telemetry
    has been run for this race (it's fetched on demand, not for every ingested race -
    see data_pipeline.fetch_circuit_telemetry)."""
    conn = _connect(db_path)
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if CIRCUIT_TABLE not in tables:
            return {'available': False, 'points': [], 'apexes': []}
        track = pd.read_sql_query(
            f'SELECT Distance, X, Y, Speed FROM {CIRCUIT_TABLE} WHERE Year = ? AND EventName = ? ORDER BY Distance',
            conn, params=(year, event_name),
        )
        apexes = pd.read_sql_query(
            f'SELECT ApexNumber, Distance, X, Y, Speed FROM {APEX_TABLE} WHERE Year = ? AND EventName = ? ORDER BY ApexNumber',
            conn, params=(year, event_name),
        ) if APEX_TABLE in tables else pd.DataFrame()
    finally:
        conn.close()

    if track.empty:
        return {'available': False, 'points': [], 'apexes': []}

    return {
        'available': True,
        'points': track.round(2).to_dict('records'),
        'apexes': apexes.round(2).to_dict('records') if not apexes.empty else [],
    }


def get_lap_detail(
    year: int, event_name: str, driver_number: str, db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Every recorded lap for one driver, with the full per-lap picture.

    Backs the car page's lap browser: pick any lap and see the tyre, stint,
    sector splits, speeds and measured conditions as they actually were.
    """
    df = _load_race(year, event_name, db_path)
    driver_df = df[df['DriverNumber'] == str(driver_number)].sort_values('LapNumber')
    if driver_df.empty:
        raise LookupError(f'No telemetry for driver {driver_number} in {year} {event_name}')

    def _num(value):
        return float(value) if pd.notna(value) else None

    laps = []
    for r in driver_df.itertuples():
        tyre_life = _num(r.TyreLife)
        compound = r.Compound
        laps.append({
            'lap': int(r.LapNumber),
            'position': int(r.Position) if pd.notna(r.Position) else None,
            'lap_time_seconds': _num(r.LapTimeSeconds),
            'compound': compound,
            'tyre_life': tyre_life,
            'stint': _num(r.Stint),
            'fresh_tyre': bool(r.FreshTyre) if pd.notna(r.FreshTyre) else None,
            'track_status': r.TrackStatus,
            'sector_1_seconds': _num(r.Sector1TimeSeconds),
            'sector_2_seconds': _num(r.Sector2TimeSeconds),
            'sector_3_seconds': _num(r.Sector3TimeSeconds),
            'speed_trap_kph': _num(r.SpeedST),
            'speed_finish_line_kph': _num(r.SpeedFL),
            'track_temp': _num(getattr(r, 'TrackTemp', None)),
            'air_temp': _num(getattr(r, 'AirTemp', None)),
            'humidity': _num(getattr(r, 'Humidity', None)),
            'wind_speed': _num(getattr(r, 'WindSpeed', None)),
            'rainfall': _num(getattr(r, 'Rainfall', None)),
            'estimated_wear_pct': (
                estimate_wear_index(tyre_life, compound) if tyre_life is not None else None
            ),
        })
    return laps


def get_stints(
    year: int, event_name: str, driver_number: str, db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Real stint breakdown for one driver: compound, lap range, and pace.

    Stint numbers come straight from FastF1; everything else is arithmetic over
    the laps actually recorded in that stint.
    """
    df = _load_race(year, event_name, db_path)
    driver_df = df[df['DriverNumber'] == str(driver_number)].sort_values('LapNumber')
    if driver_df.empty:
        return []

    stints = []
    for stint_number, group in driver_df.groupby('Stint'):
        times = group['LapTimeSeconds'].dropna()
        if times.empty:
            continue
        first, last = group.iloc[0], group.iloc[-1]
        stints.append({
            'stint': int(stint_number) if pd.notna(stint_number) else None,
            'compound': first['Compound'],
            'start_lap': int(first['LapNumber']),
            'end_lap': int(last['LapNumber']),
            'laps': int(len(group)),
            'best_lap_seconds': round(float(times.min()), 3),
            'average_lap_seconds': round(float(times.mean()), 3),
            # Pace drift across the stint: mean of the last 3 laps minus the first 3.
            # Positive means the car slowed as the set aged.
            'pace_drift_seconds': (
                round(float(times.tail(3).mean() - times.head(3).mean()), 3) if len(times) >= 6 else None
            ),
        })
    stints.sort(key=lambda s: s['start_lap'])
    return stints


def estimate_wear_index(tyre_life: float, compound: str) -> float:
    """Illustrative wear percentage from tyre age vs. typical compound stint length.

    THIS IS NOT SENSOR DATA. FastF1 (and public F1 timing feeds generally) does not
    publish tyre wear, carcass condition, or tyre temperature - that is proprietary
    team telemetry. This function exists so the UI has a real-number-backed (tyre
    age is real) illustrative gauge instead of a fabricated one; every caller must
    label it "estimated" in the UI, never "sensor" or "live telemetry".
    """
    reference = WEAR_REFERENCE_LAPS.get((compound or '').upper(), 30.0)
    return round(min(100.0, 100.0 * tyre_life / reference), 1)
