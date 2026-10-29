"""RoleFit-AI backend.

Production-oriented FastAPI service for resume parsing, ATS analysis,
semantic matching, resume optimization, DOCX generation and mock interviews.
The public API routes are kept compatible with the existing RoleFit-AI frontend.
"""

from __future__ import annotations

import hmac
import io
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.request
import asyncio
from urllib.parse import quote

import websockets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from app.generate_helpers import build_docx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_VERSION = "4.1.0"
SERVICE_NAME = "RoleFit-AI"
DEFAULT_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")
GEMINI_VOICE = os.getenv("GEMINI_VOICE", "Aoede")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "50000"))
AI_TIMEOUT = int(os.getenv("AI_TIMEOUT_SECONDS", "45"))

DEFAULT_CORS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://ameercoder22.github.io",
    "https://ameercoder22.github.io/RoleFit-AI",
]
CORS_ORIGINS = [x.strip() for x in os.getenv("CORS_ORIGINS", "").split(",") if x.strip()] or DEFAULT_CORS

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("rolefit")

# ---------------------------------------------------------------------------
# AI runtime state
# ---------------------------------------------------------------------------

_embedding_model = None
_embedding_error: Optional[str] = None
_embedding_lock = threading.Lock()


def get_embedding_model():
    """Load the embedding model once, safely across concurrent requests."""
    global _embedding_model, _embedding_error
    if _embedding_model is not None:
        return _embedding_model
    with _embedding_lock:
        if _embedding_model is not None:
            return _embedding_model
        try:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model: %s", DEFAULT_EMBEDDING_MODEL)
            _embedding_model = SentenceTransformer(DEFAULT_EMBEDDING_MODEL)
            _embedding_error = None
            logger.info("Embedding model ready: %s", DEFAULT_EMBEDDING_MODEL)
        except Exception as exc:  # optional AI dependency/model availability
            _embedding_error = f"{type(exc).__name__}: {exc}"
            logger.warning("Embedding model unavailable; using deterministic fallback: %s", _embedding_error)
    return _embedding_model


def embedding_status() -> Dict[str, Any]:
    return {
        "ready": _embedding_model is not None,
        "model": DEFAULT_EMBEDDING_MODEL,
        "fallback_active": _embedding_model is None,
        "error": _embedding_error if _embedding_model is None else None,
    }


def gemini_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip())



@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fast start: do NOT load SentenceTransformer during startup.
    # The model is loaded lazily by semantic_similarity() on the first
    # Analyzer request, then cached for all later requests. Monk Live,
    # resume parsing and DOCX generation do not depend on this warm-up.
    logger.info(
        "%s v%s started | embedding=lazy | gemini_live_configured=%s",
        SERVICE_NAME,
        APP_VERSION,
        gemini_configured(),
    )
    yield
    logger.info("%s shutting down", SERVICE_NAME)


app = FastAPI(
    title=SERVICE_NAME,
    version=APP_VERSION,
    description="AI-assisted resume matching, ATS analysis, optimization and mock interviews.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Internal service authentication
# ---------------------------------------------------------------------------
# In the MERN architecture this service is internal: only the Express API calls
# it. When AI_SERVICE_TOKEN is set, every /api/* route (except health) and the
# live WebSocket require the X-Internal-Token header, so the browser cannot
# bypass Express authentication and ownership checks.

INTERNAL_TOKEN = os.getenv("AI_SERVICE_TOKEN", "").strip()
PUBLIC_PATHS = {"/", "/api/health", "/api/health/ready", "/docs", "/redoc", "/openapi.json"}


def internal_token_ok(provided: Optional[str]) -> bool:
    if not INTERNAL_TOKEN:
        return True
    return bool(provided) and hmac.compare_digest(provided, INTERNAL_TOKEN)


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    if request.url.path not in PUBLIC_PATHS and request.method != "OPTIONS":
        if not internal_token_ok(request.headers.get("x-internal-token")):
            return JSONResponse(status_code=401, content={"detail": "Missing or invalid internal service token"})
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "The server could not complete the request.",
            "path": request.url.path,
        },
    )


# ---------------------------------------------------------------------------
# Gemini Live interview bridge
# ---------------------------------------------------------------------------


def _live_system_prompt(resume_text: str, job_description: str, questions: List[Dict[str, Any]]) -> str:
    question_lines = "\n".join(
        f"{i+1}. [{q.get('round','Interview')}] {q.get('question','')}"
        for i, q in enumerate(questions[:12])
    )
    return f"""
You are the RoleFit-AI Mock Interviewer, a live AI interviewer inside RoleFit-AI.
Conduct a professional technical interview with natural, concise spoken responses.
This is a REAL-TIME voice interview. You MUST speak every question aloud using your native audio output. Listen continuously to the candidate microphone audio, use the input transcription to understand the answer, and respond with native audio. Never rely on browser text-to-speech. Allow natural interruption and do not wait for a submit button.

RULES:
- Ask exactly the 12 supplied questions, in order.
- Ask one question at a time.
- The supplied questions are personalized from the candidate resume and target job.
- After an answer, acknowledge briefly and continue to the next supplied question.
- Never invent candidate experience, skills, employers, projects, dates, or results.
- If an answer is unclear, ask at most one short clarification, then continue.
- Never announce scores during the interview.
- After Question 12 is answered, thank the candidate and say the interview is complete.
- Keep spoken responses concise; this is a live interview, not a text chat.

CANDIDATE RESUME:
{resume_text[:30000]}

TARGET JOB:
{job_description[:20000]}

THE 12 QUESTIONS:
{question_lines}
""".strip()


