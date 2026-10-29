"""Guided interview endpoints with Gemini replaced by scripted responses.

These verify validation, retries and contracts — not the quality of real
Gemini output, which needs a real key to assess.
"""

import json
import os

os.environ["AI_SERVICE_TOKEN"] = "test-token"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402

AUTH = {"X-Internal-Token": "test-token"}
client = TestClient(main.app)


@pytest.fixture
def gemini(monkeypatch):
    """Queue raw Gemini replies; records prompts."""
    state = {"replies": [], "prompts": []}

    def fake(prompt):
        state["prompts"].append(prompt)
        reply = state["replies"].pop(0) if state["replies"] else None
        if isinstance(reply, tuple):
            return reply
        return (json.dumps(reply) if not isinstance(reply, str) else reply), None

    monkeypatch.setattr(main, "call_gemini_text", fake)
    monkeypatch.setattr(main, "gemini_configured", lambda: True)
    return state


def q(n, category="Backend Development"):
    return {"questions": [{"question": f"Explain backend concept number {i}?", "category": category, "topic": "APIs"} for i in range(n)]}


GOOD_EVAL = {
    "score": 7,
    "strengths": ["Clear definition"],
    "missing_concepts": ["Idempotency"],
    "inaccuracies": [],
    "clarity": "Well structured.",
    "improvements": ["Give an example"],
    "example_answer": "A REST API exposes resources over HTTP...",
    "revise": ["HTTP methods"],
    "follow_up": "How would you version this API?",
}

GOOD_LEARN = {
    "why_it_matters": "Caching reduces latency.",
    "concepts": ["Cache invalidation"],
    "example_answer": "A suggested answer would explain...",
    "simple_explanation": "Keep a copy of data close by.",
    "practical_example": "Redis in front of a database.",
    "key_points": ["TTL", "Invalidation"],
    "follow_up_question": "When would you not cache?",
}


def test_questions_requires_gemini(monkeypatch):
    monkeypatch.setattr(main, "gemini_configured", lambda: False)
    res = client.post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Behavioral", "count": 5}, headers=AUTH)
    assert res.status_code == 503


