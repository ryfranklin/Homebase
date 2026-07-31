"""Render streamed agent events to a terminal writer.

Kept pure (writer is injected) so it is unit-testable with a StringIO.
"""

from __future__ import annotations


def _dedupe(items):
    seen = set()
    out = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def render_stream(events, out):
    """Write tokens as they arrive, note tool calls, and list citations at the
    end. Returns True if the answer was grounded (carried at least one citation),
    mirroring the GUI's contract that a grounded answer shows sources."""
    citations = []
    saw_token = False

    for event in events:
        kind = event.get("type")
        if kind == "token":
            out.write(event.get("text", ""))
            out.flush()
            saw_token = True
        elif kind == "tool_call":
            out.write(f"\n  · {event.get('name', 'tool call')}\n")
        elif kind == "citation":
            source = event.get("source_path", "")
            if source:
                citations.append(source)
        elif kind == "error":
            out.write(f"\n[error: {event.get('message', 'stream error')}]\n")
        elif kind == "done":
            break

    out.write("\n")
    unique = _dedupe(citations)
    if unique:
        out.write("\nsources:\n")
        for source in unique:
            out.write(f"  - {source}\n")
    elif not saw_token:
        out.write("(no response)\n")

    return len(unique) > 0
