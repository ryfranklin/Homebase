"""The confirmation contract returned for any gated write."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ConfirmationContract:
    """Returned instead of executing a write. The caller must re-invoke the tool
    with the matching confirmation_token to proceed."""

    action: str
    connector: str
    summary: str
    parameters: dict = field(default_factory=dict)
    confirmation_token: str = ""
    requires_confirmation: bool = True


def make_token(tool_name: str, parameters: dict) -> str:
    """Deterministic token over the action and its parameters, so re-invoking the
    same write with the same parameters produces the same token (and a different
    write does not)."""
    canonical = json.dumps({"tool": tool_name, "params": parameters}, sort_keys=True, default=str)
    return "confirm-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]
