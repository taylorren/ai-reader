"""
AI analysis routes: fact-check, discussion, save, update, delete.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ai_service import AIServiceError
from database import AIAnalysis

from . import _runtime_settings, get_ai_service, get_db

router = APIRouter()


class AIRequest(BaseModel):
    """Payload for requesting an AI analysis on selected text."""
    highlight_id: int
    analysis_type: str      # 'fact_check' or 'discussion'
    selected_text: str
    context: str = ""
    provider: str = "ollama_cloud"


class SaveAnalysisRequest(BaseModel):
    """Payload for persisting an AI analysis result to the database."""
    highlight_id: int
    analysis_type: str      # 'fact_check', 'discussion', or 'comment'
    prompt: str
    response: str


class InteractiveDiscussionRequest(BaseModel):
    """Payload for starting an interactive discussion."""
    highlight_id: int
    selected_text: str
    context: str = ""
    provider: str = "ollama_cloud"


class ConversationMessage(BaseModel):
    """A single message in a conversation."""
    role: str  # 'user' or 'assistant'
    content: str


class ContinueDiscussionRequest(BaseModel):
    """Payload for continuing an interactive discussion."""
    highlight_id: int
    selected_text: str
    conversation_history: list[ConversationMessage]
    user_message: str
    provider: str = "ollama_cloud"


class SummarizeDiscussionRequest(BaseModel):
    """Payload for summarizing a discussion conversation."""
    highlight_id: int
    selected_text: str
    conversation_history: list[ConversationMessage]
    provider: str = "ollama_cloud"


@router.post("/api/ai/analyze")
async def analyze_text(req: AIRequest):
    """Perform AI analysis (fact-check or discussion) without saving."""
    service = get_ai_service()
    if not service:
        raise HTTPException(
            status_code=500,
            detail="AI service not configured. Please check Ollama settings.",
        )

    provider = _runtime_settings["provider_override"] or req.provider or "ollama_cloud"
    provider = provider.lower()
    if provider not in ("ollama", "ollama_cloud"):
        raise HTTPException(status_code=400, detail="Invalid AI provider")

    try:
        if req.analysis_type == "fact_check":
            response = await service.fact_check(req.selected_text, req.context, provider=provider)
        elif req.analysis_type == "discussion":
            response = await service.discuss(req.selected_text, req.context, provider=provider)
        else:
            raise HTTPException(status_code=400, detail="Invalid analysis type")
    except AIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {"response": response, "provider_used": provider, "status": "success"}


@router.post("/api/ai/save")
async def save_analysis(req: SaveAnalysisRequest):
    """Save AI analysis to database."""
    db = get_db()
    analysis = AIAnalysis(
        highlight_id=req.highlight_id,
        analysis_type=req.analysis_type,
        prompt=req.prompt,
        response=req.response,
        created_at=datetime.now().isoformat(),
    )
    analysis_id = db.save_analysis(analysis)
    return {"analysis_id": analysis_id, "status": "success"}


@router.post("/api/ai/discussion/start")
async def start_interactive_discussion(req: InteractiveDiscussionRequest):
    """Start an interactive discussion with a brief overview."""
    service = get_ai_service()
    if not service:
        raise HTTPException(
            status_code=500,
            detail="AI service not configured. Please check Ollama settings.",
        )

    provider = _runtime_settings["provider_override"] or req.provider or "ollama_cloud"
    provider = provider.lower()
    if provider not in ("ollama", "ollama_cloud"):
        raise HTTPException(status_code=400, detail="Invalid AI provider")

    try:
        response = await service.discuss_interactive(req.selected_text, provider=provider)
        return {
            "response": response, 
            "provider_used": provider, 
            "status": "success",
            "conversation_history": [
                {"role": "assistant", "content": response}
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/api/ai/discussion/continue")
async def continue_interactive_discussion(req: ContinueDiscussionRequest):
    """Continue an interactive discussion with follow-up question."""
    service = get_ai_service()
    if not service:
        raise HTTPException(
            status_code=500,
            detail="AI service not configured. Please check Ollama settings.",
        )

    provider = _runtime_settings["provider_override"] or req.provider or "ollama_cloud"
    provider = provider.lower()
    if provider not in ("ollama", "ollama_cloud"):
        raise HTTPException(status_code=400, detail="Invalid AI provider")

    try:
        # Add user message to conversation history
        conversation_history = [
            {"role": msg.role, "content": msg.content} 
            for msg in req.conversation_history
        ]
        conversation_history.append({"role": "user", "content": req.user_message})
        
        # Prepare context from conversation history (use sliding window for long conversations)
        context_window = 10  # Last 10 messages for context
        if len(conversation_history) > context_window:
            # Keep first message (overview) and last N messages
            context_history = [conversation_history[0]] + conversation_history[-context_window:]
        else:
            context_history = conversation_history
        
        # Call AI with conversation history
        response = await service.continue_discussion(
            user_message=req.user_message,
            conversation_history=context_history,
            provider=provider
        )
        
        # Add AI response to conversation history
        conversation_history.append({"role": "assistant", "content": response})
        
        # Add conversation length warnings
        message_count = len(conversation_history)
        warnings = []
        
        if message_count >= 15:
            warnings.append("对话较长，建议考虑总结当前讨论")
        if message_count >= 20:
            warnings.append("对话接近上下文限制，请尽快总结")
        
        return {
            "response": response, 
            "provider_used": provider, 
            "status": "success",
            "conversation_history": conversation_history,
            "message_count": message_count,
            "warnings": warnings
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/api/ai/discussion/summarize")
async def summarize_discussion(req: SummarizeDiscussionRequest):
    """Summarize an interactive discussion into comprehensive analysis."""
    service = get_ai_service()
    if not service:
        raise HTTPException(
            status_code=500,
            detail="AI service not configured. Please check Ollama settings.",
        )

    provider = _runtime_settings["provider_override"] or req.provider or "ollama_cloud"
    provider = provider.lower()
    if provider not in ("ollama", "ollama_cloud"):
        raise HTTPException(status_code=400, detail="Invalid AI provider")

    try:
        # Convert conversation history to list of dicts
        conversation_history = [
            {"role": msg.role, "content": msg.content} 
            for msg in req.conversation_history
        ]
        
        # Summarize the conversation
        summary = await service.summarize_conversation(
            req.selected_text,
            conversation_history,
            provider=provider
        )
        
        return {
            "summary": summary, 
            "provider_used": provider, 
            "status": "success",
            "original_message_count": len(conversation_history)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/api/ai/update/{analysis_id}")
async def update_analysis(analysis_id: int, req: dict):
    """Update an existing analysis (for editing comments)."""
    db = get_db()
    try:
        db.update_analysis(analysis_id, req.get("response", ""))
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/api/ai/delete/{analysis_id}")
async def delete_analysis(analysis_id: int):
    """Delete an analysis (and its highlight if no other analyses exist)."""
    db = get_db()
    try:
        db.delete_analysis(analysis_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
