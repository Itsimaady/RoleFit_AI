# RoleFit AI

**Build your resume. Match your goals. Practice with confidence.**

RoleFit AI is a student-focused career preparation platform. One account connects four steps that usually live in separate tools:

1. **Build** structured resumes with a live preview and three ATS-conscious templates.
2. **Match** a saved resume against a real job description, with an explainable, documented method.
3. **Improve** it using a skill-gap and resume-quality checklist (AI rewrites never add facts).
4. **Practise** a live voice mock interview (Gemini Live) personalised from the resume and job, then review per-answer feedback.

RoleFit AI helps you prepare. It does **not** guarantee interviews, ATS selection or job offers.

---

## Architecture

```
 Browser (React + Vite SPA)
   │  HTTPS, HttpOnly session cookie + CSRF header        WebSocket (cookie auth, Origin check)
   ▼                                                       ▼
 Express API  (server/)  ── primary backend ─────────────────────────────────────────────
   • auth & sessions • resumes CRUD • PDF export • rule-based job analysis
   • interview sessions & reports • dashboard • health
   │ Mongoose                         │ HTTP + X-Internal-Token        │ WS relay + X-Internal-Token
   ▼                                  ▼                                ▼
 MongoDB                     Python AI service (backend/, FastAPI, optional, localhost only)
 users, sessions, resumes,     • Gemini text: interview questions, answer evaluation, final review, bullet rewrite
 jobanalyses,                  • Gemini Live bridge (/ws/monk-live): 16 kHz mic PCM in, 24 kHz voice out
 interviewsessions             • PDF/DOCX/TXT resume parsing • 7-layout DOCX generation
                                            │
                                            ▼
                                   Google Gemini (key stays server-side)
```

### Who owns what

| Responsibility | Owner | Needs AI service? |
|---|---|---|
| Registration, login, logout, sessions, profile | Express + MongoDB | No |
| Resume create/read/update/duplicate/delete, search | Express + MongoDB | No |
| Live preview (3 templates) | React | No |
| **PDF export** (PDFKit, real text PDF) | Express | No |
| Job matching, skill gaps, quality checklist | Express (rule-based engine) | No |
| Analysis history, dashboard | Express + MongoDB | No |
| DOCX export (7 layouts) | Python (`generate_helpers.py`) via Express | Yes |
| Resume import from PDF/DOCX/TXT | Python parser via Express | Yes |
| AI bullet rewrite (suggestion only) | Python + Gemini text via Express | Yes + Gemini key |
| Interview questions, per-answer evaluation, final review | Python + Gemini text via Express | Yes + Gemini key* |
| Live voice interview | Browser ⇄ Express relay ⇄ Python bridge ⇄ Gemini Live | Yes + Gemini key |
| **Guided voice interview** — spoken questions (browser TTS), live transcription (browser `SpeechRecognition`), per-answer evaluation, learning answers, PDF report | Browser + Express + Python/Gemini text | Yes + Gemini key |
| Camera presentation signals | Browser only (MediaPipe) | No (frames never leave the browser) |

\* Without a working Gemini response the Python service falls back to template questions and rule-based estimates; every record stores `ai_used`/`aiUsed` and the UI labels these as *estimated*.

The browser **never** talks to the Python service and **never** receives the Gemini key. The AI service binds to `127.0.0.1` and rejects any `/api/*` or `/ws/*` call without the shared `AI_SERVICE_TOKEN`.

---

## Technology stack

- **Frontend:** React 19, Vite 6, React Router 7 (data router), lucide-react icons, MediaPipe Tasks Vision 1.0.1 (lazy-loaded), plain CSS design tokens with light/dark themes.
- **API:** Node.js ≥ 20, Express 5, Mongoose 8, bcryptjs, helmet, cors, express-rate-limit, cookie-parser, zod, PDFKit, ws.
- **Database:** MongoDB (Community Server or Atlas).
- **AI service (optional):** Python, FastAPI, python-docx, PyMuPDF, websockets; Gemini text + Gemini Live APIs.
- **Tests:** `node:test` + Supertest + mongodb-memory-server (real `mongod`), Vitest + Testing Library + jsdom, pytest.

