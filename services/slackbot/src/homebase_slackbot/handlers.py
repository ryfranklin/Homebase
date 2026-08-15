"""Message-handling core, decoupled from Slack Bolt so it is unit-testable.

`handle_question` is the whole bridge logic: resolve the Slack user's verified
email, gate on the allow-list, invoke the agent, and format a reply. It takes
plain dependencies (an email resolver, the allow-list, the agent client) and
returns a formatted string, so tests exercise it with fakes and the Bolt wiring
in app.py stays a thin adapter.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable

# Strip a leading bot mention like "<@U123ABC> " so the agent sees a clean prompt.
_MENTION_RE = re.compile(r"<@[A-Z0-9]+>\s*")

_NOT_ALLOWED = (
    "Sorry, I can only talk to people on the Homebase allow-list. "
    "Ask the owner to add your email to enable access."
)
_NO_EMAIL = (
    "I could not read a verified email for your Slack account, so I cannot "
    "authorize you. Your Slack workspace may not expose email to apps."
)
_EMPTY = "Ask me something after the mention and I will look it up in Homebase."


@dataclass
class Deps:
    resolve_email: Callable[[str], "str | None"]  # (slack_user_id) -> email | None
    allowlist: Any  # .allows(email) -> bool
    agent: Any  # .ask(prompt, user_id=, session_id=) -> AgentReply
    session_id_for: Callable[[str, "str | None"], str]  # (channel, thread) -> id


def clean_prompt(text: str) -> str:
    return _MENTION_RE.sub("", text or "").strip()


def format_reply(reply) -> str:
    """Render an AgentReply as Slack message text (mrkdwn)."""
    if getattr(reply, "authorization_url", None):
        return (
            "You need to connect that account first. Open this link to authorize, "
            f"then ask again:\n{reply.authorization_url}"
        )

    answer = (reply.answer or "").strip() or "(no answer)"

    citations = getattr(reply, "citations", None) or []
    sources = []
    for c in citations:
        src = c.get("source_path") if isinstance(c, dict) else None
        if src:
            sources.append(src)
    if sources:
        # De-duplicate, preserve order, cap the footer so it stays readable.
        seen: list[str] = []
        for s in sources:
            if s not in seen:
                seen.append(s)
        shown = seen[:5]
        footer = "\n".join(f"• {s}" for s in shown)
        extra = f"\n_+{len(seen) - len(shown)} more_" if len(seen) > len(shown) else ""
        answer = f"{answer}\n\n*Sources*\n{footer}{extra}"

    if getattr(reply, "grounded", True) is False and not citations:
        answer = f"{answer}\n\n_(no relevant source found in the knowledge base)_"

    return answer


def handle_question(*, text, slack_user_id, channel, thread, deps: Deps) -> str:
    """Full bridge decision for one inbound Slack message. Returns reply text."""
    prompt = clean_prompt(text)
    if not prompt:
        return _EMPTY

    email = deps.resolve_email(slack_user_id)
    if not email:
        return _NO_EMAIL
    if not deps.allowlist.allows(email):
        return _NOT_ALLOWED

    # Identity presented to the agent: the verified email is the user id, so the
    # agent's per-user memory and any connector vault lookups key off the real
    # person, exactly like the GUI passes the Cognito identity.
    session_id = deps.session_id_for(channel, thread)
    reply = deps.agent.ask(prompt, user_id=email, session_id=session_id)
    return format_reply(reply)
