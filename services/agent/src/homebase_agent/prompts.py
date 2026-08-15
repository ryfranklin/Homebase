"""Load the versioned system prompt.

The prompt ships as package data (homebase_agent/prompts/system_prompt.md), so it
resolves relative to this module and is found whether the package is run from
source (PYTHONPATH=src) or pip-installed into site-packages (the container). It
must NOT be resolved relative to the repo layout, or the installed image can't
find it.
"""

from __future__ import annotations

import re
from pathlib import Path

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "system_prompt.md"
_PLANNING_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "planning_prompt.md"
_VERSION_RE = re.compile(r"<!--\s*Version:\s*(\d+)\s*-->", re.IGNORECASE)


def load_system_prompt(path=None) -> str:
    return Path(path or _PROMPT_PATH).read_text(encoding="utf-8")


def load_planning_prompt(path=None) -> str:
    """The AI-DLC INCEPTION planning prompt, used when the agent runs in plan mode."""
    return Path(path or _PLANNING_PROMPT_PATH).read_text(encoding="utf-8")


def system_prompt_version(path=None) -> int:
    text = load_system_prompt(path)
    match = _VERSION_RE.search(text)
    if not match:
        raise ValueError("system prompt is missing a '<!-- Version: N -->' marker")
    return int(match.group(1))