## Folder structure

```
server/                 Express API (primary backend)
  src/app.js            middleware stack, routes, optional static SPA hosting
  src/server.js         HTTP server + MongoDB connect + WebSocket relay
  src/config/           env.js (all settings), db.js (connection + status)
  src/middleware/       auth (session + CSRF), validate (zod), rateLimiter, errorHandler
  src/models/           User, Session, Resume, JobAnalysis, InterviewSession
  src/routes/ controllers/ validators/
  src/services/         analysis engine, skills dictionary, quality checklist, PDF renderer,
                        resume text/import mapping, AI client, live WebSocket relay
  scripts/              dev-memory-db.js (local mongod without installing MongoDB), check-syntax.js
  tests/                65 integration/unit tests
frontend/
  src/App.jsx           route table
  src/lib/              api.js (shared client), validation.js, format.js
  src/context/          AuthContext, ToastContext
  src/components/       AppShell, RouteGuards, Brand, ui.jsx (buttons, fields, dialogs, states)
  src/pages/            Landing, Login/Register, Dashboard, Profile, NotFound
  src/features/resumes/ list, editor, section forms, live preview, model helpers
  src/features/analysis/ analysis form, result view, history
  src/features/interview/ setup, live room, report, useLiveInterview, useVisionAnalysis, audio
  src/styles/           base (tokens), components, layout, resume, features
  src/test/             30 Vitest tests
  public/pcm-capture-worklet.js   AudioWorklet microphone capture (from the original app)
backend/                Python AI service (preserved; now internal)
  app/main.py           Gemini text + Live bridge, parsing, DOCX endpoint
  app/generate_helpers.py   7 DOCX layouts
  templates/            LaTeX template sources used as layout references
  tests/                22 pytest tests
docs/history/           release notes and scripts from the pre-MERN version
```

---

## Prerequisites

- **Node.js 20+** (tested on Node 24.11) and npm.
- **MongoDB:** either MongoDB Community Server running locally, a MongoDB Atlas cluster, **or** nothing at all for a demo (see `dev:localdb` below).
- **Optional for AI features:** Python 3.12+ (tested on 3.14) and a Google Gemini API key.
- A Chromium browser (Chrome/Edge) for the live interview (AudioWorklet + getUserMedia).

## Installation

```bash
# from the repository root
npm run install:all                     # installs server/ and frontend/

# optional AI service
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt        # Windows
# .venv/bin/python -m pip install -r requirements.txt          # macOS/Linux
# optional local embeddings for the legacy /api/analyze endpoint (Python 3.12 recommended):
# .venv\Scripts\python -m pip install -r requirements-embeddings.txt
```

## Environment setup

```bash
copy server\.env.example server\.env      # macOS/Linux: cp
copy backend\.env.example backend\.env    # only if you run the AI service
```

`server/.env` (key settings):

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | e.g. `mongodb://127.0.0.1:27017/rolefit` or an Atlas `mongodb+srv://…` URI |
| `CLIENT_ORIGINS` | Allowed browser origins (CORS, CSRF Origin check, WebSocket Origin check) |
| `SESSION_TTL_HOURS` | Session lifetime (default 12) |
| `COOKIE_SAMESITE` | `lax` (default, same-site). Use `none` + HTTPS only for a cross-site frontend |
| `AI_SERVICE_URL`, `AI_SERVICE_TOKEN` | Where the Python service runs and the shared secret |
| `SERVE_CLIENT=true` | Serve `frontend/dist` from Express (single-origin production) |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so rate limits see real IPs |

`backend/.env`: `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`, `GEMINI_TEXT_MODEL`, `GEMINI_VOICE`, and **the same** `AI_SERVICE_TOKEN`. Generate a token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Never commit `.env` files (they are git-ignored). The frontend needs no `.env` for local development.

### MongoDB setup

