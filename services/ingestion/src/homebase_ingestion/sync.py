"""Mirror a local Markdown directory into the corpus S3 bucket.

The S3 client is injected, so the unit tests pass a fake and run with no AWS
calls. The source directory is always supplied by the caller; nothing here
embeds a path.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from .markdown import extract_relative_links, split_front_matter
from .metadata import build_metadata

MARKDOWN_EXTENSIONS = (".md", ".markdown")
DEFAULT_CONTENT_TYPE = "text/markdown; charset=utf-8"


@dataclass
class SyncResult:
    uploaded: list = field(default_factory=list)
    skipped: list = field(default_factory=list)
    pruned: list = field(default_factory=list)
    sidecars: list = field(default_factory=list)


def _iter_markdown(source: Path):
    for path in sorted(source.rglob("*")):
        if path.is_file() and path.suffix.lower() in MARKDOWN_EXTENSIONS:
            yield path


def _object_key(rel: Path, key_prefix: str) -> str:
    rel_posix = rel.as_posix()
    prefix = key_prefix.strip("/")
    return f"{prefix}/{rel_posix}" if prefix else rel_posix


def _error_code(exc: Exception):
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        return response.get("Error", {}).get("Code")
    return None


def _head_sha(s3_client, bucket: str, key: str):
    """Return the stored content-sha256 for an object, or None if it is absent."""
    try:
        resp = s3_client.head_object(Bucket=bucket, Key=key)
    except Exception as exc:  # noqa: BLE001 - normalize the not-found cases
        if _error_code(exc) in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return resp.get("Metadata", {}).get("content-sha256")


def _list_keys(s3_client, bucket: str, key_prefix: str):
    keys = []
    token = None
    prefix = key_prefix.strip("/")
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3_client.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            keys.append(obj["Key"])
        if resp.get("IsTruncated") and resp.get("NextContinuationToken"):
            token = resp["NextContinuationToken"]
        else:
            break
    return keys


def sync_directory(
    s3_client,
    bucket: str,
    source_dir,
    *,
    key_prefix: str = "",
    prune: bool = False,
    content_type: str = DEFAULT_CONTENT_TYPE,
) -> SyncResult:
    """Mirror ``source_dir`` of Markdown into ``bucket``.

    Objects whose stored content hash already matches are skipped. Front matter
    and relative links become object metadata (or a sidecar when large). When
    ``prune`` is set, objects under ``key_prefix`` that no longer exist locally
    are deleted. Bucket-default encryption applies; no key id is referenced here.
    """
    source = Path(source_dir)
    if not source.is_dir():
        raise NotADirectoryError(f"source path is not a directory: {source_dir}")

    result = SyncResult()
    seen_keys = set()

    for path in _iter_markdown(source):
        rel = path.relative_to(source)
        key = _object_key(rel, key_prefix)
        seen_keys.add(key)

        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8", errors="replace")
        front_matter, _, body = split_front_matter(text)
        links = extract_relative_links(body)

        metadata, sidecar = build_metadata(rel.as_posix(), key, front_matter, links, sha)
        if sidecar is not None:
            # Reserve the sidecar key so prune never deletes it, even on skip.
            seen_keys.add(sidecar[0])

        if _head_sha(s3_client, bucket, key) == sha:
            result.skipped.append(key)
            continue

        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=raw,
            ContentType=content_type,
            Metadata=metadata,
        )
        result.uploaded.append(key)

        if sidecar is not None:
            sidecar_key, payload = sidecar
            s3_client.put_object(
                Bucket=bucket,
                Key=sidecar_key,
                Body=json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"),
                ContentType="application/json",
                Metadata={"source-path": metadata["source-path"], "content-sha256": sha},
            )
            result.sidecars.append(sidecar_key)

    if prune:
        for key in _list_keys(s3_client, bucket, key_prefix):
            if key not in seen_keys:
                s3_client.delete_object(Bucket=bucket, Key=key)
                result.pruned.append(key)

    return result
