"""Homebase Slack bridge: talk to the Homebase agent from Slack.

A slack-bolt app running in Socket Mode. Socket Mode holds an OUTBOUND WebSocket
to Slack, so there is no inbound webhook, no public endpoint, and no request
signing to verify: the bridge runs on a private Fargate task with NAT egress
only. It listens for app mentions and direct messages, resolves the sender's
verified email, checks the allow-list, invokes the AgentCore runtime with that
identity (like the ssh-chat CLI), and posts the answer back.

Configuration (all from the task environment; the three secrets are injected
from Secrets Manager by the execution role, never baked into the image):
  SLACK_BOT_TOKEN            (xoxb-...  secret; chat:write, users:read.email)
  SLACK_APP_TOKEN            (xapp-...  secret; Socket Mode connection)
  HOMEBASE_AGENT_RUNTIME_ARN (agent runtime to invoke)
  HOMEBASE_TENANT_ID         (tenant presented to the agent; default "homebase")
  HOMEBASE_SLACK_ALLOWLIST_PARAM (SSM SecureString name holding allowed emails)
  AWS_REGION
"""

from __future__ import annotations

import logging
import os

from .agent_client import AgentClient, session_id_for
from .allowlist import Allowlist
from .handlers import Deps, handle_question

log = logging.getLogger("homebase.slackbot")


def _email_resolver(slack_client):
    """Return a function that resolves a Slack user id to a verified email.

    Uses users.info (needs the users:read.email scope). Returns None when the
    workspace does not expose an email, so the caller denies access rather than
    guessing an identity.
    """

    def resolve(slack_user_id: str) -> str | None:
        try:
            resp = slack_client.users_info(user=slack_user_id)
            return (resp.get("user", {}).get("profile", {}) or {}).get("email")
        except Exception:  # noqa: BLE001 - a lookup failure must not authorize anyone
            log.warning("users.info failed for %s", slack_user_id, exc_info=True)
            return None

    return resolve


def build_app(*, slack_app=None, deps: Deps | None = None):
    """Construct the Bolt app and register listeners.

    Dependencies are injected for tests; in production they are built from the
    environment by main().
    """
    from slack_bolt import App

    bot_token = os.environ["SLACK_BOT_TOKEN"]
    app = slack_app or App(token=bot_token, logger=log)

    if deps is None:
        import boto3

        region = os.environ.get("AWS_REGION")
        runtime_arn = os.environ["HOMEBASE_AGENT_RUNTIME_ARN"]
        tenant_id = os.environ.get("HOMEBASE_TENANT_ID", "homebase")
        allow_param = os.environ["HOMEBASE_SLACK_ALLOWLIST_PARAM"]

        def _client(name):
            return boto3.client(name, region_name=region) if region else boto3.client(name)

        deps = Deps(
            resolve_email=_email_resolver(app.client),
            allowlist=Allowlist(_client("ssm"), allow_param),
            agent=AgentClient(runtime_arn, tenant_id, region=region, client=_client("bedrock-agentcore")),
            session_id_for=session_id_for,
        )

    def _respond(event, say):
        thread = event.get("thread_ts") or event.get("ts")
        reply = handle_question(
            text=event.get("text", ""),
            slack_user_id=event.get("user", ""),
            channel=event.get("channel", ""),
            thread=thread,
            deps=deps,
        )
        # Always answer in a thread so channel conversations stay tidy.
        say(text=reply, thread_ts=thread)

    @app.event("app_mention")
    def _on_mention(event, say):
        _respond(event, say)

    @app.event("message")
    def _on_message(event, say):
        # Only direct messages (im). Ignore bot echoes, edits, joins, and any
        # channel message (those arrive as app_mention when we are addressed).
        if event.get("channel_type") != "im":
            return
        if event.get("bot_id") or event.get("subtype"):
            return
        _respond(event, say)

    return app


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    from slack_bolt.adapter.socket_mode import SocketModeHandler

    app = build_app()
    handler = SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])
    log.info("Homebase Slack bridge starting (Socket Mode)")
    handler.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