- **Local Community Server:** install MongoDB, start the service, keep the default `MONGODB_URI`.
- **Atlas:** create a free cluster, add a database user, allow your IP, paste the SRV URI into `MONGODB_URI`.
- **No install (demo):** `npm --prefix server run dev:localdb` downloads and runs a real `mongod` (via mongodb-memory-server) on port 27018 with data stored in `server/.mongo-data/`; data survives restarts. `dev:memory` uses a throwaway database.

Indexes (unique email, TTL session expiry, owner/date indexes) are synced on startup.

### Gemini configuration

Put your key in `backend/.env` as `GEMINI_API_KEY`. `GEMINI_LIVE_MODEL` must be a model that supports the Live API with native audio for your key (the value shipped from the original project is kept as-is; check Google’s current model list if the live session fails to open). Without a key: accounts, resumes, PDF export, job matching and the dashboard work normally; DOCX export and file import work as long as the AI service is running; live interviews and AI rewrites show a clear “not configured” message instead of fake results.

## Running locally

Three terminals (or `.\start-dev.ps1` / `.\start-dev.ps1 -LocalDb` on Windows):

```bash
# 1) Express API  -> http://127.0.0.1:5000   (health: /api/health)
npm --prefix server run dev            # or: npm --prefix server run dev:localdb

# 2) React app    -> http://localhost:5173
npm --prefix frontend run dev

# 3) optional AI service -> http://127.0.0.1:8000 (internal)
cd backend && .venv\Scripts\python run.py
```

Vite proxies `/api` and `/ws` to Express, so cookies are first-party in development. Open **http://localhost:5173**.

**Production (single origin):** `npm run build`, then run Express with `NODE_ENV=production SERVE_CLIENT=true`. Express serves the SPA (with refresh-safe fallback for client routes) and the API from one origin. The GitHub Pages workflow builds with `VITE_BASE=/RoleFit-AI/` and the `VITE_API_URL` repository variable; that split deployment needs HTTPS and `COOKIE_SAMESITE=none` on the API.

### Troubleshooting

| Symptom | Fix |
|---|---|
| API exits with `MONGODB_URI is not set` | Create `server/.env` from the example, or use `dev:localdb` |
| `/api/health` returns 503 `degraded` | MongoDB is not reachable; check the URI / that `mongod` is running |
| “AI service is not running” | Start `backend/run.py`; check `AI_SERVICE_URL` |
| “AI service rejected this server” | `AI_SERVICE_TOKEN` differs between `server/.env` and `backend/.env` |
| “Gemini is not configured” | Set `GEMINI_API_KEY` in `backend/.env` and restart the AI service |
| Live session closes immediately | Check the AI service log; verify `GEMINI_LIVE_MODEL` is valid for your key |
| PDF import “unavailable” | PyMuPDF could not load (on this development machine Windows Application Control blocks its DLL). Use DOCX/TXT, or allow the DLL |
| 403 `csrf_failed` / `origin_rejected` | Open the app from an origin listed in `CLIENT_ORIGINS` |

---

## REST API

