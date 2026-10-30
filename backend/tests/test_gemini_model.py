"""Gemini text-model configuration, exercised through the real call_gemini_text
client with only the network call (main._gemini_post) replaced.

These tests do NOT contact Google; they prove which URL and payload we send and
how responses/errors are handled.
"""

import json
import os

os.environ["AI_SERVICE_TOKEN"] = "test-token"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402

AUTH = {"X-Internal-Token": "test-token"}
KEY = "AIzaTEST-not-a-real-key-123456789"


@pytest.fixture
def gemini_http(monkeypatch):
    """Record outgoing Gemini requests at the transport layer and reply with queued bodies or HTTP errors."""
    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    monkeypatch.setattr(main, "_sleep", lambda s: None)
    state = {"requests": [], "replies": []}

    def fake_post(path, body, key, connect_timeout, read_timeout, deadline=None):
        state["requests"].append({"path": path, "key": key, "body": json.loads(body.decode())})
        reply = state["replies"].pop(0)
        if isinstance(reply, tuple):  # (status, body)
            return reply[0], {}, json.dumps(reply[1]).encode()
        text = reply if isinstance(reply, str) else json.dumps(reply)
        envelope = {"candidates": [{"content": {"parts": [{"text": text}]}}]}
        return 200, {}, json.dumps(envelope).encode()

    monkeypatch.setattr(main, "_gemini_post", fake_post)
    return state


def http_error(code, message):
    return (code, {"error": {"code": code, "message": message, "status": "NOT_FOUND"}})


def test_default_text_model_is_gemini_3_8_flash(monkeypatch):
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)
    assert main.gemini_text_model() == "gemini-3.8-flash"
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "   ")
    assert main.gemini_text_model() == "gemini-3.8-flash", "blank value falls back to the default"


def test_env_override_and_models_prefix_normalisation(monkeypatch):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "models/gemini-3.8-flash")
    assert main.gemini_text_model() == "gemini-3.8-flash"
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "gemini-custom-text")
    assert main.gemini_text_model() == "gemini-custom-text"


def test_env_example_uses_new_text_model_and_keeps_live_model():
    example = open(os.path.join(os.path.dirname(__file__), "..", ".env.example"), encoding="utf-8").read()
    assert "GEMINI_TEXT_MODEL=gemini-3.8-flash" in example
    assert "gemini-2.5-flash" not in example
    assert "GEMINI_LIVE_MODEL=gemini-3.8-live" in example, "the Live audio model is configured separately"


def test_client_calls_generate_content_on_the_configured_model(gemini_http, monkeypatch):
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)
    gemini_http["replies"] = ['{"ok": true}']
    text, error = main.call_gemini_text("hello")
    assert error is None and text == '{"ok": true}'
    request = gemini_http["requests"][0]
    assert request["path"] == "/v1beta/models/gemini-3.8-flash:generateContent"
    assert "models/models/" not in request["path"]
    assert request["key"] == KEY and KEY not in request["path"], "key goes in a header, never the URL"
    # Request shape is unchanged.
    body = gemini_http["requests"][0]["body"]
    assert body["generationConfig"] == {"temperature": 0.2, "responseMimeType": "application/json"}
    assert body["contents"][0]["parts"][0]["text"] == "hello"


def test_guided_questions_through_the_real_client(gemini_http, monkeypatch):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "models/gemini-3.8-flash")
    questions = [{"question": f"Explain backend concept number {i} in detail?", "category": "Backend Development", "topic": "APIs"} for i in range(5)]
    gemini_http["replies"] = [{"questions": questions}]
    res = TestClient(main.app).post("/api/interview/guided/questions", json={"difficulty": "Medium", "category": "Backend Development", "count": 5}, headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()["questions"]
    assert len(body) == 5
    assert all(q["difficulty"] == "Medium" and q["category"] == "Backend Development" for q in body)
    assert gemini_http["requests"][0]["path"] == "/v1beta/models/gemini-3.8-flash:generateContent"
    # The prompt and JSON schema instruction are preserved.
    prompt = gemini_http["requests"][0]["body"]["contents"][0]["parts"][0]["text"]
    assert "Write exactly 5 interview questions" in prompt
    assert '{"questions": [{"question": string, "category": string, "topic": string}]}' in prompt


def test_model_404_returns_safe_error_without_retrying_or_leaking_key(gemini_http, caplog):
    gemini_http["replies"] = [http_error(404, "models/gemini-old is not found for API version v1beta")]
    res = TestClient(main.app).post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Behavioral", "count": 5}, headers=AUTH)
    assert res.status_code == 502
    assert res.json()["detail"] == "The AI could not produce a valid question set. Please try again."
    assert len(gemini_http["requests"]) == 1, "4xx errors are not retried"
    assert KEY not in res.text
    assert "Gemini HTTP 404" in caplog.text
    assert KEY not in caplog.text


def test_live_audio_model_is_not_the_text_model():
    assert main.GEMINI_LIVE_MODEL != main.gemini_text_model()
    assert main.GEMINI_LIVE_MODEL == os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")
