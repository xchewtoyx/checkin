from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_DB_PATH = Path("data/checkins.db")


@dataclass(frozen=True)
class Checkin:
    id: int
    mood: int
    note: str | None
    created_at: str


class CheckinStore:
    def __init__(self, db_path: Path = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS checkins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
                    note TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )

    def add(self, mood: int, note: str | None = None) -> Checkin:
        created_at = datetime.now(UTC).isoformat()
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO checkins (mood, note, created_at) VALUES (?, ?, ?)",
                (mood, note, created_at),
            )
            row_id = cursor.lastrowid
        return self.get(row_id)

    def get(self, checkin_id: int) -> Checkin:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, mood, note, created_at FROM checkins WHERE id = ?",
                (checkin_id,),
            ).fetchone()
        if row is None:
            raise KeyError(checkin_id)
        return Checkin(
            id=row["id"],
            mood=row["mood"],
            note=row["note"],
            created_at=row["created_at"],
        )

    def list_recent(self, limit: int = 50) -> list[Checkin]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, mood, note, created_at
                FROM checkins
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            Checkin(
                id=row["id"],
                mood=row["mood"],
                note=row["note"],
                created_at=row["created_at"],
            )
            for row in rows
        ]
