import json
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

from .ml_model import predict_tyre_life
from .paths import DB_PATH, MODEL_PATH

load_dotenv()

TABLE = 'real_race_telemetry'
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-flash-lite-latest')

SYSTEM_PROMPT = """You are a Formula 1 race strategist working the pitwall. You answer \
strategy questions using only the tools available to you.

The telemetry table spans many real races across the 2025 and 2026 seasons, not just
one - every row has a Year and EventName (e.g. "Monaco Grand Prix"). Rules:
- Query the telemetry database before making claims about what a driver has actually done.
- The console tells you which race and driver the strategist currently has selected (see
  the context block below, when present). Treat that as the subject of the question - do
  NOT ask which race or driver they mean, and do not re-derive it. Only depart from it if
  the prompt explicitly names a different race or driver, in which case the prompt wins.
- If there is no context block and the prompt doesn't say which race, run
  `SELECT DISTINCT Year, EventName, RoundNumber FROM real_race_telemetry ORDER BY Year DESC, RoundNumber DESC`
  to see what's ingested, then ask the user to confirm which race.
- The lap-time prediction tool requires a `event` argument matching an EventName the model
  was trained on - it is circuit-specific, so always pass the race the question is about.
- Tyre degradation, pit loss time, track layout, and overtaking opportunities vary
  significantly from track to track. Never carry a conclusion, a "typical" pit-loss figure,
  or a degradation trend from one circuit over to another - evaluate every claim against
  THIS race's own data. Infer pit stops from a driver's Stint number incrementing, and
  infer overtakes from lap-to-lap Position changes, rather than assuming generic values.
- Use the lap-time prediction tool rather than estimating degradation yourself.
- The Driver column holds three-letter codes (HAM, VER); DriverNumber holds car numbers ("44").
- If a question is missing something you need that the context block doesn't supply, say
  what is missing instead of guessing.
- This may be a multi-turn conversation - prior turns are included below the newest message.
  Do not treat something claimed in an earlier turn as still true without checking: if this
  question needs a lap time, tyre state, gap, or position and you have not already fetched
  that exact fact earlier in THIS conversation, query or predict it again rather than
  recalling it from memory. State changes lap to lap (a tyre ages, a gap closes); a fact
  fetched five turns ago about "the current lap" is not the same fact anymore.
- Close with a clear recommendation and the numbers that justify it."""


def _build_context_block(
    year: Optional[int], event: Optional[str], driver_number: Optional[str], driver_code: Optional[str],
) -> str:
    """The race/driver the strategist has selected in the console UI.

    Injecting this means the agent doesn't have to ask "which race?" or "which
    driver?" for every question - the selection in the UI *is* the answer.
    """
    lines = []
    if year is not None and event:
        lines.append(f'- Race: Year = {year}, EventName = "{event}"')
    if driver_number:
        who = f'{driver_number} ({driver_code})' if driver_code else driver_number
        lines.append(f'- Driver: DriverNumber = "{driver_number}"  [{who}]')
    if not lines:
        return ''
    return (
        '\n\nCURRENTLY SELECTED IN THE CONSOLE (the subject of the question unless the '
        'prompt says otherwise):\n' + '\n'.join(lines)
    )