@pytest.mark.parametrize("count", [5, 10, 15, 20])
def test_questions_respects_configured_count(gemini, count):
    gemini["replies"] = [q(count + 3)]
    res = client.post("/api/interview/guided/questions", json={"difficulty": "Hard", "category": "Backend Development", "count": count}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()["questions"]
    assert len(body) == count
    assert all(item["difficulty"] == "Hard" and item["category"] == "Backend Development" for item in body)
    assert "advanced concepts" in gemini["prompts"][0]


def test_questions_rejects_bad_count_and_category():
    assert client.post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Behavioral", "count": 7}, headers=AUTH).status_code == 422
    assert client.post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Astrology", "count": 5}, headers=AUTH).status_code == 422


def test_questions_retries_when_too_few_or_duplicates_then_fails(gemini):
    dupes = {"questions": [{"question": "Explain REST APIs in detail?", "category": "x"}] * 10}
    gemini["replies"] = [dupes, q(3)]
    res = client.post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Backend Development", "count": 5}, headers=AUTH)
    assert res.status_code == 502
    assert len(gemini["prompts"]) == 2, "one retry, no infinite loop"


def test_questions_recovers_on_retry(gemini):
    gemini["replies"] = ["not json at all", q(5)]
    res = client.post("/api/interview/guided/questions", json={"difficulty": "Medium", "category": "Backend Development", "count": 5}, headers=AUTH)
    assert res.status_code == 200 and len(res.json()["questions"]) == 5


def test_category_specific_prompt_and_personalisation(gemini):
    gemini["replies"] = [q(5, "Data Structures and Algorithms")]
    client.post(
        "/api/interview/guided/questions",
        json={"difficulty": "Medium", "category": "Data Structures and Algorithms", "count": 5, "resume_text": "Built a URL shortener", "job_description": "Needs graph algorithms", "company": "Acme", "language": "Java"},
        headers=AUTH,
    )
    prompt = gemini["prompts"][0]
    assert '"Data Structures and Algorithms"' in prompt
    assert "Built a URL shortener" in prompt and "graph algorithms" in prompt and "COMPANY: Acme" in prompt and "Java" in prompt


def test_mixed_interview_keeps_per_question_categories(gemini):
    gemini["replies"] = [{"questions": [{"question": f"Question about topic {i} here?", "category": c} for i, c in enumerate(["Behavioral", "System Design", "Frontend Development", "Nonsense", "General HR"])]}]
    res = client.post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Mixed Interview", "count": 5}, headers=AUTH)
    cats = [x["category"] for x in res.json()["questions"]]
    assert cats == ["Behavioral", "System Design", "Frontend Development", "Mixed Interview", "General HR"]


def test_resume_based_interview_needs_resume(gemini):
    res = client.post("/api/interview/guided/questions", json={"difficulty": "Easy", "category": "Resume-Based Interview", "count": 5}, headers=AUTH)
    assert res.status_code == 422


def test_evaluate_returns_validated_structure(gemini):
    gemini["replies"] = [{**GOOD_EVAL, "score": 7.6, "strengths": ["Clear definition", "Clear definition", 5]}]
    res = client.post("/api/interview/guided/evaluate", json={"question": "What is REST?", "category": "Backend Development", "difficulty": "Easy", "transcript": "rest is um a style"}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["score"] == 8
    assert body["strengths"] == ["Clear definition", "5"]
    assert set(body) == set(GOOD_EVAL)
    assert "never penalise accent" in gemini["prompts"][0]
    assert "speech-to-text transcript" in gemini["prompts"][0]


def test_evaluate_rejects_out_of_range_score_after_retry(gemini):
    gemini["replies"] = [{**GOOD_EVAL, "score": 42}, {**GOOD_EVAL, "score": "ten"}]
    res = client.post("/api/interview/guided/evaluate", json={"question": "What is REST?", "category": "Backend Development", "difficulty": "Easy", "transcript": "x"}, headers=AUTH)
    assert res.status_code == 502


def test_evaluate_does_not_retry_on_quota_error(gemini):
    gemini["replies"] = [(None, "Gemini HTTP 429: quota")]
    res = client.post("/api/interview/guided/evaluate", json={"question": "What is REST?", "category": "Backend Development", "difficulty": "Easy", "transcript": "x"}, headers=AUTH)
    assert res.status_code == 502
    assert len(gemini["prompts"]) == 1


def test_learn_requires_complete_content(gemini):
    gemini["replies"] = [{**GOOD_LEARN, "example_answer": ""}, GOOD_LEARN]
    res = client.post("/api/interview/guided/learn", json={"question": "Explain caching strategies.", "category": "System Design", "difficulty": "Hard", "partial_transcript": "caching is"}, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["follow_up_question"] == "When would you not cache?"
    assert "caching is" in gemini["prompts"][0]
    assert "never claim the candidate did anything" in gemini["prompts"][0]


def test_summary_falls_back_to_derived_feedback_when_ai_fails(gemini):
    gemini["replies"] = ["bad", "bad"]
    items = [
        {"question": "Q1 text here", "status": "answered", "score": 6, "strengths": ["Clear"], "improvements": ["Add examples"], "missing_concepts": ["Indexes"]},
        {"question": "Q2 text here", "status": "answered", "score": 8, "strengths": ["Clear"], "improvements": ["Add examples"], "missing_concepts": []},
        {"question": "Explain sharding in depth", "status": "skipped_for_learning"},
    ]
    res = client.post("/api/interview/guided/summary", json={"category": "Backend Development", "difficulty": "Medium", "items": items}, headers=AUTH)
    body = res.json()
    assert body["ai_used"] is False
    assert body["strengths"] == ["Clear"] and body["improvements"] == ["Add examples"]
    assert any("sharding" in r for r in body["recommendations"])


def test_guided_routes_require_internal_token():
    for path in ["questions", "evaluate", "learn", "summary"]:
        assert client.post(f"/api/interview/guided/{path}", json={}).status_code == 401
