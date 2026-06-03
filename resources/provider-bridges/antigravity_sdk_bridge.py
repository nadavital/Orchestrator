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


def collect_model_ids(value: Any) -> list[str]:
    payload = dump_model(value)
    found: list[str] = []

    def walk(item: Any) -> None:
        if item is None:
            return
        if isinstance(item, str):
            if item and all(ch.isalnum() or ch in "-_./:" for ch in item):
                found.append(item)
            return
        if isinstance(item, dict):
            for key in ("id", "model", "name"):
                maybe_id = item.get(key)
                if isinstance(maybe_id, str):
                    walk(maybe_id)
                    break
            for key in ("models", "items", "data", "results", "available_models"):
                if key in item:
                    walk(item[key])
            return
        if isinstance(item, (list, tuple, set)):
            for child in item:
                walk(child)
            return
        for attr in ("id", "model", "name"):
            if hasattr(item, attr):
                maybe_id = getattr(item, attr)
                if isinstance(maybe_id, str):
                    walk(maybe_id)
                    return
        for attr in ("models", "items", "data", "results", "available_models"):
            if hasattr(item, attr):
                walk(getattr(item, attr))

    walk(payload)
    unique: list[str] = []
    for model_id in found:
        if model_id not in unique:
            unique.append(model_id)
    return unique


async def maybe_await(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


async def list_models() -> int:
    try:
        import google.antigravity as antigravity
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

    candidates: list[Any] = []
    for name in ("list_models", "list_available_models", "get_models"):
        candidates.append(getattr(antigravity, name, None))
    models_namespace = getattr(antigravity, "models", None)
    if models_namespace is not None:
        for name in ("list", "list_models", "all", "available"):
            candidates.append(getattr(models_namespace, name, None))

    errors: list[str] = []
    for candidate in candidates:
        if candidate is None:
            continue
        try:
            value = candidate() if callable(candidate) else candidate
            model_ids = collect_model_ids(await maybe_await(value))
            if model_ids:
                emit({
                    "type": "models.list",
                    "models": [{"id": model_id} for model_id in model_ids],
                })
                return 0
        except Exception as exc:
            errors.append(f"{getattr(candidate, '__name__', type(candidate).__name__)}: {type(exc).__name__}: {exc}")

    emit({
        "type": "run.failed",
        "content": (
            "Google Antigravity SDK is installed, but this version does not expose "
            "a model-list API through the bridge. "
            + ("; ".join(errors[:3]) if errors else "")
        ).strip(),
    })
    return 1


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
    parser.add_argument("--list-models", action="store_true")
    parser.add_argument("--prompt")
    parser.add_argument("--cwd")
    parser.add_argument("--model")
    parser.add_argument("--conversation-id")
    parser.add_argument("--execution-policy", default="default")
    parser.add_argument("--save-dir")
    parser.add_argument("--app-data-dir")
    parser.add_argument("--system-instructions")
    return parser.parse_args()


if __name__ == "__main__":
    parsed_args = parse_args()
    if parsed_args.list_models:
        sys.exit(asyncio.run(list_models()))
    if not parsed_args.prompt or not parsed_args.cwd:
        print("--prompt and --cwd are required unless --list-models is used.", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(run(parsed_args)))