class SQLTool:
    """Read-only SELECT access to the telemetry database."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        # Read-only URI: the model writes this SQL, so the engine must refuse mutations.
        return sqlite3.connect(f'file:{os.path.abspath(self.db_path)}?mode=ro', uri=True)

    def query(self, sql: str, params: tuple = ()) -> Dict[str, Any]:
        if not sql.lstrip().lower().startswith('select'):
            raise ValueError('Only SELECT statements are allowed')
        conn = self._connect()
        try:
            cur = conn.execute(sql, params)
            rows = cur.fetchall()
            cols = [c[0] for c in cur.description] if cur.description else []
            return {'rows': rows, 'cols': cols}
        finally:
            conn.close()

    def schema(self) -> str:
        conn = self._connect()
        try:
            cols = conn.execute(f'PRAGMA table_info({TABLE})').fetchall()
        finally:
            conn.close()
        return ', '.join(f'{c[1]} {c[2]}' for c in cols)


class PredictionTool:
    def __init__(self, model_path: str = MODEL_PATH):
        self.model_path = model_path

    def predict(self, laps_driven: int, compound: str, event: str) -> float:
        return predict_tyre_life(laps_driven, compound, event, model_path=self.model_path)


_sql_tool = SQLTool()
_pred_tool = PredictionTool()


def query_telemetry(sql: str) -> str:
    """Run a read-only SELECT against the race telemetry database and return the rows.

    Args:
        sql: A single SQLite SELECT statement against the real_race_telemetry table.
    """
    try:
        return json.dumps(_sql_tool.query(sql))
    except Exception as exc:
        return f'SQL error: {exc}'


def predict_lap_time(laps_driven: int, compound: str, event: str) -> str:
    """Predict lap time in seconds for a given tyre age, compound, and circuit.

    Args:
        laps_driven: Laps completed on the current set of tyres.
        compound: Tyre compound, e.g. SOFT, MEDIUM, HARD, INTERMEDIATE.
        event: The race/circuit, matching an EventName in the telemetry table
            exactly, e.g. "Monaco Grand Prix". Lap time is circuit-specific.
    """
    try:
        return f'{_pred_tool.predict(laps_driven, compound, event):.3f} seconds'
    except Exception as exc:
        return f'Prediction error: {exc}'


def _build_contents(prompt: str, history: Optional[List[Dict[str, str]]]):
    """Turn prior chat turns + the new prompt into the SDK's contents list.

    Only text is replayed - tool calls from earlier turns aren't re-sent, since
    the agent re-queries whatever it needs and stale tool results would just be
    misleading context.
    """
    if not history:
        return prompt

    contents = []
    for turn in history:
        text = (turn.get('text') or '').strip()
        if not text:
            continue
        role = 'model' if turn.get('role') == 'model' else 'user'
        contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
    contents.append(types.Content(role='user', parts=[types.Part(text=prompt)]))
    return contents


def _extract_tool_calls(history) -> list:
    """Pair each model function_call turn with the function_response that follows it.

    automatic_function_calling_history alternates: a 'model' turn with one or more
    function_call parts, then a 'user' turn with the matching function_response
    parts in the same order. Zipping them gives the input AND the result for each
    call, which the UI needs to render a real (not fabricated) execution trace.
    """
    tool_calls = []
    pending_calls = []
    for content in history:
        parts = content.parts or []
        if content.role == 'model':
            pending_calls = [p.function_call for p in parts if p.function_call]
        elif content.role == 'user' and pending_calls:
            responses = [p.function_response for p in parts if p.function_response]
            for call, resp in zip(pending_calls, responses):
                result = (resp.response or {}).get('result', resp.response)
                tool_calls.append({
                    'tool': call.name,
                    'input': dict(call.args or {}),
                    'result': result,
                })
            pending_calls = []
    return tool_calls


def run_agent_query(
    prompt: str,
    year: Optional[int] = None,
    event: Optional[str] = None,
    driver_number: Optional[str] = None,
    driver_code: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Answer a strategy question by letting Gemini drive the SQL and prediction tools.

    `year`/`event`/`driver_number` carry the console's current selection so the agent
    already knows what the question is about instead of having to ask.

    `history` is prior [{role: "user"|"model", text: ...}] turns, so the decision
    page's chat terminal can hold a real conversation ("what about on hards?")
    instead of every message starting from scratch.
    """
    api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        raise RuntimeError(
            'No Gemini credentials found. Set GEMINI_API_KEY in chronos-ai/.env '
            '(get a free key at https://aistudio.google.com/apikey)'
        )

    context_block = _build_context_block(year, event, driver_number, driver_code)
    contents = _build_contents(prompt, history)

    client = genai.Client(api_key=api_key)
    config = types.GenerateContentConfig(
        system_instruction=f'{SYSTEM_PROMPT}\n\nTable {TABLE} columns: {_sql_tool.schema()}{context_block}',
        tools=[query_telemetry, predict_lap_time],
        # SDK default is 10, which a thorough multi-compound comparison can exceed -
        # the loop then gets cut off mid-investigation with no narrated answer.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=24),
    )

    # Free-tier/lite models occasionally: (a) return a transient 503 under load, or
    # (b) end the turn on a dangling function call with no narrated summary (same
    # prompt can succeed on the very next sample). Retry through both.
    max_attempts = 3
    response = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL, contents=contents, config=config,
            )
        except errors.ServerError:
            if attempt == max_attempts:
                raise
            time.sleep(2 ** attempt)
            continue
        except errors.ClientError as exc:
            if exc.code == 429:
                raise RuntimeError(
                    f'Gemini free-tier quota exceeded for {GEMINI_MODEL}. '
                    'Wait for the quota to reset, or set GEMINI_MODEL to a different '
                    'model in chronos-ai/.env.'
                ) from exc
            raise

        if (response.text or '').strip():
            break

    tool_calls = _extract_tool_calls(response.automatic_function_calling_history or [])

    answer = response.text or ''
    if not answer.strip() and tool_calls:
        answer = (
            "Gemini gathered data but didn't narrate a final answer after "
            f'{max_attempts} attempts. Raw tool calls made: {json.dumps(tool_calls)}'
        )

    return {'prompt': prompt, 'tool_calls': tool_calls, 'answer': answer}


if __name__ == '__main__':
    import sys
    prompt = ' '.join(sys.argv[1:]) or 'Driver 44 is on Lap 18 with Mediums, should we pit now?'
    print(json.dumps(run_agent_query(prompt), indent=2))
