import pytest


@pytest.fixture(autouse=True)
def _single_text_model(monkeypatch):
    """backend/.env is loaded at import time; keep its model fallback chain out of tests
    unless a test sets GEMINI_TEXT_FALLBACK_MODELS itself."""
    monkeypatch.delenv("GEMINI_TEXT_FALLBACK_MODELS", raising=False)
