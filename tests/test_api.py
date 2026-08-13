from fastapi.testclient import TestClient

from checkin.app import app
from checkin.store import CheckinStore

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_and_list_checkins(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "checkins.db"
    test_store = CheckinStore(db_path)
    monkeypatch.setattr("checkin.app.store", test_store)

    create_response = client.post("/checkins", json={"mood": 4, "note": "steady"})
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["mood"] == 4
    assert created["note"] == "steady"
    assert "id" in created
    assert "created_at" in created

    list_response = client.get("/checkins")
    assert list_response.status_code == 200
    items = list_response.json()
    assert len(items) == 1
    assert items[0]["id"] == created["id"]


def test_rejects_invalid_mood(tmp_path, monkeypatch) -> None:
    test_store = CheckinStore(tmp_path / "checkins.db")
    monkeypatch.setattr("checkin.app.store", test_store)

    response = client.post("/checkins", json={"mood": 6})
    assert response.status_code == 422
