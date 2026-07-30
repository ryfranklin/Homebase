"""Markdown parsing helpers: front matter and relative links.

Deliberately dependency-free (standard library only) so the unit tests run
offline. The front matter parser handles the flat ``key: value`` and simple
list shapes that knowledge base documents use in practice; it is not a full
YAML implementation.
"""

from __future__ import annotations

import re

# Inline links and images: [text](target) and ![alt](target). Captures the
# target up to whitespace or the closing paren (so an optional "title" is
# excluded).
_INLINE_LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")

# A URL scheme such as http:, https:, mailto:, ftp:.
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)


def _scalar(value: str):
    """Strip matched surrounding quotes from a scalar value."""
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _parse_simple_yaml(raw: str) -> dict:
    """Parse flat ``key: value`` front matter, inline ``[a, b]`` lists, and
    block lists written as ``- item`` under a key."""
    data: dict = {}
    current_key = None

    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue

        stripped = line.lstrip()
        if stripped.startswith("- ") and current_key is not None:
            if not isinstance(data.get(current_key), list):
                data[current_key] = []
            data[current_key].append(_scalar(stripped[2:]))
            continue

        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            if val == "":
                # A block list may follow on subsequent lines.
                data[key] = []
                current_key = key
            elif val.startswith("[") and val.endswith("]"):
                inner = val[1:-1].strip()
                data[key] = [_scalar(x) for x in inner.split(",") if x.strip()] if inner else []
                current_key = None
            else:
                data[key] = _scalar(val)
                current_key = None

    return data


def split_front_matter(text: str):
    """Split a Markdown document into (front_matter_dict, raw_front_matter, body).

    Front matter is a block delimited by ``---`` fences at the very top of the
    file. When there is none, returns ({}, "", text).
    """
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, "", text

    for i in range(1, len(lines)):
        if lines[i].strip() in ("---", "..."):
            raw = "".join(lines[1:i])
            body = "".join(lines[i + 1:])
            return _parse_simple_yaml(raw), raw, body

    # No closing fence: treat the whole document as body.
    return {}, "", text


def extract_relative_links(text: str) -> list:
    """Return the relative link targets in a Markdown body, in order, deduped.

    Absolute URLs (with a scheme), protocol-relative (``//host``), site-absolute
    (``/path``), and pure anchors (``#section``) are excluded; only links
    relative to the document itself are kept.
    """
    seen = set()
    ordered = []
    for target in _INLINE_LINK.findall(text):
        target = target.strip()
        if not target or target.startswith("#"):
            continue
        if target.startswith("//") or target.startswith("/"):
            continue
        if _SCHEME.match(target):
            continue
        if target not in seen:
            seen.add(target)
            ordered.append(target)
    return ordered
