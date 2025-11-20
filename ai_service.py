"""
AI service for fact-checking and discussion.
"""
import os
import httpx
from typing import Optional


class AIService:
    """Handles AI API calls."""
    
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        
        if not self.api_key:
            raise ValueError("API key not provided. Set OPENAI_API_KEY environment variable.")
    
    async def fact_check(self, text: str, context: str = "") -> str:
        """Fact-check the selected text."""
        prompt = f"""请对以下文本进行事实核查。如果有历史事实、数据或陈述，请验证其准确性并提供相关背景信息。

选中的文本：
{text}

上下文：
{context}

请提供：
1. 主要事实陈述的准确性评估
2. 相关的历史背景或补充信息
3. 如有错误或争议，请指出并说明"""

        return await self._call_api(prompt)
    
    async def discuss(self, text: str, context: str = "") -> str:
        """Generate discussion points about the selected text."""
        prompt = f"""请对以下文本进行深入分析和讨论。

选中的文本：
{text}

上下文：
{context}

请提供：
1. 文本的核心观点和论证
2. 可能的不同解读角度
3. 值得思考的问题
4. 与其他观点或理论的联系"""

        return await self._call_api(prompt)
    
    async def _call_api(self, prompt: str) -> str:
        """Make API call to OpenAI-compatible endpoint."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
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
                return f"API调用失败: {str(e)}"
            except Exception as e:
                return f"处理失败: {str(e)}"
