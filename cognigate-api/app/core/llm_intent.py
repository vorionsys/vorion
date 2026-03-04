"""
LLM-backed Intent Analyzer — Production intent processing.

Replaces the keyword-based analyze_intent() with an LLM call that
uses the same multi-provider infrastructure as the Critic module.

The LLM analyzes the raw goal and returns a structured plan with:
- Detected tools required
- Data classifications
- Risk indicators and score
- Reasoning trace

Falls back to the keyword analyzer if no LLM provider is available.
"""

import json
import time
import structlog
from typing import Optional

from app.config import get_settings
from app.models.intent import StructuredPlan

logger = structlog.get_logger()
settings = get_settings()


INTENT_SYSTEM_PROMPT = """You are an INTENT ANALYZER for an AI governance engine (Cognigate / BASIS standard).

Your job: Given a raw goal from an AI agent, produce a structured analysis.

You must identify:
1. TOOLS REQUIRED — What capabilities does this goal need?
   Valid tools: shell, file_read, file_write, file_delete, network, external_api, database, email, none
2. DATA CLASSIFICATIONS — What types of data are involved?
   Valid classes: pii_email, pii_phone, pii_ssn, pii_name, credentials, financial, health, none
3. ENDPOINTS REQUIRED — Any external URLs or services needed
4. RISK INDICATORS — Map of risk factor name → score (0.0-1.0)
   Consider: destructive_intent, data_exposure, privilege_escalation, scope_creep,
   euphemism_attack, dangerous_tools, system_path_target, exfiltration_risk
5. RISK SCORE — Overall risk (0.0-1.0):
   0.0-0.2 = safe, 0.2-0.5 = moderate, 0.5-0.7 = risky, 0.7-0.9 = dangerous, 0.9-1.0 = critical
6. REASONING — Brief explanation of your analysis

RULES:
- Be PARANOID: assume worst-case interpretation when ambiguous
- Euphemisms like "clean", "organize", "tidy" near system paths = HIGH RISK
- Shell + network = exfiltration risk
- Any mention of credentials, SSH keys, passwords = elevated risk
- "rm", "delete", "drop" in any context = minimum 0.5 risk

OUTPUT FORMAT (JSON only, no markdown):
{
    "tools_required": ["tool1", "tool2"],
    "endpoints_required": ["url_or_service"],
    "data_classifications": ["class1"],
    "risk_indicators": {"factor": 0.5},
    "risk_score": 0.3,
    "reasoning": "Brief explanation"
}"""


def build_intent_prompt(goal: str, context: dict) -> str:
    """Build the user prompt for intent analysis."""
    ctx_str = json.dumps(context, default=str) if context else "none"
    return f"""ANALYZE THIS GOAL:

Goal: {goal}
Context: {ctx_str}

Respond with JSON only."""


async def llm_analyze_intent(
    goal: str,
    context: dict,
) -> Optional[StructuredPlan]:
    """
    Use an LLM to analyze intent. Returns None if no provider is available.

    Uses the same provider detection as the Critic module.
    """
    if not settings.critic_enabled:
        return None

    provider_name = settings.critic_provider.lower()
    user_prompt = build_intent_prompt(goal, context)
    start_time = time.perf_counter()

    try:
        data = await _call_llm(provider_name, user_prompt)
        if data is None:
            return None

        duration_ms = (time.perf_counter() - start_time) * 1000

        plan = StructuredPlan(
            goal=goal,
            tools_required=data.get("tools_required", ["none"]),
            endpoints_required=data.get("endpoints_required", []),
            data_classifications=data.get("data_classifications", []),
            risk_indicators=data.get("risk_indicators", {}),
            risk_score=min(1.0, max(0.0, data.get("risk_score", 0.1))),
            reasoning_trace=f"LLM ({provider_name}): {data.get('reasoning', 'No reasoning')} [{duration_ms:.0f}ms]",
        )

        logger.info(
            "llm_intent_analyzed",
            provider=provider_name,
            risk_score=plan.risk_score,
            tools=plan.tools_required,
            duration_ms=duration_ms,
        )
        return plan

    except Exception as e:
        logger.warning(
            "llm_intent_analysis_failed",
            provider=provider_name,
            error=str(e),
        )
        return None


async def _call_llm(provider: str, user_prompt: str) -> Optional[dict]:
    """Call the appropriate LLM provider and return parsed JSON."""

    if provider == "anthropic" and settings.anthropic_api_key:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model=settings.critic_model_anthropic,
            max_tokens=1024,
            system=INTENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return _parse_response(response.content[0].text)

    elif provider == "openai" and settings.openai_api_key:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model=settings.critic_model_openai,
            messages=[
                {"role": "system", "content": INTENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)

    elif provider == "google" and settings.google_api_key:
        import asyncio
        import google.generativeai as genai
        genai.configure(api_key=settings.google_api_key)
        model = genai.GenerativeModel(
            settings.critic_model_google,
            system_instruction=INTENT_SYSTEM_PROMPT,
        )
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: model.generate_content(
                user_prompt,
                generation_config={"temperature": 0.2},
            ),
        )
        return _parse_response(response.text)

    elif provider == "xai" and settings.xai_api_key:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.xai_api_key, base_url="https://api.x.ai/v1")
        response = await client.chat.completions.create(
            model=settings.critic_model_xai,
            messages=[
                {"role": "system", "content": INTENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        return _parse_response(response.choices[0].message.content)

    return None


def _parse_response(text: str) -> dict:
    """Parse LLM response, stripping markdown fences if present."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())
