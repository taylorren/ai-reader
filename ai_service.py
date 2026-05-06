"""
AI service for fact-checking and discussion.
Supports DeepSeek (remote) and Ollama (local) providers.
"""
import os
import httpx
from typing import Optional


class AIService:
    """Handles AI API calls for both DeepSeek and Ollama providers."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

        # Ollama settings are also configurable from .env
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        self.ollama_api_key = os.getenv("OLLAMA_API_KEY", "ollama")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "llama3")

    def _get_connection_params(self, provider: str, ollama_model: Optional[str]) -> tuple[str, str, str]:
        """Return (base_url, api_key, model) for the given provider."""
        if provider == "ollama":
            model = ollama_model or self.ollama_model
            return self.ollama_base_url, self.ollama_api_key, model
        # Default: deepseek / any OpenAI-compatible remote
        return self.base_url, self.api_key, self.model

    async def fact_check(self, text: str, context: str = "",
                         provider: str = "deepseek", ollama_model: Optional[str] = None) -> str:
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
                      provider: str = "deepseek", ollama_model: Optional[str] = None) -> str:
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
    
    async def _call_api(self, prompt: str, provider: str = "deepseek",
                        ollama_model: Optional[str] = None,
                        allow_fallback: bool = True) -> str:
        """Make API call to OpenAI-compatible endpoint."""
        provider = (provider or "deepseek").lower()
        if provider not in ("deepseek", "ollama"):
            return "不支持的AI提供商。"

        if provider == "deepseek" and not self.api_key:
            return "DeepSeek 未配置。请设置 OPENAI_API_KEY，或切换到 Ollama。"

        base_url, api_key, model = self._get_connection_params(provider, ollama_model)

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
                        "messages": [
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.7
                    }
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
            
            except httpx.HTTPError as e:
                if provider == "ollama" and allow_fallback and self.api_key:
                    fallback_result = await self._call_api(
                        prompt,
                        provider="deepseek",
                        ollama_model=None,
                        allow_fallback=False,
                    )
                    return f"Ollama 不可用，已切换到 DeepSeek:\n\n{fallback_result}"
                return f"API调用失败: {str(e)}"
            except Exception as e:
                return f"处理失败: {str(e)}"
