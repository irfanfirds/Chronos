"""Engineer notes, persisted in SQLite alongside the telemetry.

Kept server-side rather than in browser storage so a note written on the pitwall
is still there from another machine, and so the agent could be given access to
them later. This is the only part of Chronos that writes user-authored data -
everything else in the database is ingested race telemetry.
"""
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .paths import DB_PATH

NOTES_TABLE = 'engineer_notes'


def _connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Read-write connection - the notes table is the one thing users mutate."""
    return sqlite3.connect(db_path or DB_PATH)


def ensure_schema(db_path: Optional[str] = None) -> None:
    conn = _connect(db_path)
    try:
        conn.execute(
            f"""CREATE TABLE IF NOT EXISTS {NOTES_TABLE} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER,
                event_name TEXT,
                driver_number TEXT,
                lap INTEGER,
                category TEXT,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        conn.commit()
    finally:
        conn.close()


def list_notes(
    year: Optional[int] = None, event_name: Optional[str] = None,
    driver_number: Optional[str] = None, db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    ensure_schema(db_path)
    clauses, params = [], []
    if year is not None:
        clauses.append('year = ?')
        params.append(year)
    if event_name:
        clauses.append('event_name = ?')
        params.append(event_name)
    if driver_number:
        clauses.append('driver_number = ?')
        params.append(driver_number)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ''

    conn = _connect(db_path)
    try:
        rows = conn.execute(
            f'SELECT id, year, event_name, driver_number, lap, category, body, created_at '
            f'FROM {NOTES_TABLE} {where} ORDER BY created_at DESC',
            params,
        ).fetchall()
    finally:
        conn.close()

    keys = ['id', 'year', 'event_name', 'driver_number', 'lap', 'category', 'body', 'created_at']
    return [dict(zip(keys, row)) for row in rows]


def add_note(
    body: str, year: Optional[int] = None, event_name: Optional[str] = None,
    driver_number: Optional[str] = None, lap: Optional[int] = None,
    category: str = 'general', db_path: Optional[str] = None,
) -> Dict[str, Any]:
    if not body or not body.strip():
        raise ValueError('Note body cannot be empty')

    ensure_schema(db_path)
    created_at = datetime.now(timezone.utc).isoformat()
    conn = _connect(db_path)
    try:
        cur = conn.execute(
            f'INSERT INTO {NOTES_TABLE} (year, event_name, driver_number, lap, category, body, created_at) '
            f'VALUES (?, ?, ?, ?, ?, ?, ?)',
            (year, event_name, driver_number, lap, category, body.strip(), created_at),
        )
        conn.commit()
        note_id = cur.lastrowid
    finally:
        conn.close()

    return {
        'id': note_id, 'year': year, 'event_name': event_name, 'driver_number': driver_number,
        'lap': lap, 'category': category, 'body': body.strip(), 'created_at': created_at,
    }


def delete_note(note_id: int, db_path: Optional[str] = None) -> bool:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        cur = conn.execute(f'DELETE FROM {NOTES_TABLE} WHERE id = ?', (note_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()
