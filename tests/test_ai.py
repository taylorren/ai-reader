"""Tests for AI endpoint validation and error mapping."""

import asyncio

import pytest

from ai_service import AIService, AIServiceError
from routers import _runtime_settings


def _get_service():
    from routers import get_ai_service

    service = get_ai_service()
    assert service is not None
    return service


def _reset_provider_override():
    _runtime_settings["provider_override"] = None


def test_analyze_rejects_unknown_provider(client):
    _reset_provider_override()
    resp = client.post("/api/ai/analyze", json={
        "highlight_id": 0,
        "analysis_type": "fact_check",
        "selected_text": "some text",
        "context": "some context",
        "provider": "openai",
    })
    assert resp.status_code == 400


def test_analyze_maps_ai_failures_to_502(client, monkeypatch):
    """AI failures must surface as HTTP errors, not as 200 + error text."""
    _reset_provider_override()
    service = _get_service()
    # Point the local provider at an unreachable port.
    monkeypatch.setattr(service, "ollama_base_url", "http://127.0.0.1:1", raising=False)

    resp = client.post("/api/ai/analyze", json={
        "highlight_id": 0,
        "analysis_type": "fact_check",
        "selected_text": "some text",
        "context": "some context",
        "provider": "ollama",
    })
    assert resp.status_code == 502


def test_call_api_raises_instead_of_returning_error_text(monkeypatch):
    service = AIService()
    monkeypatch.setattr(service, "ollama_base_url", "http://127.0.0.1:1", raising=False)

    with pytest.raises(AIServiceError):
        asyncio.run(service._call_api("prompt", provider="ollama"))

