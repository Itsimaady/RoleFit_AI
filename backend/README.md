# RoleFit-AI local backend

FastAPI backend for resume analysis, ATS matching, optimization, DOCX generation and the Monk interview.

## AI stack
- **Gemini Live API** powers the real-time Monk speech-to-speech WebSocket session.
- **Gemini text API** powers personalized interview questions, answer evaluation, optimization and final scoring.
- **Sentence Transformers** provides local semantic embeddings.
- Camera/presentation signals remain browser-local.

## Environment
Create/edit `backend/.env` from `.env.example`:

```env
GEMINI_API_KEY=
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_VOICE=Aoede
EMBEDDING_MODEL=all-MiniLM-L6-v2
MAX_UPLOAD_MB=10
MAX_TEXT_CHARS=50000
AI_TIMEOUT_SECONDS=45
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Never expose the API key in the React frontend.

## Run
```cmd
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

Health endpoints:
- `/api/health`
- `/api/health/ready`
- `/docs`

The Monk live WebSocket is `/ws/monk-live`. The frontend automatically sends it to the backend URL from `VITE_API_URL`.
