# RoleFit-AI

RoleFit-AI combines resume/JD matching, ATS diagnostics, resume building and a professional 12-question Monk mock interview.

## AI stack
- **Gemini Live API** — real-time bidirectional voice interviewer with streamed native audio, live transcription, server VAD and interruption support.
- **Gemini text API** — resume/JD-grounded interview question generation, answer evaluation, optimization and final report.
- **Sentence Transformers** — local semantic similarity.
- **Browser-local camera analysis** — observable presentation signals only.

No OpenAI or Grok service is required by this build.

## Local setup
1. Create `backend/.env` from `backend/.env.example`.
2. Add your own `GEMINI_API_KEY` locally.
3. Start the backend from `backend`.
4. Start the frontend from `frontend`.
5. Open `http://localhost:5173/`.

See `MONK-LIVE-SETUP.txt` for exact commands.
