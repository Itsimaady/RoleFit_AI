"""Guided voice interview: question generation, answer evaluation, learning
content for skipped questions, and a session summary.

Each operation is a separate endpoint. Every Gemini response is parsed as
JSON, validated against a strict shape, and retried once when malformed.
There are no heuristic fallbacks that pretend to be AI output: if Gemini is
unavailable the endpoint returns 503 and the caller keeps the user's data.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger("rolefit.guided")

Difficulty = Literal["Easy", "Medium", "Hard"]
CATEGORIES = [
    "General HR",
    "Behavioral",
    "Data Structures and Algorithms",
    "Software Development / SDE",
    "Backend Development",
    "Frontend Development",
    "Full-Stack Development",
    "AI / Machine Learning",
    "System Design",
    "Resume-Based Interview",
    "Job Description-Based Interview",
    "Mixed Interview",
]
QUESTION_COUNTS = {5, 10, 15, 20}

DIFFICULTY_GUIDE = {
    "Easy": "fundamental concepts and introductory questions a fresher should handle",
    "Medium": "practical technical questions and problem-solving grounded in real work",
    "Hard": "advanced concepts, deeper follow-ups, edge cases and design trade-offs",
}

CRITERIA = {
    "Data Structures and Algorithms": "approach, correctness, time/space complexity analysis and edge cases",
    "System Design": "requirements gathering, architecture, data model, scalability, reliability and trade-offs",
    "General HR": "relevance, clarity, specificity and evidence from real experience",
    "Behavioral": "situation-task-action-result structure, specificity, ownership and reflection",
    "Resume-Based Interview": "consistency with the supplied resume, depth on the candidate's actual projects, and personal contribution",
    "Job Description-Based Interview": "alignment with the job's stated requirements and practical reasoning",
    "AI / Machine Learning": "conceptual correctness, data and evaluation considerations, and practical trade-offs",
    "Frontend Development": "fundamentals (HTML/CSS/JS, framework concepts), performance, accessibility and practical implementation",
    "Backend Development": "API design, data modelling, correctness, security, performance and reliability",
    "Full-Stack Development": "end-to-end reasoning across client, API and data layers, and practical implementation",
    "Software Development / SDE": "fundamentals, reasoning, code-level correctness and practical implementation",
    "Mixed Interview": "criteria appropriate to each question's own category",
}

# Wired up by app.main so tests can monkeypatch app.main.call_gemini_text.
_gemini: Callable[[str], Tuple[Optional[str], Optional[str]]] = lambda prompt: (None, "not configured")  # noqa: E731
_extract: Callable[[str], Any] = lambda raw: None  # noqa: E731
_configured: Callable[[], bool] = lambda: False  # noqa: E731


def configure(gemini, extract, configured) -> None:
    global _gemini, _extract, _configured
    _gemini, _extract, _configured = gemini, extract, configured


router = APIRouter(prefix="/api/interview/guided")


# --------------------------------------------------------------------------- helpers


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


def _require_gemini() -> None:
    if not _configured():
        raise HTTPException(status_code=503, detail="Gemini is not configured on the AI service. Add GEMINI_API_KEY to backend/.env and restart it.")


def _text(value: Any, max_len: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:max_len] if isinstance(value, (str, int, float)) else ""


def _str_list(value: Any, max_items: int = 6, max_len: int = 400) -> List[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        s = _text(item, max_len)
        if s and s not in out:
            out.append(s)
    return out[:max_items]


def _ask_json(prompt: str, validate: Callable[[Any], Optional[Dict[str, Any]]], what: str) -> Dict[str, Any]:
    """Call Gemini, validate the JSON, retry once with a correction hint."""
    last_error = "no response"
    for attempt in range(2):
        hint = "" if attempt == 0 else "\n\nYour previous reply was not valid. Reply with ONLY the JSON object described above, no prose, no markdown."
        raw, error = _gemini(prompt + hint)
        if error:
            last_error = error
            # Configuration / quota errors will not fix themselves on retry.
            if "not configured" in error or "HTTP 4" in error:
                break
            continue
        result = validate(_extract(raw or ""))
        if result is not None:
            return result
        last_error = f"malformed {what} JSON"
    logger.warning("Gemini %s failed: %s", what, (last_error or "")[:300])
    raise HTTPException(status_code=502, detail=f"The AI could not produce a valid {what}. Please try again.")


def _context(resume_text: str, job_description: str, target_role: str, company: str, language: str) -> str:
    parts = []
    if target_role:
        parts.append(f"TARGET ROLE: {target_role}")
    if company:
        parts.append(f"COMPANY: {company}")
    if language:
        parts.append(f"PREFERRED PROGRAMMING LANGUAGE: {language}")
    if job_description:
        parts.append(f"JOB DESCRIPTION:\n{job_description[:12000]}")
    if resume_text:
        parts.append(f"CANDIDATE RESUME:\n{resume_text[:12000]}")
    return "\n\n".join(parts) or "No resume or job description was provided; ask general questions for the category."


def _norm_question(q: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", q.lower()).strip()


# --------------------------------------------------------------------------- questions


class QuestionsRequest(_Model):
    difficulty: Difficulty
    category: str
    count: int
    resume_text: str = Field(default="", max_length=30000)
    job_description: str = Field(default="", max_length=20000)
    target_role: str = Field(default="", max_length=120)
    company: str = Field(default="", max_length=120)
    language: str = Field(default="", max_length=40)
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=120)
    avoid: List[str] = Field(default_factory=list, max_length=40)

    @field_validator("category")
    @classmethod
    def known_category(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError("Unknown interview category")
        return v

    @field_validator("count")
    @classmethod
    def allowed_count(cls, v: int) -> int:
        if v not in QUESTION_COUNTS:
            raise ValueError("count must be 5, 10, 15 or 20")
        return v


@router.post("/questions")
def generate_questions(req: QuestionsRequest):
    _require_gemini()
    if req.category == "Resume-Based Interview" and not req.resume_text.strip():
        raise HTTPException(status_code=422, detail="A resume-based interview needs a resume.")
    if req.category == "Job Description-Based Interview" and not req.job_description.strip():
        raise HTTPException(status_code=422, detail="A job-description-based interview needs a job description.")

    mixed = req.category == "Mixed Interview"
    category_rule = (
        f"Spread the questions across these categories: {', '.join(c for c in CATEGORIES if c != 'Mixed Interview')}, choosing the ones most relevant to the role. "
        "Set each item's category to the category it belongs to."
        if mixed
        else f'Every question must belong to the category "{req.category}" and its category field must be exactly that string.'
    )
    avoid = "\nDo not repeat or closely paraphrase any of these questions:\n- " + "\n- ".join(req.avoid) if req.avoid else ""
    duration = f" The candidate wants the whole interview to take about {req.duration_minutes} minutes; size the questions accordingly." if req.duration_minutes else ""
    prompt = (
        f"You are an experienced technical interviewer. Write exactly {req.count} interview questions.\n"
        f"Difficulty: {req.difficulty} — {DIFFICULTY_GUIDE[req.difficulty]}.\n"
        f"{category_rule}\n"
        "Questions are read aloud by text-to-speech, so write each as one or two natural spoken sentences without code blocks, bullet points or markdown. "
        "Personalise to the resume and job description when provided, but never assume experience the resume does not show. "
        "Each question must be distinct. Order them from warm-up to most demanding." + duration + avoid + "\n\n"
        f"{_context(req.resume_text, req.job_description, req.target_role, req.company, req.language)}\n\n"
        'Reply with JSON: {"questions": [{"question": string, "category": string, "topic": string}]}'
    )

    def validate(data: Any) -> Optional[Dict[str, Any]]:
        items = data.get("questions") if isinstance(data, dict) else data if isinstance(data, list) else None
        if not isinstance(items, list):
            return None
        seen, out = set(), []
        for item in items:
            if not isinstance(item, dict):
                continue
            q = _text(item.get("question"), 600)
            key = _norm_question(q)
            if len(q) < 10 or key in seen:
                continue
            seen.add(key)
            category = _text(item.get("category"), 60)
            if not mixed or category not in CATEGORIES:
                category = req.category if not mixed else (category if category in CATEGORIES else "Mixed Interview")
            out.append({"question": q, "category": category, "topic": _text(item.get("topic"), 80), "difficulty": req.difficulty})
        # The configured count is a contract: never silently return fewer.
        return {"questions": out[: req.count]} if len(out) >= req.count else None

    return _ask_json(prompt, validate, "question set")


# --------------------------------------------------------------------------- evaluation


class EvaluateRequest(_Model):
    question: str = Field(..., min_length=5, max_length=1000)
    category: str = Field(..., max_length=60)
    difficulty: Difficulty
    transcript: str = Field(..., min_length=1, max_length=12000)
    input_method: Literal["voice", "typed", "voice_edited"] = "voice"
    resume_text: str = Field(default="", max_length=30000)
    job_description: str = Field(default="", max_length=20000)
    target_role: str = Field(default="", max_length=120)


def _evaluation_validator(data: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(data, dict):
        return None
    try:
        score = float(data.get("score"))
    except (TypeError, ValueError):
        return None
    if score != score or score < 0 or score > 10:
        return None
    example = _text(data.get("example_answer"), 3000)
    if not example:
        return None
    return {
        "score": int(round(score)),
        "strengths": _str_list(data.get("strengths")),
        "missing_concepts": _str_list(data.get("missing_concepts")),
        "inaccuracies": _str_list(data.get("inaccuracies")),
        "clarity": _text(data.get("clarity"), 600),
        "improvements": _str_list(data.get("improvements")),
        "example_answer": example,
        "revise": _str_list(data.get("revise"), 8, 120),
        "follow_up": _text(data.get("follow_up"), 400),
    }


@router.post("/evaluate")
def evaluate_answer(req: EvaluateRequest):
    _require_gemini()
    criteria = CRITERIA.get(req.category, CRITERIA["Software Development / SDE"])
    source = {
        "voice": "an automatic speech-to-text transcript, so it may contain recognition errors",
        "voice_edited": "a speech-to-text transcript that the candidate corrected by hand",
        "typed": "typed by the candidate",
    }[req.input_method]
    prompt = (
        "You are evaluating one answer in a practice interview for a student or early-career candidate.\n"
        f"Category: {req.category}. Difficulty: {req.difficulty}. Judge it on: {criteria}.\n"
        f"The answer is {source}. Evaluate the substance only: never penalise accent, grammar, speaking speed, filler words or transcription artifacts. "
        "Do not infer personality, confidence or emotion. Be specific and constructive. "
        "The example_answer is a suggested strong response written for learning; do not invent facts about the candidate's experience — "
        "where personal experience is needed, describe what to include (e.g. 'describe a project where you…').\n\n"
        f"QUESTION: {req.question}\n\nCANDIDATE ANSWER:\n{req.transcript}\n\n"
        f"{_context(req.resume_text, req.job_description, req.target_role, '', '')}\n\n"
        "Reply with JSON: {\"score\": integer 0-10, \"strengths\": [string], \"missing_concepts\": [string], \"inaccuracies\": [string], "
        "\"clarity\": string, \"improvements\": [string], \"example_answer\": string, \"revise\": [string], \"follow_up\": string}"
    )
    return _ask_json(prompt, _evaluation_validator, "answer evaluation")


# --------------------------------------------------------------------------- learning content


class LearnRequest(_Model):
    question: str = Field(..., min_length=5, max_length=1000)
    category: str = Field(..., max_length=60)
    difficulty: Difficulty
    target_role: str = Field(default="", max_length=120)
    job_description: str = Field(default="", max_length=20000)
    partial_transcript: str = Field(default="", max_length=12000)


def _learning_validator(data: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(data, dict):
        return None
    out = {
        "why_it_matters": _text(data.get("why_it_matters"), 800),
        "concepts": _str_list(data.get("concepts"), 8, 200),
        "example_answer": _text(data.get("example_answer"), 3500),
        "simple_explanation": _text(data.get("simple_explanation"), 1500),
        "practical_example": _text(data.get("practical_example"), 1500),
        "key_points": _str_list(data.get("key_points"), 8, 300),
        "follow_up_question": _text(data.get("follow_up_question"), 400),
    }
    required = ["why_it_matters", "example_answer", "simple_explanation", "follow_up_question"]
    return out if all(out[k] for k in required) and out["concepts"] and out["key_points"] else None


@router.post("/learn")
def learning_content(req: LearnRequest):
    _require_gemini()
    partial = f"\nThe candidate started answering with: \"{req.partial_transcript[:2000]}\" — address any gaps it shows.\n" if req.partial_transcript.strip() else ""
    prompt = (
        "A student skipped this interview question because they did not know how to answer it. Teach it.\n"
        f"Category: {req.category}. Difficulty: {req.difficulty}. Target role: {req.target_role or 'not specified'}.\n"
        f"QUESTION: {req.question}\n{partial}"
        + (f"\nJOB DESCRIPTION (for relevance only):\n{req.job_description[:6000]}\n" if req.job_description else "")
        + "\nBe technically correct and concrete. The example_answer is a SUGGESTED response for learning; never claim the candidate did anything — "
        "where personal experience is needed, show the structure to use instead.\n"
        "Reply with JSON: {\"why_it_matters\": string, \"concepts\": [string], \"example_answer\": string, \"simple_explanation\": string, "
        "\"practical_example\": string, \"key_points\": [string], \"follow_up_question\": string}"
    )
    return _ask_json(prompt, _learning_validator, "learning answer")


# --------------------------------------------------------------------------- session summary


class SummaryItem(_Model):
    question: str = Field(..., max_length=1000)
    category: str = Field(default="", max_length=60)
    status: str = Field(..., max_length=30)
    score: Optional[int] = Field(default=None, ge=0, le=10)
    strengths: List[str] = Field(default_factory=list, max_length=10)
    improvements: List[str] = Field(default_factory=list, max_length=10)
    missing_concepts: List[str] = Field(default_factory=list, max_length=10)


class SummaryRequest(_Model):
    category: str = Field(..., max_length=60)
    difficulty: Difficulty
    target_role: str = Field(default="", max_length=120)
    items: List[SummaryItem] = Field(..., min_length=1, max_length=20)


def _frequent(lists: List[List[str]], limit: int) -> List[str]:
    counts: Dict[str, int] = {}
    for items in lists:
        for item in items:
            counts[item] = counts.get(item, 0) + 1
    return [k for k, _ in sorted(counts.items(), key=lambda kv: -kv[1])][:limit]


@router.post("/summary")
def session_summary(req: SummaryRequest):
    evaluated = [i for i in req.items if i.status == "answered" and i.score is not None]
    skipped = [i for i in req.items if i.status == "skipped_for_learning"]
    # Deterministic summary from the per-answer feedback (used when Gemini fails).
    derived = {
        "strengths": _frequent([i.strengths for i in evaluated], 4),
        "improvements": _frequent([i.improvements for i in evaluated], 4),
        "recommendations": _frequent([i.missing_concepts for i in evaluated], 4)
        + [f"Study the skipped question: {i.question[:140]}" for i in skipped[:3]],
        "ai_used": False,
    }
    if not _configured() or not evaluated and not skipped:
        return derived
    prompt = (
        "Summarise a completed practice interview for a student. Use ONLY the per-question feedback below. "
        "Do not invent results, do not infer personality or emotion, and do not compute a score.\n"
        f"Category: {req.category}. Difficulty: {req.difficulty}. Target role: {req.target_role or 'not specified'}.\n"
        f"ITEMS: {[i.model_dump() for i in req.items]}\n"
        'Reply with JSON: {"strengths": [string], "improvements": [string], "recommendations": [string]} — up to 4 items each; '
        "recommendations are concrete study actions, including topics behind skipped questions."
    )

    def validate(data: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(data, dict):
            return None
        out = {k: _str_list(data.get(k), 4, 300) for k in ("strengths", "improvements", "recommendations")}
        return {**out, "ai_used": True} if any(out.values()) else None

    try:
        return _ask_json(prompt, validate, "session summary")
    except HTTPException:
        return derived
