"""HTTP API for the Chronos console (console/).

Every endpoint here either returns data read straight from the ingested
telemetry table, or a value derived from it by a documented, non-fabricated
computation (see src/telemetry_analytics.py). The one exception -
/wear-index - returns an explicitly labeled estimate, never presented as
sensor data. This is the only layer that talks to the browser; the browser
never calls Gemini or SQLite directly.

The telemetry table spans many real races (2025 season + 2026 to date), so
every race-scoped endpoint takes optional `year`/`event` query params and
falls back to the most recently ingested race (analytics.latest_event())
when the caller doesn't specify one.
"""
import os
import sqlite3
from typing import List, Optional, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src import notes_store
from src import telemetry_analytics as analytics
from src.agent_engine import run_agent_query
from src.data_pipeline import fetch_circuit_telemetry
from src.ml_model import (
    list_trained_compounds, list_trained_events, predict_tyre_life, simulate_lap_time,
)

load_dotenv()

app = FastAPI(title="Chronos API", version="0.2.0")

# Vite picks the next free port if 3000 is taken, so pin dev origins by regex
# rather than an exact port list. Production deployments should set CONSOLE_ORIGINS
# to the real console URL instead of relying on this permissive local-dev default.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CONSOLE_ORIGINS', '').split(',') if os.environ.get('CONSOLE_ORIGINS') else [],
    allow_origin_regex=r'http://(localhost|127\.0\.0\.1):\d+',
    allow_methods=['GET', 'POST', 'DELETE'],
    allow_headers=['*'],
)


class ChatTurn(BaseModel):
    role: str
    text: str


class AgentQueryRequest(BaseModel):
    prompt: str
    # The race/driver currently selected in the console. Passing them means the
    # agent doesn't have to ask "which race?" on every question.
    year: Optional[int] = None
    event: Optional[str] = None
    driver_number: Optional[str] = None
    driver_code: Optional[str] = None
    # Prior turns, so the decision page's chat can follow up on itself.
    history: Optional[List[ChatTurn]] = None


class NoteRequest(BaseModel):
    body: str
    year: Optional[int] = None
    event: Optional[str] = None
    driver_number: Optional[str] = None
    lap: Optional[int] = None
    category: str = 'general'


class SimulationRequest(BaseModel):
    event: str
    compound: str
    tyre_life: int
    lap_number: Optional[int] = None
    stint_length: int = 10
    # Weather overrides; anything omitted falls back to that circuit's measured median.
    track_temp: Optional[float] = None
    air_temp: Optional[float] = None
    rainfall: Optional[float] = None


def _resolve_event(year: Optional[int], event: Optional[str]) -> Tuple[int, str]:
    if year is not None and event is not None:
        return year, event
    try:
        return analytics.latest_event()
    except sqlite3.OperationalError:
        raise HTTPException(status_code=503, detail='No telemetry ingested yet. Run: python app.py ingest')


@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.get('/api/events')
def events():
    """Every race actually ingested - powers the console's race selector."""
    return {'events': analytics.list_events()}


@app.get('/api/leaderboard')
def leaderboard(year: Optional[int] = None, event: Optional[str] = None, lap: Optional[int] = None):
    y, e = _resolve_event(year, event)
    return {
        'year': y, 'event': e,
        'lap': lap or analytics.latest_lap_number(y, e),
        'drivers': analytics.get_leaderboard(y, e, lap),
    }


@app.get('/api/degradation/{driver_number}')
def degradation(driver_number: str, year: Optional[int] = None, event: Optional[str] = None, horizon: int = 4):
    """Actual lap-time history plus a real model-projected continuation.

    The projection calls the trained RandomForestRegressor for the next
    `horizon` laps at the driver's current compound and circuit - it is a
    genuine model output, not a hand-drawn curve.
    """
    y, e = _resolve_event(year, event)
    actual = analytics.get_degradation_series(y, e, driver_number)
    if not actual:
        raise HTTPException(status_code=404, detail=f'No telemetry for driver {driver_number} in {y} {e}')

    last = actual[-1]
    projected = []
    for i in range(1, horizon + 1):
        laps_driven = int(last['tyre_life'] or 0) + i
        try:
            predicted_seconds = predict_tyre_life(laps_driven, last['compound'], e)
        except ValueError:
            break
        projected.append({
            'lap': last['lap'] + i,
            'lap_time_seconds': round(predicted_seconds, 3),
            'compound': last['compound'],
        })

    return {'year': y, 'event': e, 'driver_number': driver_number, 'actual': actual, 'projected': projected}


