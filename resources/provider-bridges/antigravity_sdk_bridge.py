#!/usr/bin/env python3
"""Orchestrator bridge for the Google Antigravity Python SDK.

The bridge intentionally uses the SDK, not the `agy` CLI. It emits one
JSON object per line using Orchestrator's normalized provider event shape.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import traceback
import uuid
from typing import Any

logging.basicConfig(level=logging.CRITICAL)

def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":"), default=stringify), flush=True)


def stringify(value: Any) -> str:
    if hasattr(value, "value"):
        return str(value.value)
    return str(value)


def dump_model(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "dict"):
        return value.dict()
    if isinstance(value, Exception):
        return {"name": type(value).__name__, "message": str(value)}
    return value


def usage_payload(usage: Any) -> dict[str, Any] | None:
    if usage is None:
        return None
    payload = dump_model(usage)
    if not isinstance(payload, dict):
        return None
    return {
        "inputTokens": payload.get("prompt_token_count"),
        "outputTokens": payload.get("candidates_token_count"),
        "cacheReadInputTokens": payload.get("cached_content_token_count"),
        "totalTokens": payload.get("total_token_count"),
        "modelUsage": {
            "thoughtsTokens": payload.get("thoughts_token_count"),
        },
    }


def tool_name(value: Any) -> str:
    name = getattr(value, "name", value)
    if hasattr(name, "value"):
        return str(name.value)
    return str(name)


def build_config(args: argparse.Namespace) -> Any:
    from google.antigravity import CapabilitiesConfig, LocalAgentConfig
    from google.antigravity.hooks import policy

    policies = []
    capabilities = None
    if args.execution_policy in {"bypassPermissions", "yolo", "fullAccess"}:
        capabilities = CapabilitiesConfig()
        policies = [policy.allow_all()]

    kwargs: dict[str, Any] = {
        "system_instructions": args.system_instructions,
        "capabilities": capabilities,
        "policies": policies,
        "workspaces": [args.cwd],
        "conversation_id": args.conversation_id,
        "save_dir": args.save_dir,
        "app_data_dir": args.app_data_dir,
        "model": args.model,
        "api_key": os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"),
    }
    return LocalAgentConfig(**{key: value for key, value in kwargs.items() if value is not None})


async def run(args: argparse.Namespace) -> int:
    try:
        from google.antigravity import Agent
        from google.antigravity.types import Text, Thought, ToolCall, ToolResult
    except Exception as exc:
        emit({
            "type": "run.failed",
            "content": (
                "Google Antigravity SDK import failed. Install Python >=3.10 and "
                "`python -m pip install google-antigravity`. "
                f"{type(exc).__name__}: {exc}"
            ),
        })
        return 1

    stream_id = f"antigravity-{uuid.uuid4()}"
    tool_ids: dict[str, str] = {}

    try:
        config = build_config(args)
        async with Agent(config) as agent:
            conversation_id = getattr(agent, "conversation_id", None) or args.conversation_id
            if conversation_id:
                emit({"type": "session.started", "providerSessionId": conversation_id})

            response = await agent.chat(args.prompt)
            async for chunk in response.chunks:
                if isinstance(chunk, Text):
                    emit({"type": "assistant.text.delta", "streamId": stream_id, "content": chunk.text})
                elif isinstance(chunk, Thought):
                    emit({"type": "assistant.status", "content": chunk.text})
                elif isinstance(chunk, ToolCall):
                    tool_id = chunk.id or f"tool-{uuid.uuid4()}"
                    tool_ids[tool_id] = tool_id
                    emit({
                        "type": "tool.started",
                        "id": tool_id,
                        "toolName": tool_name(chunk),
                        "toolInput": dump_model(getattr(chunk, "args", {})) or {},
                    })
                elif isinstance(chunk, ToolResult):
                    tool_id = chunk.id or tool_ids.get(tool_name(chunk)) or f"tool-{uuid.uuid4()}"
                    emit({
                        "type": "tool.completed",
                        "id": f"result-{uuid.uuid4()}",
                        "toolUseId": tool_id,
                        "content": json.dumps(dump_model(getattr(chunk, "result", None)), default=stringify),
                        "isError": bool(getattr(chunk, "error", None) or getattr(chunk, "exception", None)),
                    })

            emit({"type": "assistant.text.completed", "streamId": stream_id})
            completed: dict[str, Any] = {"type": "run.completed"}
            usage = usage_payload(getattr(response, "usage_metadata", None))
            if usage:
                completed["usage"] = usage
            emit(completed)
            return 0
    except Exception as exc:
        emit({
            "type": "run.failed",
            "content": f"{type(exc).__name__}: {exc}",
            "error": {
                "name": type(exc).__name__,
                "message": str(exc),
                "stack": traceback.format_exc(),
            },
        })
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an Antigravity SDK turn for Orchestrator.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--model")
    parser.add_argument("--conversation-id")
    parser.add_argument("--execution-policy", default="default")
    parser.add_argument("--save-dir")
    parser.add_argument("--app-data-dir")
    parser.add_argument("--system-instructions")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(asyncio.run(run(parse_args())))
