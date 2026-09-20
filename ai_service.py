"""
AI service for fact-checking and discussion.
Supports Ollama local and Ollama Cloud providers.
"""
import os
import httpx
from typing import Optional, List, Dict


class AIServiceError(Exception):
    """Raised when an AI API call fails (network, HTTP, or parse error)."""


class AIService:
    """Handles AI API calls for Ollama local and Ollama Cloud providers."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.ollama_base_url = base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        self.ollama_api_key = api_key or os.getenv("OLLAMA_API_KEY", "ollama")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "llama3")
        self.ollama_cloud_model = os.getenv("OLLAMA_CLOUD_MODEL", "gpt-oss:120b-cloud")

    def _get_connection_params(self, provider: str, ollama_model: Optional[str]) -> tuple[str, str, str]:
        """Return (base_url, api_key, model) for the given provider."""
        if provider == "ollama_cloud":
            model = ollama_model or self.ollama_cloud_model
        else:
            model = ollama_model or self.ollama_model

        return self.ollama_base_url, self.ollama_api_key, model

    def _build_messages(self, prompt: str, provider: str) -> list[dict[str, str]]:
        """Build chat messages with explicit Chinese output constraints."""
        if provider == "ollama":
            system_prompt = (
                "你是中文阅读助手。必须仅使用简体中文回答。"
                "不要输出英文句子，不要输出英文小标题；如需术语请给出中文解释。"
            )
        else:
            system_prompt = "请使用简体中文回答，保持表达清晰、准确。"

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

    async def fact_check(self, text: str, context: str = "",
                         provider: str = "ollama", ollama_model: Optional[str] = None) -> str:
        """Quick explanation and fact-checking for unclear content."""
        prompt = f"""请帮我理解以下内容：

{text}

请根据内容类型提供相应的解释：

**如果是专有名词/概念**：给出清晰的定义和解释
**如果是人物**：介绍其身份、背景和重要性
**如果是历史事件**：说明事件经过、时间、影响
**如果是地点**：介绍其地理位置、特点、相关背景
**如果是数据/事实陈述**：验证准确性，提供来源或背景

要求：
- 简洁明了，重点突出
- 如有错误或争议，明确指出
- 如果内容不完整或无法判断，说明需要更多上下文"""

        return await self._call_api(prompt, provider=provider, ollama_model=ollama_model)
    
    async def discuss(self, text: str, context: str = "",
                      provider: str = "ollama", ollama_model: Optional[str] = None) -> str:
        """Generate insightful and academic discussion about the selected text."""
        prompt = f"""请对以下文本进行深入的学术性分析和讨论：

{text}

请从以下几个维度展开分析：

**1. 核心论点解析**
- 作者的主要观点是什么？
- 论证逻辑和结构如何？
- 使用了哪些论证方法（举例、类比、引用等）？

**2. 理论与学术视角**
- 这段文本涉及哪些学术领域或理论框架？
- 与哪些经典理论、学派或学者的观点相关？
- 在学术史或思想史上的位置如何？

**3. 批判性思考**
- 论证是否充分？有无逻辑漏洞？
- 是否存在隐含的假设或前提？
- 可能的反驳观点是什么？

**4. 启发性问题**
- 这段文本引发了哪些值得深入思考的问题？
- 如何将这些观点应用到其他领域或情境？
- 对当代有什么启示意义？

要求：
- 保持学术严谨性，但避免过于晦涩
- 提出具有启发性的问题，引导深入思考
- 如涉及专业术语，简要解释
- 鼓励多角度、批判性的思考"""

        return await self._call_api(prompt, provider=provider, ollama_model=ollama_model)
    
    async def discuss_interactive(self, text: str, provider: str = "ollama", 
                                  ollama_model: Optional[str] = None) -> str:
        """Generate a brief overview for interactive discussion starter."""
        prompt = f"""请对以下文本提供一个简要的概览分析（1-2段），突出关键论点、主要观点和值得深入探讨的方面：

{text}

要求：
- 保持简洁，1-2段即可
- 突出最关键的观点和值得讨论的方面
- 不要提供详细分析，留待后续讨论
- 语言保持学术性但易懂
- 结束时可以提出1-2个引导性问题，激发用户思考"""
        
        return await self._call_api(prompt, provider=provider, ollama_model=ollama_model)
    
    async def continue_discussion(self, user_message: str, conversation_history: List[Dict[str, str]],
                                  provider: str = "ollama", 
                                  ollama_model: Optional[str] = None) -> str:
        """Continue an interactive discussion with user follow-up question."""
        # The conversation history already includes the context
        # We just need to add the user message and get AI response
        return await self._call_api(
            prompt=user_message,
            provider=provider,
            ollama_model=ollama_model,
            conversation_history=conversation_history
        )
    
    async def summarize_conversation(self, text: str, conversation_history: List[Dict[str, str]], 
                                     provider: str = "ollama", 
                                     ollama_model: Optional[str] = None) -> str:
        """Summarize a conversation history into comprehensive analysis."""
        # Add the summarization instruction as the final user message
        summarization_prompt = """基于我们的整个对话历史，请创建一个综合性的学术分析总结。

请创建综合总结，涵盖以下维度：
**1. 核心论点与观点总结**
- 从对话中提炼出的核心论点
- 主要观点的发展和演变

**2. 深入分析与见解**
- 基于对话的深入分析
- 学术视角和理论框架

**3. 批判性思考总结**
- 对话中提出的主要批判点
- 逻辑漏洞和假设讨论

**4. 结论与启示**
- 主要结论
- 对进一步研究和思考的启示

要求：
- 保持学术严谨性
- 基于整个对话历史进行综合
- 突出最有价值的见解
- 结构清晰，层次分明"""
        
        # Create a new conversation history that includes the summarization prompt
        summary_conversation = conversation_history.copy()
        summary_conversation.append({"role": "user", "content": summarization_prompt})
        
        # Call API with the full conversation history including summarization prompt
        return await self._call_api(
            prompt=summarization_prompt,
            provider=provider,
            ollama_model=ollama_model,
            conversation_history=summary_conversation
        )
    
    async def _call_api(self, prompt: str, provider: str = "ollama",
                        ollama_model: Optional[str] = None, 
                        conversation_history: Optional[list] = None) -> str:
        """Make API call to OpenAI-compatible endpoint."""
        provider = (provider or "ollama").lower()
        if provider not in ("ollama", "ollama_cloud"):
            raise AIServiceError(f"不支持的AI提供商: {provider}")

        base_url, api_key, model = self._get_connection_params(provider, ollama_model)
        
        # Build messages from conversation history if provided
        if conversation_history:
            messages = self._build_messages_from_history(conversation_history, provider)
        else:
            messages = self._build_messages(prompt, provider)

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": 0.7
                    }
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
            
            except httpx.HTTPError as e:
                raise AIServiceError(f"AI API调用失败: {e}") from e
            except Exception as e:
                raise AIServiceError(f"AI 处理失败: {e}") from e
    
    def _build_messages_from_history(self, conversation_history: list, provider: str) -> list[dict[str, str]]:
        """Build chat messages from conversation history."""
        if provider == "ollama":
            system_prompt = (
                "你是中文阅读助手。必须仅使用简体中文回答。"
                "不要输出英文句子，不要输出英文小标题；如需术语请给出中文解释。"
            )
        else:
            system_prompt = "请使用简体中文回答，保持表达清晰、准确。"
        
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(conversation_history)
        return messages
