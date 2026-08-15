"""Offline tests for the Slack allow-list gate (SSM SecureString, cached)."""

import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_slackbot.allowlist import Allowlist


class _FakeSsm:
    def __init__(self, value: str):
        self.value = value
        self.calls = 0

    def get_parameter(self, **kwargs):
        self.calls += 1
        assert kwargs.get("WithDecryption") is True
        return {"Parameter": {"Value": self.value}}


class AllowlistTest(unittest.TestCase):
    def test_membership_is_case_insensitive_and_trimmed(self):
        ssm = _FakeSsm("Alice@Example.com, bob@example.com\n carol@example.com ")
        al = Allowlist(ssm, "/p", clock=lambda: 0.0)
        self.assertTrue(al.allows("alice@example.com"))
        self.assertTrue(al.allows("  BOB@EXAMPLE.COM "))
        self.assertTrue(al.allows("carol@example.com"))
        self.assertFalse(al.allows("mallory@example.com"))

    def test_empty_email_denied(self):
        al = Allowlist(_FakeSsm("a@b.com"), "/p", clock=lambda: 0.0)
        self.assertFalse(al.allows(None))
        self.assertFalse(al.allows(""))

    def test_cache_reused_within_ttl_then_refreshes(self):
        ssm = _FakeSsm("a@b.com")
        now = {"t": 0.0}
        al = Allowlist(ssm, "/p", ttl_seconds=60, clock=lambda: now["t"])
        al.allows("a@b.com")
        al.allows("a@b.com")
        self.assertEqual(ssm.calls, 1)  # cached
        now["t"] = 61.0
        al.allows("a@b.com")
        self.assertEqual(ssm.calls, 2)  # refreshed after ttl


if __name__ == "__main__":
    unittest.main()
