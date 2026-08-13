from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from checkin.store import Checkin, CheckinStore

app = FastAPI(title="checkin", version="0.1.0")
store = CheckinStore()


class CheckinCreate(BaseModel):
    mood: Annotated[int, Field(ge=1, le=5)]
    note: str | None = None


class CheckinResponse(BaseModel):
    id: int
    mood: int
    note: str | None
    created_at: str

    @classmethod
    def from_checkin(cls, checkin: Checkin) -> CheckinResponse:
        return cls(
            id=checkin.id,
            mood=checkin.mood,
            note=checkin.note,
            created_at=checkin.created_at,
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/checkins", response_model=CheckinResponse, status_code=201)
def create_checkin(payload: CheckinCreate) -> CheckinResponse:
    checkin = store.add(mood=payload.mood, note=payload.note)
    return CheckinResponse.from_checkin(checkin)


@app.get("/checkins", response_model=list[CheckinResponse])
def list_checkins(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[CheckinResponse]:
    return [CheckinResponse.from_checkin(item) for item in store.list_recent(limit)]


@app.get("/checkins/{checkin_id}", response_model=CheckinResponse)
def get_checkin(checkin_id: int) -> CheckinResponse:
    try:
        checkin = store.get(checkin_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Checkin not found") from exc
    return CheckinResponse.from_checkin(checkin)
