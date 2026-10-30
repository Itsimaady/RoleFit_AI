"""Retry, backoff, timeout and error-mapping behaviour of the Gemini text client.

The network (main._gemini_post), clock (main._monotonic), sleep (main._sleep)
and jitter (main._random) are replaced, so these tests are deterministic and
never contact Google. They do not prove real Gemini availability.
"""

import json
import logging
import os
from email.utils import format_datetime
from datetime import datetime, timedelta, timezone

os.environ["AI_SERVICE_TOKEN"] = "test-token"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402

AUTH = {"X-Internal-Token": "test-token"}
KEY = "AIzaRETRY-not-a-real-key-987654321"
QUESTIONS = {"questions": [{"question": f"Explain backend concept number {i} please?", "category": "Backend Development", "topic": "APIs"} for i in range(5)]}


def ok(payload):
    envelope = {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    return (200, {}, json.dumps(envelope).encode())


def err(status, message="error", headers=None):
    return (status, headers or {}, json.dumps({"error": {"code": status, "message": message}}).encode())


@pytest.fixture
def net(monkeypatch):
    """Scripted transport + fake clock. Each script item is a reply tuple or an exception to raise."""
    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    state = {"script": [], "calls": [], "sleeps": [], "now": 1000.0, "cost": 0.0}

    def fake_post(path, body, key, connect_timeout, read_timeout, deadline=None):
        # Like a real socket: the wait can never exceed the timeout we were given,
        # and the read timeout is derived from the deadline once "connected".
        if deadline is not None:
            read_timeout = min(read_timeout, max(0.5, deadline - state["now"]))
        state["calls"].append({"path": path, "key": key, "connect": connect_timeout, "read": read_timeout})
        state["now"] += min(state["cost"], read_timeout)  # time spent waiting on the network
        item = state["script"].pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def fake_sleep(seconds):
        state["sleeps"].append(seconds)
        state["now"] += seconds

    monkeypatch.setattr(main, "_gemini_post", fake_post)
    monkeypatch.setattr(main, "_sleep", fake_sleep)
    monkeypatch.setattr(main, "_monotonic", lambda: state["now"])
    monkeypatch.setattr(main, "_random", lambda: 0.5)
    monkeypatch.setattr(main, "gemini_configured", lambda: True)
    monkeypatch.setattr(main, "GEMINI_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(main, "GEMINI_TOTAL_TIMEOUT", 50.0)
    monkeypatch.setattr(main, "GEMINI_CONNECT_TIMEOUT", 5.0)
    monkeypatch.setattr(main, "GEMINI_READ_TIMEOUT", 25.0)
    return state


def generate(count=5):
    return TestClient(main.app).post("/api/interview/guided/questions", json={"difficulty": "Medium", "category": "Backend Development", "count": count}, headers=AUTH)


def evaluate():
    """Answer evaluation has no template fallback, so transient failures surface as a 502."""
    body = {"question": "What is REST?", "category": "Backend Development", "difficulty": "Easy", "transcript": "rest is a style"}
    return TestClient(main.app).post("/api/interview/guided/evaluate", json=body, headers=AUTH)


# --------------------------------------------------------------- recovery


def test_recovers_after_503_with_backoff(net):
    net["script"] = [err(503, "The model is overloaded."), ok(QUESTIONS)]
    res = generate()
    assert res.status_code == 200
    assert len(res.json()["questions"]) == 5
    assert len(net["calls"]) == 2
    assert net["sleeps"] == [0.75], "attempt 1 backoff: 0.5 + 0.5 * 0.5 jitter"


def test_recovers_after_timeout_and_network_error(net):
    net["script"] = [TimeoutError("The read operation timed out"), ConnectionResetError("reset"), ok(QUESTIONS)]
    res = generate()
    assert res.status_code == 200
    assert len(net["calls"]) == 3
    assert net["sleeps"] == [0.75, 1.5], "exponential: 1st 0.5-1 s, 2nd 1-2 s"


def test_recovers_after_429(net):
    net["script"] = [err(429, "Resource exhausted"), ok(QUESTIONS)]
    assert generate().status_code == 200
    assert len(net["calls"]) == 2


# --------------------------------------------------------------- limits


def test_stops_after_max_attempts_and_returns_clear_error(net, caplog):
    net["script"] = [err(503, "high demand")] * 3
    with caplog.at_level(logging.WARNING, logger="rolefit"):
        res = evaluate()
    assert res.status_code == 502
    assert "Gemini is busy or not responding right now" in res.json()["detail"]
    assert len(net["calls"]) == 3, "bounded: exactly GEMINI_MAX_ATTEMPTS transport calls, no extra layer of retries"
    assert len(net["sleeps"]) == 2
    assert "attempt 1/3" in caplog.text and "attempt 2/3" in caplog.text


def test_client_error_reports_attempt_count(net):
    net["script"] = [TimeoutError()] * 3
    text, error = main.call_gemini_text("hi")
    assert text is None
    assert error == "Gemini request timed out (after 3 attempts)"
    assert main.is_transient_gemini_error(error)


def test_total_time_budget_bounds_slow_timeouts(net):
    net["cost"] = 25.0  # each attempt burns a full read timeout
    net["script"] = [TimeoutError()] * 3
    res = evaluate()
    assert res.status_code == 502
    # 25 s + 0.75 s backoff, then the 2nd attempt gets only the 24.25 s left; no time for a 3rd.
    assert len(net["calls"]) == 2
    assert net["calls"][1]["read"] == 24.25
    assert net["now"] - 1000.0 <= 50.0, "never exceeds the total budget"


def test_timeouts_are_separate_and_capped_by_remaining_budget(net):
    net["script"] = [ok(QUESTIONS)]
    generate()
    assert net["calls"][0]["connect"] == 5.0
    assert net["calls"][0]["read"] == 25.0


# --------------------------------------------------------------- Retry-After


def test_honours_retry_after_seconds(net):
    net["script"] = [err(429, "slow down", {"retry-after": "7"}), ok(QUESTIONS)]
    assert generate().status_code == 200
    assert net["sleeps"] == [7.0]


def test_honours_retry_after_http_date():
    when = datetime.now(timezone.utc) + timedelta(seconds=30)
    assert 25 <= main._retry_after_seconds(format_datetime(when, usegmt=True)) <= 31
    assert main._retry_after_seconds("garbage") is None
    assert main._retry_after_seconds(None) is None
    assert main._retry_after_seconds("-5") == 0.0


def test_does_not_wait_when_retry_after_exceeds_budget(net):
    net["script"] = [err(503, "busy", {"retry-after": "120"})]
    res = evaluate()
    assert res.status_code == 502
    assert len(net["calls"]) == 1
    assert net["sleeps"] == [], "never sleeps past the time budget"


# --------------------------------------------------------------- non-retryable


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_does_not_retry_client_errors(net, status):
    net["script"] = [err(status, "bad request")]
    text, error = main.call_gemini_text("hi")
    assert text is None
    assert error.startswith(f"Gemini HTTP {status}:")
    assert len(net["calls"]) == 1
    assert net["sleeps"] == []
    assert not main.is_transient_gemini_error(error)


def test_client_error_gives_generic_message_not_busy(net):
    net["script"] = [err(400, "invalid argument")]
    res = generate()
    assert res.status_code == 502
    assert res.json()["detail"] == "The AI could not produce a valid question set. Please try again."


# --------------------------------------------------------------- schema & secrets


def test_malformed_json_still_gets_one_correction_attempt(net):
    net["script"] = [ok({"questions": "nope"}), ok(QUESTIONS)]
    res = generate()
    assert res.status_code == 200
    assert len(net["calls"]) == 2
    assert net["sleeps"] == [], "malformed output is not a transport failure"


def test_key_never_in_url_logs_or_errors(net, caplog):
    net["script"] = [err(503, f"echo {KEY}")] * 3
    with caplog.at_level(logging.WARNING):
        text, error = main.call_gemini_text("hi")
        res = generate() if net["script"] else None
    assert all(KEY not in c["path"] for c in net["calls"])
    assert all(c["key"] == KEY for c in net["calls"]), "key is passed to the header-based transport"
    assert KEY not in error
    assert KEY not in caplog.text
    assert res is None or KEY not in res.text


# --------------------------------------------------------------- model fallback chain


def test_fallback_model_list_parsing(monkeypatch):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "models/primary")
    monkeypatch.setenv("GEMINI_TEXT_FALLBACK_MODELS", " lite-a , models/lite-b,,primary,lite-a ")
    assert main.gemini_text_models() == ["primary", "lite-a", "lite-b"], "trimmed, prefix stripped, de-duplicated"
    monkeypatch.delenv("GEMINI_TEXT_FALLBACK_MODELS")
    assert main.gemini_text_models() == ["primary"]


def test_switches_to_fallback_model_immediately_on_timeout(net, monkeypatch, caplog):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "primary")
    monkeypatch.setenv("GEMINI_TEXT_FALLBACK_MODELS", "lite")
    net["script"] = [TimeoutError("timed out"), ok({"ok": True})]
    with caplog.at_level(logging.WARNING, logger="rolefit"):
        text, error = main.call_gemini_text("hi")
    assert error is None and json.loads(text) == {"ok": True}
    assert [c["path"] for c in net["calls"]] == ["/v1beta/models/primary:generateContent", "/v1beta/models/lite:generateContent"]
    assert net["sleeps"] == [], "no backoff before trying a different model"
    assert "served by fallback model lite" in caplog.text


