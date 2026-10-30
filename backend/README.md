# RoleFit AI — internal AI service (FastAPI)

Optional Python service used **only by the Express API** (`../server`). It is not meant to be exposed to browsers.

## Responsibilities
- **Gemini Live bridge** — `/ws/monk-live`: browser 16 kHz PCM (relayed by Express) ⇄ Gemini Live native audio, live transcription, VAD/interruption. Supports `start_index` to resume after a dropped connection.
- **Gemini text** — `/api/interview/start` (12 personalised questions), `/api/interview/evaluate`, `/api/interview/final` (deterministic weighted score + AI summary), `/api/ai/rewrite-bullet` (no new facts; suggestions adding numbers are rejected).
- **Documents** — `/api/resume/parse` (PDF/DOCX/TXT/MD), `/api/resume/generate` (7 DOCX layouts in `app/generate_helpers.py`).
- Legacy `/api/analyze` and `/api/optimize` remain available but the UI now uses the Express rule-based analyzer.

Every response that may come from a fallback includes `ai_used` and `fallback_reason`.

## Security
- Set `AI_SERVICE_TOKEN` (same value as `server/.env`). Then all `/api/*` routes except health, and the WebSocket, require `X-Internal-Token`.
- `run.py` binds to `127.0.0.1` by default. Keep it that way unless the service runs on a private network.
- The Gemini key lives only in `backend/.env`.

## Run
```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt       # core
.venv\Scripts\python -m pip install -r requirements-dev.txt   # + pytest
.venv\Scripts\python run.py                                   # http://127.0.0.1:8000/docs
.venv\Scripts\python -m pytest -q
```
`requirements-embeddings.txt` adds the optional sentence-transformers model for the legacy `/api/analyze` endpoint (Python 3.12 recommended for its pinned versions). PyMuPDF is imported lazily, so the service starts even if it cannot load; PDF parsing then returns a clear 503.
