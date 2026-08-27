"""The tool-loop system suffix is scope-aware: general/web answers may use the web,
vault answers may not, and planning/authoring stay non-strict regardless of scope."""

import unittest

import _bootstrap  # noqa: F401

from homebase_agent.agent import _tool_suffix


class ToolSuffixTests(unittest.TestCase):
    def test_catalog_always_lists_the_web_tools(self):
        for scope in ("general", "vault"):
            self.assertIn("web_search, web_fetch", _tool_suffix(scope))

    def test_general_scope_encourages_web_search(self):
        s = _tool_suffix("general")
        self.assertIn("Reach for web_search", s)
        self.assertNotIn("Do\nNOT call web_search", s)

    def test_vault_scope_forbids_the_web(self):
        s = _tool_suffix("vault")
        self.assertIn("NOT call web_search or web_fetch", s)
        self.assertNotIn("Reach for web_search", s)

    def test_planning_and_authoring_are_non_strict_even_when_scope_is_vault(self):
        # /plan and author mode default to scope="vault" from the client, but they are not
        # vault Q&A, so they must NOT get the "KB + connectors only" restriction.
        for kwargs in ({"planning": True}, {"authoring": True}):
            s = _tool_suffix("vault", **kwargs)
            self.assertIn("Reach for web_search", s)
            self.assertNotIn("NOT call web_search or web_fetch", s)


if __name__ == "__main__":
    unittest.main()
