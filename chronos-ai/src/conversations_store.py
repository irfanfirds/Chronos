"""Agent conversation threads, persisted in SQLite alongside the telemetry.

Each conversation belongs to a (year, event, driver) scope and holds an ordered
list of turns as one JSON blob - simple over normalized, since a conversation
here is a handful of turns, not a chat product with millions of rows. This is
what lets a chat thread survive page navigation (React unmounts the Decision
page's own state on every route change) and a full reload, and lets a
strategist keep several named threads per driver instead of one that resets.
"""
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .paths import DB_PATH

CONVERSATIONS_TABLE = 'agent_conversations'


def _connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    return sqlite3.connect(db_path or DB_PATH)


def ensure_schema(db_path: Optional[str] = None) -> None:
    conn = _connect(db_path)
    try:
        conn.execute(
            f"""CREATE TABLE IF NOT EXISTS {CONVERSATIONS_TABLE} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER,
                event_name TEXT,
                driver_number TEXT,
                title TEXT NOT NULL,
                messages TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        conn.commit()
    finally:
        conn.close()


def _row_to_summary(row) -> Dict[str, Any]:
    conv_id, year, event_name, driver_number, title, messages_json, created_at, updated_at = row
    messages = json.loads(messages_json)
    return {
        'id': conv_id, 'year': year, 'event_name': event_name, 'driver_number': driver_number,
        'title': title, 'message_count': len(messages),
        'created_at': created_at, 'updated_at': updated_at,
    }


def list_conversations(
    year: Optional[int] = None, event_name: Optional[str] = None,
    driver_number: Optional[str] = None, db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Summaries only (no messages) for the sidebar list - sorted most-recent-first."""
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
            f'SELECT id, year, event_name, driver_number, title, messages, created_at, updated_at '
            f'FROM {CONVERSATIONS_TABLE} {where} ORDER BY updated_at DESC',
            params,
        ).fetchall()
    finally:
        conn.close()
    return [_row_to_summary(r) for r in rows]


def get_conversation(conversation_id: int, db_path: Optional[str] = None) -> Dict[str, Any]:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        row = conn.execute(
            f'SELECT id, year, event_name, driver_number, title, messages, created_at, updated_at '
            f'FROM {CONVERSATIONS_TABLE} WHERE id = ?',
            (conversation_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise LookupError(f'No conversation with id {conversation_id}')

    conv_id, year, event_name, driver_number, title, messages_json, created_at, updated_at = row
    return {
        'id': conv_id, 'year': year, 'event_name': event_name, 'driver_number': driver_number,
        'title': title, 'messages': json.loads(messages_json),
        'created_at': created_at, 'updated_at': updated_at,
    }


def create_conversation(
    title: str, year: Optional[int] = None, event_name: Optional[str] = None,
    driver_number: Optional[str] = None, db_path: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_schema(db_path)
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect(db_path)
    try:
        cur = conn.execute(
            f'INSERT INTO {CONVERSATIONS_TABLE} '
            f'(year, event_name, driver_number, title, messages, created_at, updated_at) '
            f'VALUES (?, ?, ?, ?, ?, ?, ?)',
            (year, event_name, driver_number, title.strip() or 'New conversation', '[]', now, now),
        )
        conn.commit()
        conv_id = cur.lastrowid
    finally:
        conn.close()
    return {
        'id': conv_id, 'year': year, 'event_name': event_name, 'driver_number': driver_number,
        'title': title.strip() or 'New conversation', 'messages': [],
        'created_at': now, 'updated_at': now,
    }


def update_conversation(
    conversation_id: int, title: Optional[str] = None,
    messages: Optional[List[Dict[str, Any]]] = None, db_path: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_schema(db_path)
    existing = get_conversation(conversation_id, db_path)  # raises LookupError if missing
    new_title = title.strip() if title and title.strip() else existing['title']
    new_messages = messages if messages is not None else existing['messages']
    now = datetime.now(timezone.utc).isoformat()

    conn = _connect(db_path)
    try:
        conn.execute(
            f'UPDATE {CONVERSATIONS_TABLE} SET title = ?, messages = ?, updated_at = ? WHERE id = ?',
            (new_title, json.dumps(new_messages), now, conversation_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {**existing, 'title': new_title, 'messages': new_messages, 'updated_at': now}


def delete_conversation(conversation_id: int, db_path: Optional[str] = None) -> bool:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        cur = conn.execute(f'DELETE FROM {CONVERSATIONS_TABLE} WHERE id = ?', (conversation_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()