@app.get('/api/car-telemetry/{driver_number}')
def car_telemetry(driver_number: str, year: Optional[int] = None, event: Optional[str] = None, lap: Optional[int] = None):
    y, e = _resolve_event(year, event)
    try:
        return {'year': y, 'event': e, **analytics.get_car_telemetry(y, e, driver_number, lap)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get('/api/pace-delta')
def pace_delta(lap: int, drivers: str, year: Optional[int] = None, event: Optional[str] = None):
    y, e = _resolve_event(year, event)
    driver_numbers = [d.strip() for d in drivers.split(',') if d.strip()]
    return {'year': y, 'event': e, 'lap': lap, 'deltas': analytics.get_pace_delta(y, e, lap, driver_numbers)}


@app.get('/api/wear-index/{driver_number}')
def wear_index(driver_number: str, year: Optional[int] = None, event: Optional[str] = None, lap: Optional[int] = None):
    y, e = _resolve_event(year, event)
    board = analytics.get_leaderboard(y, e, lap)
    row = next((r for r in board if r['driver_number'] == driver_number), None)
    if row is None or row['tyre_life'] is None:
        raise HTTPException(status_code=404, detail=f'No telemetry for driver {driver_number} in {y} {e}')

    return {
        'year': y, 'event': e,
        'driver_number': driver_number,
        'compound': row['compound'],
        'tyre_life_laps': row['tyre_life'],
        'estimated_wear_pct': analytics.estimate_wear_index(row['tyre_life'], row['compound']),
        'is_estimated': True,
        'method': (
            'tyre age in laps vs. typical compound stint length - not sensor data; '
            'FastF1 / public F1 timing does not publish tyre wear or temperature'
        ),
    }


@app.get('/api/sectors')
def sectors(year: Optional[int] = None, event: Optional[str] = None, lap: Optional[int] = None):
    """Per-driver sector times at one lap, ranked - real position/performance-by-sector."""
    y, e = _resolve_event(year, event)
    return {'year': y, 'event': e, **analytics.get_sector_insights(y, e, lap)}


@app.get('/api/circuit')
def circuit(year: Optional[int] = None, event: Optional[str] = None):
    """Real X/Y track outline + detected corner apexes for the circuit map panel.

    Fetches and caches on first request for a given race (full position telemetry
    is much heavier than lap data, so it is never pulled for all 37+ races up front).
    """
    y, e = _resolve_event(year, event)
    result = analytics.get_circuit_map(y, e)
    if not result['available']:
        try:
            fetch_circuit_telemetry(y, e)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f'Could not fetch circuit telemetry for {y} {e}: {exc}')
        result = analytics.get_circuit_map(y, e)
    return {'year': y, 'event': e, **result}


@app.post('/api/agent/query')
def agent_query(body: AgentQueryRequest):
    try:
        return run_agent_query(
            body.prompt,
            year=body.year,
            event=body.event,
            driver_number=body.driver_number,
            driver_code=body.driver_code,
            history=[turn.model_dump() for turn in body.history] if body.history else None,
        )
    except RuntimeError as exc:
        message = str(exc)
        status_code = 429 if 'quota exceeded' in message else 503
        raise HTTPException(status_code=status_code, detail=message)


@app.post('/api/simulate')
def simulate(body: SimulationRequest):
    """What-if stint projection straight from the trained model.

    Returns a lap-by-lap prediction for `stint_length` laps starting at the given
    tyre age, so a strategist can see where the tyre falls off under a scenario
    that never actually happened. Every number is a real model output - there is
    no hand-tuned degradation curve behind this.
    """
    weather = {
        key: value
        for key, value in (
            ('TrackTemp', body.track_temp), ('AirTemp', body.air_temp), ('Rainfall', body.rainfall),
        )
        if value is not None
    }

    try:
        laps = []
        for offset in range(body.stint_length):
            tyre_life = body.tyre_life + offset
            lap_number = (body.lap_number + offset) if body.lap_number is not None else None
            seconds = simulate_lap_time(tyre_life, body.compound, body.event, lap_number, weather=weather)
            laps.append({
                'lap_number': lap_number,
                'tyre_life': tyre_life,
                'lap_time_seconds': round(seconds, 3),
            })
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    times = [lap['lap_time_seconds'] for lap in laps]
    return {
        'event': body.event,
        'compound': body.compound,
        'laps': laps,
        'total_seconds': round(sum(times), 3),
        'average_seconds': round(sum(times) / len(times), 3),
        'degradation_seconds': round(times[-1] - times[0], 3),
    }


@app.get('/api/laps/{driver_number}')
def laps(driver_number: str, year: Optional[int] = None, event: Optional[str] = None):
    """Full per-lap detail for one driver - backs the car page's lap browser."""
    y, e = _resolve_event(year, event)
    try:
        return {'year': y, 'event': e, 'driver_number': driver_number,
                'laps': analytics.get_lap_detail(y, e, driver_number)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get('/api/stints/{driver_number}')
def stints(driver_number: str, year: Optional[int] = None, event: Optional[str] = None):
    """Real stint breakdown: compound, lap range, best/average pace, drift."""
    y, e = _resolve_event(year, event)
    return {'year': y, 'event': e, 'driver_number': driver_number,
            'stints': analytics.get_stints(y, e, driver_number)}


@app.get('/api/notes')
def get_notes(year: Optional[int] = None, event: Optional[str] = None, driver_number: Optional[str] = None):
    return {'notes': notes_store.list_notes(year, event, driver_number)}


@app.post('/api/notes')
def post_note(body: NoteRequest):
    try:
        return notes_store.add_note(
            body=body.body, year=body.year, event_name=body.event,
            driver_number=body.driver_number, lap=body.lap, category=body.category,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete('/api/notes/{note_id}')
def remove_note(note_id: int):
    if not notes_store.delete_note(note_id):
        raise HTTPException(status_code=404, detail=f'No note with id {note_id}')
    return {'deleted': note_id}


@app.get('/api/simulate/options')
def simulate_options():
    """Circuits and compounds the model can actually simulate - the sandbox's
    dropdowns are built from this so a user can't pick an untrained scenario."""
    return {'events': list_trained_events(), 'compounds': list_trained_compounds()}
