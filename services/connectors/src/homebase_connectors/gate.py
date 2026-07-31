"""The write-confirmation gate: the connector safety core.

Any write action (send email, post to Slack, create a Jira issue or QuickBooks
invoice, modify a calendar or Drive file) returns a ConfirmationContract instead
of executing. Only a re-invocation carrying the matching confirmation token
proceeds. Reads execute directly.

The gate is caller-agnostic: a write is gated whether the caller is the GUI or the
SSH CLI, because both front doors reach connectors through this one gate.
"""

from __future__ import annotations

import hmac

from .catalog import READ, TOOLS
from .confirmation import ConfirmationContract, make_token


class UnknownToolError(KeyError):
    pass


class WriteGate:
    def __init__(self, catalog=None):
        self._catalog = catalog if catalog is not None else TOOLS

    def invoke(self, tool_name, parameters, *, executor, confirm_token=None, caller=None):
        """Dispatch a tool call.

        - Read tools execute immediately via ``executor``.
        - Write tools return a ConfirmationContract unless ``confirm_token`` matches
          the token for exactly these parameters, in which case they execute.

        ``caller`` (for example "gui" or "cli") is recorded for audit only; it never
        changes the gating decision.
        """
        tool = self._catalog.get(tool_name)
        if tool is None:
            raise UnknownToolError(tool_name)

        if tool.access == READ:
            return executor(tool_name, parameters)

        expected = make_token(tool_name, parameters)
        if confirm_token is not None and hmac.compare_digest(str(confirm_token), expected):
            return executor(tool_name, parameters)

        # Not confirmed: return the contract; DO NOT execute the write.
        return ConfirmationContract(
            action=tool_name,
            connector=tool.connector,
            summary=f"{tool.description} via {tool.connector}",
            parameters=dict(parameters),
            confirmation_token=expected,
        )


def is_confirmation(result) -> bool:
    return isinstance(result, ConfirmationContract)
