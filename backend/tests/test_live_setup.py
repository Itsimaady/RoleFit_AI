"""Gemini Live setup handling, tested against a FAKE upstream WebSocket.

These tests verify the payload we send and how we react to Gemini's replies.
They do not contact Google and do not prove a real live session works.
"""

import json
import logging
import os

os.environ["AI_SERVICE_TOKEN"] = "test-token"

import pytest  # noqa: E402
import websockets  # noqa: E402
from websockets.frames import Close  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402

AUTH = {"X-Internal-Token": "test-token"}
SECRET = "AIzaTEST-secret-key-1234567890"
START = {
    "type": "start",
    "resume_text": "Aarav Sharma\nSoftware Engineer",
    "job_description": "Backend engineer",
    "questions": [{"round": "Technical", "question": f"Question {i + 1}?"} for i in range(12)],
}


class FakeGemini:
    """Minimal stand-in for the upstream Live WebSocket."""

    def __init__(self, recv_behaviour):
        self.sent = []
        self.recv_behaviour = recv_behaviour
        self.closed = False

    async def send(self, data):
        self.sent.append(json.loads(data))

    async def recv(self):
        return await self.recv_behaviour()

    async def close(self):
        self.closed = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


@pytest.fixture
def gemini(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    holder = {}

    def install(recv_behaviour):
        fake = FakeGemini(recv_behaviour)

        async def fake_connect(url, **kwargs):
            holder["url"] = url
            return fake

        monkeypatch.setattr(main.websockets, "connect", fake_connect)
        holder["fake"] = fake
        return holder

    return install


def run_session(client):
    with client.websocket_connect("/ws/monk-live", headers=AUTH) as ws:
        ws.send_json(START)
        return ws.receive_json()


def test_setup_payload_nests_modalities_and_speech_in_generation_config(gemini):
    async def setup_complete():
        return json.dumps({"setupComplete": {}})

    holder = gemini(setup_complete)
    msg = run_session(TestClient(main.app))
    assert msg["type"] == "ready"

    setup = holder["fake"].sent[0]["setup"]
    assert "responseModalities" not in setup
    assert "speechConfig" not in setup
    assert setup["generationConfig"] == {
        "responseModalities": ["AUDIO"],
        "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": main.GEMINI_VOICE}}},
    }
    # Everything else is preserved.
    assert setup["model"] == f"models/{main.GEMINI_LIVE_MODEL}"
    assert setup["inputAudioTranscription"] == {} and setup["outputAudioTranscription"] == {}
    assert setup["realtimeInputConfig"]["automaticActivityDetection"]["silenceDurationMs"] == 1200
    assert "Question 12?" in setup["systemInstruction"]["parts"][0]["text"]
    # The first turn is only sent after setupComplete.
    assert "clientContent" in holder["fake"].sent[1]


def test_close_during_setup_returns_safe_error_and_logs_reason(gemini, caplog):
    reason = 'Invalid JSON payload received. Unknown name "responseModalities" at \'setup\': Cannot find field.'

    async def close_1007():
        raise websockets.exceptions.ConnectionClosedError(Close(1007, reason), None)

    holder = gemini(close_1007)
    with caplog.at_level(logging.ERROR, logger="rolefit"):
        msg = run_session(TestClient(main.app))

    assert msg["type"] == "error"
    assert "code 1007" in msg["message"]
    assert "Unknown name" in msg["message"]
    assert "1007" in caplog.text and "Unknown name" in caplog.text
    assert len(holder["fake"].sent) == 1, "no interview turn is sent after a rejected setup"
    assert holder["fake"].closed
    # The API key and the upstream URL never leak.
    assert SECRET not in caplog.text and SECRET not in msg["message"]
    assert "generativelanguage.googleapis.com" not in caplog.text


def test_setup_timeout_returns_safe_error(gemini, monkeypatch):
    import asyncio

    monkeypatch.setattr(main, "LIVE_SETUP_TIMEOUT", 0.05)

    async def never():
        await asyncio.sleep(5)

    gemini(never)
    msg = run_session(TestClient(main.app))
    assert msg["type"] == "error"
    assert "did not respond" in msg["message"]


def test_error_payload_during_setup_is_reported(gemini):
    async def error_msg():
        return json.dumps({"error": {"message": "models/gemini-x is not found for API version v1beta"}})

    gemini(error_msg)
    msg = run_session(TestClient(main.app))
    assert msg["type"] == "error"
    assert "not found" in msg["message"]


def test_redact_strips_key_and_urls(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    text = f"failed to connect to wss://generativelanguage.googleapis.com/ws/x?key={SECRET} ({SECRET})"
    out = main._redact(text)
    assert SECRET not in out
    assert "googleapis.com" not in out
    assert "<gemini-endpoint>" in out