All bodies are JSON. Errors are `{ "error": { "code", "message", "details?" } }`. State-changing requests need the `X-CSRF-Token` header (from `GET /api/auth/csrf`). All resource routes are scoped to the signed-in user; another user’s ids return **404**.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | API + real MongoDB connection state (503 when disconnected) |
| GET | `/api/health/ai` | Whether the AI service is reachable and Gemini configured |
| GET | `/api/auth/csrf` | Issue CSRF token (cookie + body) |
| POST | `/api/auth/register` | `{fullName, email, password, confirmPassword}` → 201, starts session |
| POST | `/api/auth/login` | `{email, password}` |
| POST | `/api/auth/logout` | Destroys the server-side session |
| GET / PATCH | `/api/auth/me` | Current user / update name and profile |
| GET | `/api/resumes?q=&page=&limit=` | List my resumes (title search) |
| POST | `/api/resumes` | Create (only `title` required) |
| POST | `/api/resumes/import` | Multipart upload (PDF/DOCX/TXT ≤ 10 MB) → new resume for review *(AI service)* |
| GET | `/api/resumes/:id` | Read |
| PUT | `/api/resumes/:id` | Full update; requires current `revision` (409 `stale_revision` if outdated) |
| PATCH | `/api/resumes/:id` | Rename / change template |
| DELETE | `/api/resumes/:id` | Delete (204) |
| POST | `/api/resumes/:id/duplicate` | Copy |
| GET | `/api/resumes/:id/text` | Plain-text rendering |
| GET | `/api/resumes/:id/export/pdf` | PDF download |
| GET | `/api/resumes/:id/export/docx?layout=` | DOCX download *(AI service)* |
| GET | `/api/analyses?page=&limit=&resumeId=` | Analysis history |
| POST | `/api/analyses` | `{resumeId, jobDescription (80–20,000 chars), targetRole?}` → saved analysis |
| GET / DELETE | `/api/analyses/:id` | Read / delete |
| GET | `/api/interviews/availability` | Can a live interview start right now, and why not |
| GET | `/api/interviews` | Session history |
| POST | `/api/interviews` | `{resumeId, targetRole, jobDescription}` → 12 questions *(AI service + Gemini)* |
| GET / DELETE | `/api/interviews/:id` | Read (with answers + report) / delete |
| POST | `/api/interviews/:id/answers` | `{index, answer, vision}`; strictly sequential, evaluated by the AI service |
| POST | `/api/interviews/:id/complete` | Generate and store the report (needs ≥ 1 answer) |
| POST | `/api/interviews/:id/abandon` | End early |
| POST | `/api/interviews` with `mode: "guided"` | `{difficulty, category, questionCount (5/10/15/20), resumeId?, jobDescription?, targetRole?, company?, language?, durationMinutes?, visualCoaching}` → exactly `questionCount` questions *(AI service + Gemini)* |
| POST | `/api/interviews/:id/responses` | Guided: `{index, status: answered \| skipped_for_learning \| answered_but_empty \| technical_error, transcript, inputMethod, recognition, visual?}`; answered ones are evaluated (0–10) |
| POST | `/api/interviews/:id/responses/:index/evaluate` | Retry a failed evaluation |
| POST | `/api/interviews/:id/learning` | Generate missing learning answers for skipped questions and refresh the report |
| POST | `/api/interviews/:id/practice` | `{kind: "skipped" \| "weak"}` → new guided session reusing those questions |
| GET | `/api/interviews/:id/report.pdf` | Guided interview learning report (409 until learning answers exist) |
| POST | `/api/ai/rewrite-bullet` | `{text, context?, jobDescription?}` → suggestion only *(AI service + Gemini)* |
| GET | `/api/dashboard` | Counts, recent items, activity and completed-interview scores |
| WS | `/ws/interview-live?sessionId=` | Authenticated live relay (`audio`, `advance`, `repeat`, `finish`, `close`) |

Rate limits: auth 20 requests / 15 min per IP; analysis 40 / 10 min and AI routes 60 / 10 min per user; 300 / min overall per IP.

## Database models

| Collection | Purpose | Key fields / indexes |
|---|---|---|
| `users` | Accounts | `fullName`, unique lower-cased `email`, `passwordHash` (bcrypt, 12 rounds, never selected by default), `profile` |
| `sessions` | Login sessions | SHA-256 `tokenHash` (unique), `user`, `expiresAt` (TTL index auto-deletes) |
| `resumes` | Structured resumes | `owner`, `title`, `template`, `personal`, `summary`, `education[]`, `experience[]`, `projects[]`, `skills`, `certifications[]`, `achievements[]`, `links[]`, `revision`; index `{owner, updatedAt}` |
| `jobanalyses` | Saved match results | `owner`, `resume`, `resumeSnapshot`, `targetRole`, `jobDescription`, `scores`, matched/missing skills and keywords, `evidence`, `emphasize`, `suggestions`, `checklist`, `method {name, version, description}` |
| `interviewsessions` | Mock interviews | `owner`, `resume`, `targetRole`, `jobDescription`, `questions[12]`, `questionSource`, `status`, `answers[]` (transcript, score, feedback, vision averages, `aiUsed`), `report`, `startedAt`, `completedAt` |

