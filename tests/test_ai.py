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


def test_start_discussion_returns_starter_history(client, monkeypatch):
    _reset_provider_override()
    service = _get_service()

    async def fake_discuss_interactive(text, provider="ollama", ollama_model=None):
        return "Fake overview response"

    monkeypatch.setattr(service, "discuss_interactive", fake_discuss_interactive)

    resp = client.post("/api/ai/discussion/start", json={
        "highlight_id": 0,
        "selected_text": "sample text for discussion",
        "context": "",
        "provider": "ollama",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    history = data["conversation_history"]
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert "sample text for discussion" in history[0]["content"]
    assert history[1]["role"] == "assistant"
    assert history[1]["content"] == "Fake overview response"


def test_continue_discussion_does_not_duplicate_user_message(client, monkeypatch):
    _reset_provider_override()
    service = _get_service()

    received_history = []

    async def fake_continue(user_message, conversation_history, provider="ollama", ollama_model=None):
        received_history.extend(conversation_history)
        return "Assistant follow-up"

    monkeypatch.setattr(service, "continue_discussion", fake_continue)

    client_history = [
        {"role": "user", "content": "initial text"},
        {"role": "assistant", "content": "overview"},
        {"role": "user", "content": "my question"},
    ]

    resp = client.post("/api/ai/discussion/continue", json={
        "highlight_id": 0,
        "selected_text": "sample text",
        "conversation_history": client_history,
        "user_message": "my question",
        "provider": "ollama",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    user_msgs = [m for m in data["conversation_history"] if m["content"] == "my question"]
    assert len(user_msgs) == 1
    service_user_msgs = [m for m in received_history if m["content"] == "my question"]
    assert len(service_user_msgs) == 1


def test_discussion_endpoints_map_failures_to_502(client, monkeypatch):
    _reset_provider_override()
    service = _get_service()
    monkeypatch.setattr(service, "ollama_base_url", "http://127.0.0.1:1", raising=False)

    resp = client.post("/api/ai/discussion/start", json={
        "highlight_id": 0,
        "selected_text": "text",
        "context": "",
        "provider": "ollama",
    })
    assert resp.status_code == 502

    resp = client.post("/api/ai/discussion/continue", json={
        "highlight_id": 0,
        "selected_text": "text",
        "conversation_history": [{"role": "user", "content": "q"}],
        "user_message": "q",
        "provider": "ollama",
    })
    assert resp.status_code == 502

    resp = client.post("/api/ai/discussion/summarize", json={
        "highlight_id": 0,
        "selected_text": "text",
        "conversation_history": [{"role": "user", "content": "q"}],
        "provider": "ollama",
    })
    assert resp.status_code == 502

