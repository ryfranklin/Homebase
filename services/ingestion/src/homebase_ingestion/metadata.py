"""Map Markdown front matter and relative links into S3 object metadata.

S3 caps user-defined object metadata at 2 KB total (keys plus values). When the
front matter and links fit, they go inline as ``x-amz-meta-*`` headers. When
they would exceed the budget, the full set is spilled into a sidecar JSON object
and the inline metadata records a pointer to it. Nothing is silently dropped:
retrieval filtering in P5 can read either the inline metadata or the sidecar.
"""

from __future__ import annotations

import re

# S3 hard limit on total user metadata size (keys + values), in bytes.
S3_USER_METADATA_LIMIT_BYTES = 2048

# Budget we keep inline, leaving margin under the hard limit for the pointer
# fields that get added on spill.
DEFAULT_METADATA_BUDGET_BYTES = 1900

# Suffix for the sidecar object that holds spilled metadata.
SIDECAR_SUFFIX = ".metadata.json"


def _sanitize_key(key: str) -> str:
    k = re.sub(r"[^a-z0-9-]", "-", str(key).strip().lower())
    k = re.sub(r"-+", "-", k).strip("-")
    return k or "key"


def _sanitize_value(value) -> str:
    """Coerce a value to an ASCII, single-line string suitable for an S3 header."""
    if isinstance(value, (list, tuple)):
        value = ",".join(str(v) for v in value)
    s = str(value).replace("\n", " ").replace("\r", " ")
    s = "".join(ch for ch in s if 32 <= ord(ch) < 127)
    return s.strip()


def metadata_size(metadata: dict) -> int:
    """Total byte size of the metadata (keys plus values), as S3 counts it."""
    return sum(len(k.encode("utf-8")) + len(v.encode("utf-8")) for k, v in metadata.items())


def build_metadata(
    source_path: str,
    object_key: str,
    front_matter: dict,
    links: list,
    content_sha256: str,
    *,
    budget: int = DEFAULT_METADATA_BUDGET_BYTES,
):
    """Return (metadata, sidecar).

    ``metadata`` is the dict of inline S3 user metadata. ``sidecar`` is either
    None (everything fit inline) or a (sidecar_key, payload) tuple to be written
    as a separate JSON object.
    """
    base = {
        "source-path": _sanitize_value(source_path),
        "content-sha256": content_sha256,
        "ingest-tool": "homebase-ingestion",
        "links-count": str(len(links)),
    }

    inline = dict(base)
    for k, v in front_matter.items():
        inline[f"fm-{_sanitize_key(k)}"] = _sanitize_value(v)
    if links:
        inline["links"] = _sanitize_value(",".join(links))

    if metadata_size(inline) <= budget:
        return inline, None

    # Spill the full front matter and links into a sidecar object.
    sidecar_key = object_key + SIDECAR_SUFFIX
    metadata = dict(base)
    metadata["metadata-overflow"] = "sidecar"
    metadata["sidecar-key"] = _sanitize_value(sidecar_key)

    payload = {
        "source_path": source_path,
        "content_sha256": content_sha256,
        "front_matter": front_matter,
        "links": links,
    }
    return metadata, (sidecar_key, payload)