No audio, video frames, tokens or API keys are stored.

## Authentication flow

1. The SPA calls `GET /api/auth/csrf`, which sets a readable `rf_csrf` cookie and returns the token.
2. Register/login validate input (zod), hash or compare with bcrypt, then create a session: a random 256-bit token is set as the **HttpOnly** `rf_session` cookie (`SameSite=Lax`, `Secure` in production); only its SHA-256 hash is stored in MongoDB.
3. Every request resolves the cookie to `req.user` on the server. User ids sent by the client are never trusted.
4. Non-GET requests must send `X-CSRF-Token` equal to the cookie (double-submit) and come from an allow-listed `Origin`.
5. Logout deletes the session document; expired sessions are rejected (`session_expired`) and removed by the TTL index.
6. The live WebSocket upgrade checks the Origin, the session cookie and interview ownership before relaying.

## How job matching works

`rule-based-skill-and-keyword-match v1.0.0` (deterministic):

- **Skill coverage** = skills from a ~110-entry dictionary (with aliases and technology-aware word boundaries) found in the job description that also appear somewhere in the resume ÷ all such skills in the job description. Each match cites the resume section(s) as evidence. Missing skills are classified *required* or *preferred* from the posting’s headings.
- **Keyword coverage** = share of the job description’s 20 most frequent non-skill terms (stop words removed, light stemming) found in the resume.
- These are coverage measures, **not** an ATS score and not a hiring prediction. If the posting mentions no dictionary skills, coverage is shown as “—” rather than a number.

## Testing

```bash
npm --prefix server test       # 81 tests: real mongod via mongodb-memory-server, stubbed AI service
npm --prefix frontend test     # 59 tests: Vitest + Testing Library (fetch mocked)
cd backend && .venv\Scripts\python -m pytest -q    # 44 tests (needs requirements-dev.txt)
npm run lint                   # syntax check (server) + import/export check (frontend)
npm run build                  # production build
```

Automated tests never touch your real database; each test file starts its own throwaway `mongod`.

## Verification status

| Area | Status |
|---|---|
| Registration, login, logout, session expiry, CSRF, origin checks, NoSQL injection, mass assignment | **Automated tests pass** and verified end-to-end through the Vite proxy |
| Resume CRUD, duplicate, ownership (404 for others), invalid ids, optimistic concurrency | **Automated tests pass** + end-to-end |
| Data persists after API + database restart | **Verified** (hard-killed and restarted `mongod` + API, data re-read) |
| PDF export (3 templates) | **Verified**: valid `%PDF` with extractable text; visually inspected |
| DOCX export (7 layouts) | **Verified** against the real Python service (`PK` zip, text present) |
| Job analysis + persistence + history | **Automated tests pass** + end-to-end |
| Dashboard uses real data only | **Automated tests pass** + end-to-end counts checked |
| Frontend: registration validation, editor (preview, validation, save, conflicts, entries), API error handling, mobile nav, protected routes, interview availability/report | **Vitest pass** (jsdom, mocked API) |
| Production build; Express serving the SPA with route-refresh fallback | **Verified** |
| Interview lifecycle (create, ordered answers, complete, abandon, ownership) and WebSocket relay auth/context | **Automated tests pass** against a *stubbed* AI service |
| AI service token boundary, fallbacks, weighted scoring, DOCX, TXT parsing | **pytest pass** (no Gemini key) |
| **Real Gemini text responses, real Gemini Live voice session, MediaPipe camera analysis in a browser** | **Not verified** — no Gemini key, microphone/camera or interactive browser was available during this work |
| Guided interview: configuration, question count, statuses, averages, learning answers, practice sessions, PDF | **Automated tests pass** (Express + pytest + Vitest) and a full Chrome walkthrough against the real React/Express/Mongo stack with a **stand-in** AI service and **scripted** speech APIs |
| Guided interview with real Gemini output, real microphone transcription and real TTS voices | **Not verified** on this machine (no Gemini key; headless Chrome has no usable microphone or voices) |
| PDF *import* (PyMuPDF) | **Not verified on this machine** (Windows Application Control blocked the DLL); code path unchanged from the original apart from a lazy import |
| Visual layout in real browsers at mobile/tablet/desktop widths | **Not visually verified** (responsive CSS written; navigation behaviour covered by tests) |