def test_model_chain_exhausted_reports_models_tried(net, monkeypatch):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "primary")
    monkeypatch.setenv("GEMINI_TEXT_FALLBACK_MODELS", "lite")
    net["script"] = [err(503, "busy")] * 3
    text, error = main.call_gemini_text("hi")
    assert text is None
    assert error.endswith("(after 3 attempts; models tried: primary, lite)")
    assert main.is_transient_gemini_error(error)
    assert [c["path"].split("/")[3] for c in net["calls"]] == ["primary:generateContent", "lite:generateContent", "primary:generateContent"]
    assert len(net["sleeps"]) == 1, "backs off only after every model failed once"


def test_client_error_on_primary_does_not_try_fallback_model(net, monkeypatch):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "primary")
    monkeypatch.setenv("GEMINI_TEXT_FALLBACK_MODELS", "lite")
    net["script"] = [err(403, "permission denied")]
    text, error = main.call_gemini_text("hi")
    assert error.startswith("Gemini HTTP 403:")
    assert len(net["calls"]) == 1


# --------------------------------------------------------------- real transport wiring


class FakeSocket:
    def __init__(self):
        self.timeouts = []

    def settimeout(self, value):
        self.timeouts.append(value)


class FakeConnection:
    instances = []
    fail_on_read = False

    def __init__(self, host, timeout=None, context=None):
        self.host, self.timeout, self.closed = host, timeout, False
        self.sock = None
        FakeConnection.instances.append(self)

    def connect(self):
        self.sock = FakeSocket()

    def request(self, method, path, body=None, headers=None):
        self.sent = (method, path, headers)

    def getresponse(self):
        if FakeConnection.fail_on_read:
            raise TimeoutError("The read operation timed out")

        class Resp:
            status = 200

            def getheaders(self):
                return [("Retry-After", "3"), ("Content-Type", "application/json")]

            def read(self):
                return b"{}"

        return Resp()

    def close(self):
        self.closed = True


def test_transport_uses_separate_timeouts_header_key_and_always_closes(monkeypatch):
    FakeConnection.instances = []
    FakeConnection.fail_on_read = False
    monkeypatch.setattr(main.http.client, "HTTPSConnection", FakeConnection)
    monkeypatch.setattr(main, "_monotonic", lambda: 100.0)
    status, headers, body = main._gemini_post("/v1beta/models/m:generateContent", b"{}", KEY, 5.0, 25.0, deadline=110.0)
    conn = FakeConnection.instances[0]
    assert (status, body) == (200, b"{}")
    assert headers["retry-after"] == "3", "header names are normalised to lower case"
    assert conn.host == "generativelanguage.googleapis.com"
    assert conn.timeout == 5.0, "connect timeout"
    assert conn.sock.timeouts == [10.0], "read timeout capped by the time left before the deadline"
    method, path, sent_headers = conn.sent
    assert method == "POST" and KEY not in path
    assert sent_headers["x-goog-api-key"] == KEY
    assert conn.closed

    FakeConnection.fail_on_read = True
    with pytest.raises(TimeoutError):
        main._gemini_post("/p", b"{}", KEY, 5.0, 25.0)
    assert FakeConnection.instances[-1].closed, "connection closed even when the read times out"
