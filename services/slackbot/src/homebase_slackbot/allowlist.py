"""Slack access gate: only allow-listed emails may talk to Homebase over Slack.

The allow-list is NOT in this repo or in Terraform. It is a by-hand SSM
SecureString (KMS-encrypted) holding a comma or newline separated list of
emails, exactly like the Cognito sign-up allow-list in the identity stack. This
bridge reads it by NAME only. The value never enters the repo, state, or logs.

Membership is checked case-insensitively against the Slack user's verified
email. The list is cached briefly so a busy channel does not hit SSM on every
message; the cache clock is injected so tests stay deterministic.
"""

from __future__ import annotations


def _normalize(raw: str) -> set[str]:
    emails: set[str] = set()
    for chunk in raw.replace("\n", ",").split(","):
        email = chunk.strip().lower()
        if email:
            emails.add(email)
    return emails


class Allowlist:
    def __init__(self, ssm_client, param_name, *, ttl_seconds=60, clock=None):
        self._client = ssm_client
        self._param_name = param_name
        self._ttl = ttl_seconds
        # Monotonic clock, injectable for tests. Defaults to time.monotonic.
        if clock is None:
            import time

            clock = time.monotonic
        self._clock = clock
        self._cached: set[str] | None = None
        self._loaded_at: float = 0.0

    def _load(self) -> set[str]:
        resp = self._client.get_parameter(Name=self._param_name, WithDecryption=True)
        return _normalize(resp["Parameter"]["Value"])

    def _emails(self) -> set[str]:
        now = self._clock()
        if self._cached is None or (now - self._loaded_at) >= self._ttl:
            self._cached = self._load()
            self._loaded_at = now
        return self._cached

    def allows(self, email: str | None) -> bool:
        if not email:
            return False
        return email.strip().lower() in self._emails()