## Guided voice interview

The default **Mock interviews** mode. Configure difficulty (Easy/Medium/Hard), 5/10/15/20 questions, one of 12 categories (or Mixed), optional resume / job description / role / company / language / duration, and voice settings (spoken questions, voice, rate, transcription language, microphone test, optional camera coaching).

During the interview each question is shown and read aloud; listening starts only after it finishes. Your words appear live (interim text in grey). Pauses do not end the answer — nothing is submitted until you click **Stop answer** and then **Submit answer** (you can edit the transcript, resume listening, retry, replay the question, pause, or **Skip question — learn this later**). Every response is saved server-side, so refreshing or leaving resumes at the next question.

How the pieces work and their honest limits:

- **Transcription** uses the browser's Web Speech API. In Chrome and Edge, audio is processed by the browser vendor's speech service (Google / Microsoft); RoleFit stores only the final transcript. Firefox has no `SpeechRecognition`, so answers are typed there. Recognition sessions that end on their own are resumed automatically (bounded retries, no duplicated text, nothing dropped), and the 8-minute safety limit stops recording without discarding text.
- **Spoken questions** use `speechSynthesis`. A watchdog prevents the interview from hanging if an engine never reports the end of speech.
- **Scoring**: Gemini scores each answered question 0–10 with category-specific criteria and returns strengths, missing concepts, inaccuracies, clarity, improvements, a stronger example answer, topics and a follow-up. The average includes **only evaluated answers** — skips, empty answers, technical problems and pending evaluations are never counted as zero. There are no heuristic fallback scores: if Gemini fails the answer is kept and can be re-evaluated.
- **Skipped questions** get a full learning entry (why it matters, concepts, suggested answer, simpler explanation, practical example, key points, practice question) in “Questions I need to learn” and in the PDF. The PDF is generated only once every learning answer exists.
- **Camera coaching** (off by default) runs MediaPipe face landmarks in the browser and reports only whether the face is in frame and roughly facing the camera. If no face is detected the cue is reported as unavailable. Frames are never uploaded or stored; tracks stop when the interview ends or the page closes.
- **PDF report** is rendered server-side with PDFKit and an embedded DejaVu Sans font (handles ₹, curly quotes, dashes, accents); unsupported scripts are replaced rather than drawn as broken glyphs.

## Known limitations

- The live interview advances when Gemini finishes a model turn after the candidate has spoken (same rule as the original app). Very short pauses can split an answer; the transcript is shown so the user can repeat.
- Presentation signals are heuristics from face/shoulder landmarks; they are labelled approximate and never used to judge personality, honesty or employability.
- The transcript-based “delivery” heuristic depends on speech-to-text quality.
- Resume import splits sections heuristically; users are told to review imported content.
- The PDF renderer uses standard PDF fonts (WinAnsi); characters outside Latin-1 (e.g. Devanagari) are replaced with `?`.
- The skill dictionary is curated for software/data roles; other fields get mostly keyword coverage.
- The legacy Python endpoints `/api/analyze` and `/api/optimize` are retained but no longer used by the UI (the rule-based Express engine replaced the analyzer; per-bullet rewrite replaced whole-resume optimization).

## Original vs. current

The original project (preserved in git history, commit `Baseline`) was a single 53 KB React component talking directly to FastAPI: no accounts, no database, tab-based navigation, and the browser connected straight to the Gemini Live WebSocket. The current version keeps the Gemini Live bridge, question generation, evaluation, DOCX templates, parser and AudioWorklet capture, and adds the Express/MongoDB backend, authentication, persistence, PDF export, an explainable matcher, the redesigned UI and the test suites. Bugs fixed on the way: presentation components were averaged from the wrong keys (always 0); undetected camera frames were replaced with fixed default scores; failed evaluations counted as 0; `ai_used` was reported true when template questions were used.