@app.websocket("/ws/monk-live")
async def monk_live(websocket: WebSocket):
    """Server-side browser <-> Gemini Live bridge.

    The Gemini API key remains server-side. The browser sends 16-bit PCM
    microphone chunks over the local RoleFit WebSocket; Gemini returns native
    audio plus input/output transcriptions. Gemini's automatic VAD handles
    natural turn-taking and interruption.
    """
    if not internal_token_ok(websocket.headers.get("x-internal-token")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        await websocket.send_json({"type": "error", "message": "Gemini Live is not configured. Add GEMINI_API_KEY to backend/.env and restart the backend."})
        await websocket.close(code=1008)
        return

    gemini_ws = None
    try:
        first = await websocket.receive_json()
        if first.get("type") != "start":
            await websocket.send_json({"type": "error", "message": "Mock Interview Live session must start with a start message."})
            await websocket.close(code=1008)
            return

        resume_text = str(first.get("resume_text", ""))
        job_description = str(first.get("job_description", ""))
        questions = [q for q in first.get("questions", []) if isinstance(q, dict) and q.get("question")][:12]
        if not resume_text.strip() or not job_description.strip() or len(questions) != 12:
            await websocket.send_json({"type": "error", "message": "Mock Interview requires the resume, job description, and all 12 interview questions."})
            await websocket.close(code=1008)
            return

        url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + quote(key)
        gemini_ws = await websockets.connect(
            url,
            open_timeout=30,
            ping_interval=30,
            ping_timeout=60,
            close_timeout=5,
            max_size=None,
        )

        setup = {
            "setup": {
                "model": f"models/{GEMINI_LIVE_MODEL}",
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": GEMINI_VOICE}}},
                "systemInstruction": {"parts": [{"text": _live_system_prompt(resume_text, job_description, questions)}]},
                "inputAudioTranscription": {},
                "outputAudioTranscription": {},
                "realtimeInputConfig": {
                    "automaticActivityDetection": {
                        "disabled": False,
                        "startOfSpeechSensitivity": "START_SENSITIVITY_LOW",
                        "endOfSpeechSensitivity": "END_SENSITIVITY_LOW",
                        "prefixPaddingMs": 200,
                        "silenceDurationMs": 1200,
                    }
                },
            }
        }
        await gemini_ws.send(json.dumps(setup))

        # The Live API sends setupComplete before client content is accepted.
        # Waiting for it avoids racing the first interview turn.
        setup_raw = await gemini_ws.recv()
        if isinstance(setup_raw, bytes):
            setup_raw = setup_raw.decode("utf-8", "replace")
        setup_msg = json.loads(setup_raw)
        if setup_msg.get("error"):
            err = setup_msg.get("error") or {}
            raise RuntimeError(err.get("message", "Gemini Live setup failed"))
        if "setupComplete" not in setup_msg:
            logger.warning("Gemini Live setup response did not contain setupComplete: %s", setup_msg)

        # The first model turn is explicitly instructed to ask Question 1.
        await gemini_ws.send(json.dumps({
            "clientContent": {
                "turns": [{"role": "user", "parts": [{"text": "Begin the interview now. Greet the candidate in one short sentence and ask Question 1 exactly as supplied."}]}],
                "turnComplete": True,
            }
        }))
        await websocket.send_json({"type": "ready", "model": GEMINI_LIVE_MODEL, "outputSampleRate": 24000})

        async def browser_to_gemini():
            while True:
                msg = await websocket.receive_json()
                kind = msg.get("type")
                if kind == "audio":
                    audio_b64 = msg.get("data", "")
                    if audio_b64:
                        await gemini_ws.send(json.dumps({
                            "realtimeInput": {
                                "audio": {
                                    "data": audio_b64,
                                    "mimeType": "audio/pcm;rate=16000"
                                }
                            }
                        }))
                elif kind == "text":
                    await gemini_ws.send(json.dumps({
                        "clientContent": {
                            "turns": [{"role": "user", "parts": [{"text": str(msg.get("text", ""))}]}],
                            "turnComplete": True,
                        }
                    }))
                elif kind == "close":
                    return

        async def gemini_to_browser():
            async for raw in gemini_ws:
                if isinstance(raw, bytes):
                    continue
                data = json.loads(raw)
                if data.get("error"):
                    err = data.get("error") or {}
                    await websocket.send_json({"type": "error", "message": err.get("message", "Gemini Live error")})
                    continue
                content = data.get("serverContent") or {}
                if content.get("interrupted"):
                    await websocket.send_json({"type": "interrupted"})
                if content.get("inputTranscription"):
                    t = content["inputTranscription"].get("text", "")
                    if t:
                        await websocket.send_json({"type": "user_transcript", "text": t, "replace": False})
                if content.get("outputTranscription"):
                    t = content["outputTranscription"].get("text", "")
                    if t:
                        await websocket.send_json({"type": "monk_transcript", "text": t})
                model_turn = content.get("modelTurn") or {}
                for part in model_turn.get("parts", []) or []:
                    inline = part.get("inlineData") or {}
                    audio = inline.get("data")
                    if audio:
                        await websocket.send_json({"type": "audio", "data": audio, "mimeType": inline.get("mimeType", "audio/pcm;rate=24000")})
                if content.get("turnComplete"):
                    await websocket.send_json({"type": "turn_complete"})

        browser_task = asyncio.create_task(browser_to_gemini())
        gemini_task = asyncio.create_task(gemini_to_browser())
        done, pending = await asyncio.wait(
            {browser_task, gemini_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                raise exc
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("Mock Interview Gemini Live bridge failed")
        try:
            # Do not echo exception text: connection errors can include the upstream URL.
            await websocket.send_json({"type": "error", "message": f"Gemini Live connection failed ({type(exc).__name__}). Check the AI service log and the GEMINI_LIVE_MODEL setting."})
        except Exception:
            pass
    finally:
        if gemini_ws is not None:
            try:
                await gemini_ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Text / skill utilities
# ---------------------------------------------------------------------------

KNOWN_SKILLS = [
    "python", "java", "c++", "javascript", "typescript", "react", "node.js",
    "fastapi", "django", "flask", "sql", "postgresql", "mysql", "mongodb",
    "aws", "azure", "gcp", "git", "github", "docker", "kubernetes", "ci/cd",
    "rest api", "graphql", "microservices", "machine learning", "tensorflow",
    "pytorch", "pandas", "numpy", "html", "css", "linux", "redis", "kafka",
    "terraform", "testing", "agile", "observability", "system design",
    "data structures", "algorithms", "communication", "problem solving", "llm",
    "generative ai", "gemini", "spark", "hadoop",
]

STOP_WORDS = set(
    "the and for with that this from your you are our have has will using into their "
    "they about role job work years experience skills strong looking build building "
    "developer software engineer preferred requirements responsibility responsibilities "
    "candidate ideal required qualification qualifications a an of to in on is as at be "
    "or by it its we"
    .split()
)

ALIASES = {
    "restful": "rest api",
    "rest": "rest api",
    "continuous integration": "ci/cd",
    "continuous deployment": "ci/cd",
    "amazon web services": "aws",
    "mongodb database": "mongodb",
    "node": "node.js",
}

HEADER_ALIASES = {
    "summary": "summary",
    "professional summary": "summary",
    "objective": "summary",
    "skills": "skills",
    "technical skills": "skills",
    "experience": "experience",
    "work experience": "experience",
    "professional experience": "experience",
    "employment": "experience",
    "education": "education",
    "academic background": "education",
    "projects": "projects",
    "project experience": "projects",
    "certifications": "certifications",
    "certificates": "certifications",
    "achievements": "achievements",
    "optimization notes": "optimization_notes",
}


def norm(value: str) -> str:
    value = value or ""
    value = value.lower().replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+#./\- ]", " ", value)).strip()


def skill_pattern(skill: str) -> str:
    escaped = re.escape(skill.lower())
    # Avoid false positives such as Java being found inside JavaScript.
    return rf"(?<![a-z0-9+#]){escaped}(?![a-z0-9+#])"


def contains_skill(normalized_text: str, skill: str) -> bool:
    aliases = {
        "node.js": r"node(?:\.js)?",
        "c++": r"c\+\+",
        "rest api": r"rest(?:ful)?\s+apis?",
    }
    pattern = aliases.get(skill, skill_pattern(skill))
    return re.search(pattern, normalized_text, re.IGNORECASE) is not None


def skills(text: str) -> List[str]:
    normalized = norm(text)
    return [skill for skill in KNOWN_SKILLS if contains_skill(normalized, skill)]


def words(text: str) -> List[str]:
    normalized = norm(text)
    tokens = []
    for token in normalized.split():
        token = token.strip("./-_")
        token = ALIASES.get(token, token)
        if len(token) > 3 and token not in STOP_WORDS:
            tokens.append(token)
    return tokens


# ---------------------------------------------------------------------------
# Resume parsing
# ---------------------------------------------------------------------------


def extract_section(text: str, name: str) -> List[str]:
    lines = text.splitlines()
    wanted = HEADER_ALIASES.get(name.lower(), name.lower())
    output: List[str] = []
    active = False
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        low = re.sub(r"[:\-]+$", "", line.lower()).strip()
        current = HEADER_ALIASES.get(low)
        if current == wanted:
            active = True
            continue
        if active and current and current != wanted:
            break
        if active and current == "optimization_notes":
            break
        if active:
            output.append(line)
    return output


def parse_resume(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    email_match = re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    phone_match = re.findall(r"(?:\+?\d[\d\s().-]{8,}\d)", text)
    linkedin = re.findall(r"(?:https?://)?(?:www\.)?linkedin\.com/[^\s|]+", text, re.I)
    github = re.findall(r"(?:https?://)?(?:www\.)?github\.com/[^\s|]+", text, re.I)
    location = next(
        (line for line in lines if re.search(
            r"Hyderabad|Bangalore|Bengaluru|Delhi|Mumbai|Pune|Kurnool|Nandyal|India",
            line,
            re.I,
        )),
        "",
    )
    return {
        "personal": {
            "name": lines[0] if lines else "Candidate",
            "email": email_match[0] if email_match else "",
            "phone": phone_match[0] if phone_match else "",
            "location": location,
            "linkedin": linkedin[0] if linkedin else "",
            "github": github[0] if github else "",
        },
        "skills": skills(text),
        "education": extract_section(text, "education"),
        "experience": extract_section(text, "experience"),
        "projects": extract_section(text, "projects"),
        "certifications": extract_section(text, "certifications"),
        "summary": " ".join(extract_section(text, "summary")),
    }


def validate_text(value: str, field_name: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    if len(value) > MAX_TEXT_CHARS:
        raise ValueError(f"{field_name} exceeds the {MAX_TEXT_CHARS:,} character limit")
    return value


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class AnalyzeRequest(StrictModel):
    resume_text: str = Field(..., min_length=1)
    job_description: str = Field(..., min_length=1)

    @field_validator("resume_text", "job_description")
    @classmethod
    def validate_content(cls, value: str) -> str:
        return validate_text(value, "Text")


class OptimizeRequest(AnalyzeRequest):
    selected_recommendations: List[str] = Field(default_factory=list, max_length=20)


class GenerateRequest(StrictModel):
    resume_text: str = Field(..., min_length=1)
    template: str = "minimal"
    filename: str = "Resume"

    @field_validator("resume_text")
    @classmethod
    def validate_resume(cls, value: str) -> str:
        return validate_text(value, "Resume")

    @field_validator("template")
    @classmethod
    def normalize_template(cls, value: str) -> str:
        return (value or "minimal").strip().lower()


class InterviewStartRequest(AnalyzeRequest):
    pass


class InterviewEvaluateRequest(StrictModel):
    question: str = Field(..., min_length=1, max_length=10000)
    answer: str = Field(..., min_length=1, max_length=20000)
    resume_text: str = Field(..., min_length=1)
    job_description: str = Field(..., min_length=1)
    round_name: str = Field(default="Technical", max_length=100)
    vision_metrics: Dict[str, Any] = Field(default_factory=dict)


class InterviewFinalRequest(StrictModel):
    resume_text: str = Field(..., min_length=1)
    job_description: str = Field(..., min_length=1)
    history: List[Dict[str, Any]] = Field(default_factory=list, max_length=30)


# ---------------------------------------------------------------------------
# Analysis engine
# ---------------------------------------------------------------------------


def semantic_similarity(a: str, b: str) -> Tuple[int, str]:
    """Return score plus method so the UI/API can report whether embeddings ran."""
    model = get_embedding_model()
    if model is not None:
        try:
            texts = [(a or "")[:12000], (b or "")[:12000]]
            vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            score = round(max(0, min(100, float(vectors[0] @ vectors[1]) * 100)))
            return score, "embedding"
        except Exception as exc:
            logger.warning("Embedding inference failed; falling back: %s", exc)

    a_words, b_words = set(words(a)), set(words(b))
    score = round(100 * (2 * len(a_words & b_words) / max(1, len(a_words) + len(b_words))))
    return max(0, min(100, score)), "deterministic_fallback"


def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    resume = req.resume_text
    job = req.job_description
    parsed = parse_resume(resume)
    job_skills = skills(job)
    resume_skills = set(parsed["skills"])
    matched = [skill for skill in job_skills if skill in resume_skills]
    missing = [skill for skill in job_skills if skill not in resume_skills]

    job_keywords = list(dict.fromkeys(words(job)))[:60]
    normalized_resume = norm(resume)
    covered = [keyword for keyword in job_keywords if re.search(skill_pattern(keyword), normalized_resume)]
    keyword_coverage = round(len(covered) / max(1, len(job_keywords)) * 100)

    semantic, semantic_method = semantic_similarity(resume, job)
    skill_coverage = round(len(matched) / max(1, len(job_skills)) * 100)
    # Transparent 0-100 role-match score. The score is deterministic so the
    # same resume + JD produces the same result. It combines semantic relevance,
    # required-skill coverage and JD keyword coverage; it is not a claim of
    # hiring probability.
    semantic_points = round(semantic * 0.40)
    skill_points = round(skill_coverage * 0.40)
    keyword_points_match = round(keyword_coverage * 0.20)
    match_score = max(0, min(100, semantic_points + skill_points + keyword_points_match))

    section_names = ["experience", "education", "projects", "skills"]
    section_count = sum(bool(parsed.get(section)) for section in section_names)
    contact_score = (5 if parsed["personal"]["email"] else 0) + (5 if parsed["personal"]["phone"] else 0)

    formatting_issues: List[str] = []
    if re.search(r"\|.+\|", resume):
        formatting_issues.append("Possible table or multi-column layout detected")
    if re.search(r"\[[^\]]+\]\([^\)]+\)", resume):
        formatting_issues.append("Markdown links may not parse consistently in ATS")
    if len(resume) < 700:
        formatting_issues.append("Resume is short; add evidence, context and quantified impact where truthful")
    if len(resume) > 6500:
        formatting_issues.append("Resume is long; consider tightening low-value content")

    formatting_score = max(0, 20 - len(formatting_issues) * 5)
    keyword_points = round(keyword_coverage * 0.25)
    section_points = round(section_count / 4 * 15)
    content_points = min(10, round(len(resume) / 350))
    relevance_points = round(match_score * 0.10)
    ats_score = min(100, keyword_points + section_points + formatting_score + contact_score + 10 + content_points + relevance_points)

    issues = formatting_issues[:]
    issues += [f"{skill} is missing from the resume" for skill in missing[:6]]
    if not parsed["personal"]["email"]:
        issues.append("Email address not detected")
    if not parsed["personal"]["phone"]:
        issues.append("Phone number not detected")

    recommendations = [
        {
            "id": "skill-" + skill.replace(" ", "-").replace("/", "-"),
            "title": f"Add {skill}",
            "detail": f"Include {skill} only if you genuinely have experience with it. Mirror the job wording in a relevant skills/project/experience bullet.",
            "type": "skill",
        }
        for skill in missing[:6]
    ]
    recommendations += [
        {"id": "quantify", "title": "Quantify impact", "detail": "Add real metrics to strong experience/project bullets where available.", "type": "content"},
        {"id": "ats-format", "title": "Use ATS-safe structure", "detail": "Prefer standard headings, single-column text and consistent bullet formatting.", "type": "format"},
        {"id": "mirror", "title": "Mirror relevant JD language", "detail": "Use the job description terminology for skills you already demonstrate.", "type": "keyword"},
        {"id": "testing", "title": "Strengthen evidence", "detail": "Mention testing, reliability or deployment evidence when it is genuinely present.", "type": "content"},
    ]

    return {
        "resume": parsed,
        "job": {"skills": job_skills, "keywords": job_keywords},
        "match_score": max(0, min(100, match_score)),
        "ats_score": max(0, min(100, ats_score)),
        "keyword_coverage": keyword_coverage,
        "semantic_similarity": semantic,
        "semantic_method": semantic_method,
        "skill_coverage": skill_coverage,
        "match_breakdown": {
            "Semantic Relevance": {"score": semantic, "weight": 40, "points": semantic_points},
            "Required Skills": {"score": skill_coverage, "weight": 40, "points": skill_points},
            "JD Keywords": {"score": keyword_coverage, "weight": 20, "points": keyword_points_match},
            "formula": "(Semantic × 40%) + (Required Skills × 40%) + (JD Keywords × 20%)"
        },
        "matched_skills": matched,
        "missing_skills": missing,
        "weak_keywords": [keyword for keyword in job_keywords if keyword not in normalized_resume][:15],
        "ats_breakdown": {
            "Keyword Coverage": f"{keyword_points}/25",
            "Formatting": f"{formatting_score}/20",
            "Sections": f"{section_points}/15",
            "Contact Information": f"{contact_score}/10",
            "Section Structure": "10/10",
            "Content Quality": f"{content_points}/10",
            "Job Relevance": f"{relevance_points}/10",
        },
        "issues": issues,
        "recommendations": recommendations,
    }


# ---------------------------------------------------------------------------
# Health / system endpoints
# ---------------------------------------------------------------------------


@app.get("/")
def root():
    return {"service": SERVICE_NAME, "version": APP_VERSION, "status": "online", "docs": "/docs"}


@app.get("/api/health")
def health():
    embedding = embedding_status()
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "embedding_model": DEFAULT_EMBEDDING_MODEL,
        "embedding_ready": embedding["ready"],
        "embedding_method": "sentence-transformers" if embedding["ready"] else "deterministic-fallback",
        "gemini_live_configured": gemini_configured(),
        "limits": {"max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024), "max_text_chars": MAX_TEXT_CHARS},
    }


@app.get("/api/health/ready")
def readiness():
    # API remains usable with deterministic fallbacks, so readiness means the
    # service itself is ready, while AI component status is reported separately.
    return {"status": "ready", "service": SERVICE_NAME, "ai": {"embedding": embedding_status(), "providers": {"gemini_live": gemini_configured(), "gemini_text": gemini_configured()}}}


# ---------------------------------------------------------------------------
# Resume endpoints
# ---------------------------------------------------------------------------


async def read_upload_safely(file: UploadFile) -> bytes:
    if not file.filename:
        raise HTTPException(status_code=400, detail="A resume filename is required")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Resume file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded resume is empty")
    return data


@app.post("/api/resume/generate")
async def generate_resume_endpoint(request: Request):
    """Generate an editable DOCX using one of the RoleFit template renderers."""
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON request") from exc

    resume_text = str(payload.get("resume_text", "")).strip()
    template = str(payload.get("template", "jake")).strip().lower() or "jake"
    filename = Path(str(payload.get("filename", "RoleFit_AI_Resume"))).stem or "RoleFit_AI_Resume"
    allowed = {"jake", "faangpath", "awesome", "rendercv", "deedy", "classic", "modern", "engineering", "alta"}
    if template not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown template: {template}")
    if not resume_text:
        raise HTTPException(status_code=422, detail="Resume text is required")

    try:
        document = build_docx(resume_text, template)
        return Response(
            content=document.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}_{template}.docx"'},
        )
    except Exception as exc:
        logger.exception("DOCX generation failed")
        raise HTTPException(status_code=500, detail=f"DOCX generation failed: {exc}") from exc


@app.post("/api/resume/parse")
async def parse_resume_endpoint(file: UploadFile = File(...)):
    data = await read_upload_safely(file)
    name = Path(file.filename or "").name
    extension = Path(name).suffix.lower()
    try:
        if extension == ".pdf":
            try:
                import fitz  # PyMuPDF; imported lazily so the service runs even if it cannot load
            except Exception as exc:
                logger.warning("PyMuPDF unavailable: %s", exc)
                raise HTTPException(status_code=503, detail="PDF import is unavailable on this server (PyMuPDF could not be loaded). Upload DOCX or TXT instead.") from exc
            with fitz.open(stream=data, filetype="pdf") as document:
                text = "\n".join(page.get_text() for page in document)
        elif extension == ".docx":
            from docx import Document

            document = Document(io.BytesIO(data))
            text = "\n".join(paragraph.text for paragraph in document.paragraphs)
            # Include table content because many resumes use tables for skills/contact data.
            for table in document.tables:
                for row in table.rows:
                    text += "\n" + " | ".join(cell.text.strip() for cell in row.cells)
        elif extension in {".txt", ".md"}:
            text = data.decode("utf-8-sig", "ignore")
        else:
            raise HTTPException(status_code=415, detail="Unsupported resume format. Use PDF, DOCX, TXT or MD.")

        text = text.strip()
        if not text:
            raise HTTPException(status_code=422, detail="The uploaded file contains no readable text")
        if len(text) > MAX_TEXT_CHARS:
            raise HTTPException(status_code=422, detail="Extracted resume text exceeds the configured limit")
        return {"text": text, "structured": parse_resume(text)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Resume parsing failed for %s: %s", name, exc)
        raise HTTPException(status_code=400, detail="Could not parse the uploaded resume") from exc


@app.post("/api/analyze")
def analyze_endpoint(req: AnalyzeRequest):
    return analyze(req)


@app.post("/api/optimize")
def optimize_endpoint(req: OptimizeRequest):
    """Apply only the user-selected resume recommendations.

    Gemini is used when available; a safe no-invention fallback returns the
    original resume and fresh analysis instead of failing the request.
    """
    selected = [str(x).strip() for x in req.selected_recommendations if str(x).strip()]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one optimization recommendation")

    prompt = (
        "Rewrite the candidate resume using ONLY truthful information already present in the resume. "
        "Apply ONLY the selected recommendations. Never invent skills, employers, dates, metrics, projects, "
        "certifications, responsibilities or achievements. Preserve contact details and factual content. "
        "Return JSON with exactly: optimized_text (string). Keep standard ATS-friendly headings and plain text.\n\n"
        f"SELECTED RECOMMENDATIONS:\n{json.dumps(selected, ensure_ascii=False)}\n\n"
        f"TARGET JOB:\n{req.job_description}\n\n"
        f"CURRENT RESUME:\n{req.resume_text}"
    )
    raw, error = call_gemini_text(prompt)
    parsed = extract_json_object(raw or "")
    optimized_text = parsed.get("optimized_text", "") if isinstance(parsed, dict) else ""
    if not isinstance(optimized_text, str) or not optimized_text.strip():
        optimized_text = req.resume_text
        fallback_reason = error or "Gemini returned no usable optimized resume"
    else:
        optimized_text = optimized_text.strip()
        fallback_reason = None

    optimized_req = AnalyzeRequest(resume_text=optimized_text, job_description=req.job_description)
    optimized_analysis = analyze(optimized_req)
    return {
        "optimized_text": optimized_text,
        "text": optimized_text,
        "analysis": optimized_analysis,
        "selected_recommendations": selected,
        "ai_used": bool(isinstance(parsed, dict) and optimized_text != req.resume_text),
        "fallback_reason": fallback_reason,
    }


# ---------------------------------------------------------------------------
# Gemini text integration
# ---------------------------------------------------------------------------


def extract_json_object(raw: str) -> Optional[Any]:
    if not raw:
        return None
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.I | re.M)
    for opener, closer in [("[", "]"), ("{", "}")]:
        start, end = cleaned.find(opener), cleaned.rfind(closer)
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


def call_gemini_text(prompt: str) -> Tuple[Optional[str], Optional[str]]:
    """Call Gemini text generation for question/evaluation tasks."""
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return None, "GEMINI_API_KEY is not configured"
    import urllib.request
    import urllib.error
    import json as _json
    model = os.getenv("GEMINI_TEXT_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={quote(key)}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}
    }
    req = urllib.request.Request(url, data=_json.dumps(payload).encode("utf-8"), headers={"Content-Type":"application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=AI_TIMEOUT) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
        return text or None, None if text else "Gemini returned no text"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:1000]
        return None, f"Gemini HTTP {exc.code}: {detail}"
    except Exception as exc:
        return None, f"Gemini request failed: {exc}"


def fallback_questions(resume: str, job_description: str) -> List[Dict[str, str]]:
    target = list(dict.fromkeys(skills(job_description) + skills(resume)))
    questions = [
        {"round": "Introduction", "difficulty": "Easy", "question": "Give me a 60-second introduction focused on the experience most relevant to this role."},
        {"round": "Resume Deep Dive", "difficulty": "Medium", "question": "Pick the project on your resume most relevant to this job. Explain the architecture, your contribution, one challenge and the result."},
        {"round": "Technical", "difficulty": "Medium", "question": "Explain the most important technical concept in this role that you are comfortable discussing, and give a concrete example from your work."},
        {"round": "Technical", "difficulty": "Medium", "question": "Walk through how you would debug a production API that suddenly became slow and started returning intermittent errors."},
        {"round": "Technical", "difficulty": "Medium", "question": "How would you design a reliable REST API for this role? Cover validation, errors, authentication and observability."},
        {"round": "Resume Deep Dive", "difficulty": "Medium", "question": "Choose one bullet from your resume and explain exactly what you personally implemented, including the trade-offs you considered."},
        {"round": "Behavioral/System Design", "difficulty": "Medium", "question": "Tell me about a difficult technical problem you faced. How did you investigate it and what did you learn?"},
        {"round": "Behavioral/System Design", "difficulty": "Hard", "question": "Design a scalable backend service for this role. Cover API design, database choice, caching, observability and failure handling."},
        {"round": "Technical", "difficulty": "Medium", "question": "If a SQL query is slow in production, how would you investigate it and what changes might improve it?"},
        {"round": "Technical", "difficulty": "Medium", "question": "Explain how you would deploy a backend service with Docker and keep it reliable as traffic grows."},
        {"round": "Behavioral/System Design", "difficulty": "Medium", "question": "Describe a time you had to learn a technology quickly. How did you validate that your solution actually worked?"},
        {"round": "Closing", "difficulty": "Medium", "question": "Why are you a strong fit for this role, and what would you want to learn in your first 90 days?"},
    ]
    if "sql" in target:
        questions[2] = {"round": "Technical", "difficulty": "Medium", "question": "Write a SQL query to return the second-highest salary from an employees table and explain your approach."}
    elif "python" in target:
        questions[2] = {"round": "Technical", "difficulty": "Medium", "question": "In Python, compare lists, tuples and sets and explain when you would choose each."}
    elif "fastapi" in target:
        questions[2] = {"round": "Technical", "difficulty": "Medium", "question": "How would you design a FastAPI endpoint with validation, authentication and consistent error handling?"}
    return questions


@app.post("/api/interview/start")
def interview_start(req: InterviewStartRequest):
    prompt = (
        "Create a realistic mock interview for a candidate based ONLY on their resume and target job. "
        "Return JSON array of 12 questions across these rounds: Introduction, Resume Deep Dive, "
        "Technical, Behavioral/System Design, Closing. Mix easy, medium and hard. Technical questions must "
        "use skills actually present in the resume or explicitly required by the job; include practical "
        "questions such as SQL queries when SQL is relevant. Do not ask about invented experience. "
        "Each item must contain: round,difficulty,question.\n\n"
        f"RESUME:\n{req.resume_text}\n\nJOB:\n{req.job_description}"
    )
    raw, error = call_gemini_text(prompt)
    questions = None
    if raw:
        parsed = extract_json_object(raw)
        if isinstance(parsed, list):
            questions = [item for item in parsed if isinstance(item, dict) and item.get("question")]
    # ai_used is true only when Gemini actually supplied the full question set.
    ai_used = len(questions or []) == 12
    if not ai_used:
        if raw and not error:
            error = "Gemini returned an incomplete question set; template questions were used"
        questions = fallback_questions(req.resume_text, req.job_description)
    questions = questions[:12]
    first = questions[0]
    return {
        "question": first["question"],
        "round": first.get("round", "Introduction"),
        "difficulty": first.get("difficulty", "Medium"),
        "progress": 1,
        "total": len(questions),
        "index": 0,
        "questions": questions,
        "rounds": ["Introduction", "Resume Deep Dive", "Technical", "Behavioral/System Design", "Closing"],
        "ai_used": ai_used,
        "fallback_reason": None if ai_used else error,
    }


# Browser vision metric key -> report label. Values are only used when the
# browser actually measured them; missing signals are never treated as 0.
PRESENTATION_KEYS = {
    "communication": "Communication",
    "facial": "Facial_Engagement",
    "eyeContact": "Eye_Contact",
    "posture": "Body_Language",
    "bodyMovement": "Delivery",
}


def _metric(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return max(0, min(100, round(number)))


def _measured_presentation(vision: Dict[str, Any]) -> Dict[str, int]:
    out = {}
    for key, label in PRESENTATION_KEYS.items():
        value = _metric((vision or {}).get(key))
        if value is not None:
            out[label] = value
    return out


@app.post("/api/interview/evaluate")
def interview_evaluate(req: InterviewEvaluateRequest):
    measured = _measured_presentation(req.vision_metrics)
    prompt = (
        "Evaluate this interview answer. Score the answer itself from 0-100 using correctness, relevance, depth, clarity and role alignment. "
        "Do not infer personality, intelligence, honesty, health, attractiveness or emotion. "
        "Return JSON with score (integer), feedback (string, 1-3 sentences), improvement (string, 1-2 sentences). "
        "Base feedback only on the answer text; the answer is a live speech transcript and may contain transcription errors."
        f"\nROUND:{req.round_name}\nQUESTION:{req.question}\nANSWER:{req.answer}\n"
        f"RESUME:{req.resume_text}\nJOB:{req.job_description}"
    )
    raw, error = call_gemini_text(prompt)
    result = extract_json_object(raw or "")
    ai_used = isinstance(result, dict) and _metric(result.get("score")) is not None

    if not ai_used:
        # Transparent heuristic fallback (clearly flagged via ai_used=false).
        answer = req.answer.strip()
        question = req.question.lower()
        score = 45 if len(answer) > 40 else 20
        technical_terms = sum(1 for skill in set(skills(req.resume_text) + skills(req.job_description)) if contains_skill(norm(answer), skill))
        score = min(95, score + technical_terms * 8 + min(20, len(answer) // 120) * 5)
        if any(term in question for term in ["sql", "query"]):
            score = min(95, score + (10 if re.search(r"\bselect\b|\bjoin\b|\bwhere\b", answer, re.I) else 0))
        result = {
            "score": score,
            "feedback": "Estimated without AI from answer length and the role-relevant skills you mentioned.",
            "improvement": "Add a concrete example from your own work and explain your reasoning step by step.",
        }

    return {
        "score": _metric(result.get("score")) or 0,
        "feedback": str(result.get("feedback", ""))[:2000],
        "improvement": str(result.get("improvement", ""))[:2000],
        # Presentation values are the browser's own measurements, passed through unchanged.
        "presentation": measured,
        "ai_used": ai_used,
        "fallback_reason": None if ai_used else error,
    }


FINAL_WEIGHTS = [
    # (component, weight %, source)
    ("answer_technical_quality", 40, "score"),
    ("communication", 25, "communication"),
    ("facial_expression", 15, "facial"),
    ("body_language", 10, "posture"),
    ("response_delivery", 10, "bodyMovement"),
]


def _weighted_components(history: List[Dict[str, Any]]) -> Tuple[Optional[int], Dict[str, Any], List[str]]:
    """Deterministic overall score. Components without any measurement are
    excluded and the remaining weights are re-normalized (reported back)."""
    components: Dict[str, Any] = {}
    unavailable: List[str] = []
    total_weight = 0.0
    weighted = 0.0
    for name, weight, source in FINAL_WEIGHTS:
        if source == "score":
            values = [_metric(item.get("score")) for item in history if isinstance(item, dict)]
        else:
            values = [_metric((item.get("vision") or {}).get(source)) for item in history if isinstance(item, dict)]
        values = [v for v in values if v is not None]
        score = round(sum(values) / len(values)) if values else None
        components[name] = {"weight": weight, "score": score, "samples": len(values)}
        if score is None:
            unavailable.append(name)
        else:
            total_weight += weight
            weighted += weight * score
    overall = round(weighted / total_weight) if total_weight else None
    return overall, components, unavailable


@app.post("/api/interview/final")
def interview_final(req: InterviewFinalRequest):
    compact = [item for item in req.history[:16] if isinstance(item, dict)]
    overall, components, unavailable = _weighted_components(compact)
    answers = [{k: item.get(k) for k in ("round", "question", "answer", "score")} for item in compact]
    prompt = (
        "Review this completed mock interview using ONLY the submitted answers (live speech transcripts). "
        "Do not infer personality, intelligence, honesty, health, appearance or emotion, and do not compute an overall score. "
        "Return JSON with: strengths (array of up to 3 strings), improvements (array of up to 3 strings), "
        "topics (array of 3-6 strings to study next), summary (2-4 sentences). Base every point on the actual answers.\n"
        f"RESUME:\n{req.resume_text}\nJOB:\n{req.job_description}\n"
        f"ANSWERS:\n{json.dumps(answers, ensure_ascii=False)}"
    )
    raw, error = call_gemini_text(prompt)
    result = extract_json_object(raw or "")
    ai_used = isinstance(result, dict)

    if not ai_used:
        result = {
            "strengths": [item.get("feedback") for item in compact if (_metric(item.get("score")) or 0) >= 75 and item.get("feedback")][:3],
            "improvements": [item.get("improvement") for item in compact if (_metric(item.get("score")) or 0) < 75 and item.get("improvement")][:3],
            "topics": [],
            "summary": "AI review was unavailable, so this summary lists the per-answer feedback recorded during the interview.",
        }

    def strings(value: Any, limit: int) -> List[str]:
        return [str(x)[:500] for x in (value if isinstance(value, list) else []) if str(x).strip()][:limit]

    return {
        "overall_score": overall,
        "components": components,
        "unavailable_components": unavailable,
        "weighting": {name: weight for name, weight, _ in FINAL_WEIGHTS},
        "weighting_note": (
            "Components with no measurements are excluded and the remaining weights are re-normalized."
            if unavailable
            else "All weighted components were measured."
        ),
        "strengths": strings(result.get("strengths"), 3),
        "improvements": strings(result.get("improvements"), 3),
        "topics": strings(result.get("topics"), 6),
        "summary": str(result.get("summary", ""))[:2000],
        "ai_used": ai_used,
        "fallback_reason": None if ai_used else error,
    }


# ---------------------------------------------------------------------------
# Resume bullet rewrite (suggestion only)
# ---------------------------------------------------------------------------


class RewriteRequest(StrictModel):
    text: str = Field(..., min_length=5, max_length=400)
    context: str = Field(default="", max_length=200)
    job_description: str = Field(default="", max_length=20000)


@app.post("/api/ai/rewrite-bullet")
def rewrite_bullet(req: RewriteRequest):
    if not gemini_configured():
        raise HTTPException(
            status_code=503,
            detail="AI rewriting needs GEMINI_API_KEY in backend/.env. Your resume and rule-based analysis keep working without it.",
        )
    prompt = (
        "Rewrite ONE resume bullet point to be clearer and more impactful for a student or early-career candidate. "
        "STRICT RULES: keep every fact exactly as given; never add numbers, metrics, percentages, tools, technologies, "
        "responsibilities, outcomes or awards that are not in the original; do not change the meaning. "
        "Start with a strong past-tense action verb, keep it under 35 words, no first person. "
        "If the original lacks impact details, do not invent them; instead use notes to say what real detail the candidate could add. "
        "Return JSON with keys suggestion (string) and notes (string).\n"
        f"ENTRY CONTEXT: {req.context}\nTARGET JOB (for wording only, never for adding facts): {req.job_description[:4000]}\n"
        f"ORIGINAL BULLET: {req.text}"
    )
    raw, error = call_gemini_text(prompt)
    result = extract_json_object(raw or "")
    suggestion = str(result.get("suggestion", "")).strip() if isinstance(result, dict) else ""
    if not suggestion:
        logger.warning("Bullet rewrite failed: %s", error)
        raise HTTPException(status_code=502, detail="The AI did not return a usable suggestion. Please try again.")
    # Safety net: discard suggestions that introduce numbers absent from the original.
    new_numbers = set(re.findall(r"\d+(?:\.\d+)?", suggestion)) - set(re.findall(r"\d+(?:\.\d+)?", req.text))
    if new_numbers:
        raise HTTPException(
            status_code=422,
            detail="The AI suggestion introduced numbers that are not in your original bullet, so it was discarded. Try again or edit manually.",
        )
    return {"suggestion": suggestion[:400], "notes": str(result.get("notes", ""))[:400]}
