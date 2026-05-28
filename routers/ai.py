"""
AI analysis routes: fact-check, discussion, save, update, delete.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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

    if req.analysis_type == "fact_check":
        response = await service.fact_check(req.selected_text, req.context, provider=provider)
    elif req.analysis_type == "discussion":
        response = await service.discuss(req.selected_text, req.context, provider=provider)
    else:
        raise HTTPException(status_code=400, detail="Invalid analysis type")

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
