import json
import urllib.request

URL = "http://127.0.0.1:8000/api/health"
try:
    with urllib.request.urlopen(URL, timeout=5) as response:
        data = json.load(response)
    print("Health:", data.get("status"))
    print("Version:", data.get("version"))
    print("Gemini Live configured:", data.get("gemini_live_configured"))
    print("Embedding ready:", data.get("embedding_ready"))
except Exception as exc:
    print("Backend check failed:", exc)
    raise SystemExit(1)
