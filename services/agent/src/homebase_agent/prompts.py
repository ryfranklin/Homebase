"""Load the versioned system prompt from prompts/system_prompt.md."""

from __future__ import annotations

import re
from pathlib import Path

_PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "system_prompt.md"
_VERSION_RE = re.compile(r"<!--\s*Version:\s*(\d+)\s*-->", re.IGNORECASE)


def load_system_prompt(path=None) -> str:
    return Path(path or _PROMPT_PATH).read_text(encoding="utf-8")


def system_prompt_version(path=None) -> int:
    text = load_system_prompt(path)
    match = _VERSION_RE.search(text)
    if not match:
        raise ValueError("system prompt is missing a '<!-- Version: N -->' marker")
    return int(match.group(1))
