import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_connectors.confirmation import ConfirmationContract, make_token
from homebase_connectors.gate import UnknownToolError, WriteGate, is_confirmation


class RecordingExecutor:
    def __init__(self, result="ok"):
        self.calls = []
        self._result = result

    def __call__(self, tool_name, parameters):
        self.calls.append((tool_name, parameters))
        return self._result


class WriteGateTests(unittest.TestCase):
    def setUp(self):
        self.gate = WriteGate()

    def test_read_executes_immediately(self):
        ex = RecordingExecutor("results")
        out = self.gate.invoke("gmail.search_messages", {"q": "invoice"}, executor=ex)
        self.assertEqual(out, "results")
        self.assertEqual(len(ex.calls), 1)

    def test_write_without_confirmation_returns_contract_and_does_not_execute(self):
        ex = RecordingExecutor()
        out = self.gate.invoke("gmail.send_message", {"to": "a@example.invalid"}, executor=ex)
        self.assertTrue(is_confirmation(out))
        self.assertIsInstance(out, ConfirmationContract)
        self.assertEqual(out.action, "gmail.send_message")
        self.assertTrue(out.requires_confirmation)
        self.assertEqual(ex.calls, [])  # the write did NOT run

    def test_write_with_matching_token_executes(self):
        ex = RecordingExecutor("sent")
        params = {"to": "a@example.invalid", "subject": "hi"}
        token = make_token("gmail.send_message", params)
        out = self.gate.invoke("gmail.send_message", params, executor=ex, confirm_token=token)
        self.assertEqual(out, "sent")
        self.assertEqual(len(ex.calls), 1)

    def test_write_with_wrong_token_stays_gated(self):
        ex = RecordingExecutor()
        out = self.gate.invoke("slack.post_message", {"text": "hi"}, executor=ex, confirm_token="confirm-bogus")
        self.assertTrue(is_confirmation(out))
        self.assertEqual(ex.calls, [])

    def test_token_is_parameter_specific(self):
        # A token for one payload must not confirm a different payload.
        ex = RecordingExecutor()
        token = make_token("slack.post_message", {"text": "hello"})
        out = self.gate.invoke("slack.post_message", {"text": "DIFFERENT"}, executor=ex, confirm_token=token)
        self.assertTrue(is_confirmation(out))
        self.assertEqual(ex.calls, [])

    def test_gate_is_caller_agnostic(self):
        # Same gating whether the caller is the GUI or the SSH CLI.
        for caller in ("gui", "cli", None):
            ex = RecordingExecutor()
            out = self.gate.invoke("jira.create_issue", {"summary": "x"}, executor=ex, caller=caller)
            self.assertTrue(is_confirmation(out), f"write must be gated for caller={caller}")
            self.assertEqual(ex.calls, [])

    def test_all_six_connectors_gate_their_writes(self):
        writes = {
            "gmail.send_message": {"to": "x"},
            "gcal.create_event": {"title": "x"},
            "gdrive.update_file": {"id": "x"},
            "slack.post_message": {"text": "x"},
            "qbo.create_invoice": {"amount": 1},
            "jira.create_issue": {"summary": "x"},
        }
        for tool, params in writes.items():
            ex = RecordingExecutor()
            out = self.gate.invoke(tool, params, executor=ex)
            self.assertTrue(is_confirmation(out), f"{tool} must be gated")
            self.assertEqual(ex.calls, [], f"{tool} must not execute")

    def test_unknown_tool_raises(self):
        with self.assertRaises(UnknownToolError):
            self.gate.invoke("nope.do_thing", {}, executor=RecordingExecutor())


if __name__ == "__main__":
    unittest.main()
