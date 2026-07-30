import tempfile
import unittest
from pathlib import Path

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_ingestion.metadata import SIDECAR_SUFFIX
from homebase_ingestion.sync import sync_directory


class _NotFound(Exception):
    """Mimics botocore ClientError shape for a missing object."""

    def __init__(self):
        self.response = {"Error": {"Code": "404"}}


class FakeS3Client:
    """In-memory S3 stand-in. No network, no AWS."""

    def __init__(self, preexisting=None):
        # preexisting: {key: content_sha256} to simulate objects already stored.
        self._preexisting = dict(preexisting or {})
        self.objects = {}
        self.puts = []
        self.deletes = []

    def head_object(self, Bucket, Key):
        if Key in self.objects:
            return {"Metadata": self.objects[Key]["Metadata"]}
        if Key in self._preexisting:
            return {"Metadata": {"content-sha256": self._preexisting[Key]}}
        raise _NotFound()

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = {"Body": Body, "Metadata": kwargs.get("Metadata", {}), "kwargs": kwargs}
        self.puts.append(Key)
        return {}

    def list_objects_v2(self, Bucket, Prefix="", ContinuationToken=None):
        keys = sorted(set(list(self.objects) + list(self._preexisting)))
        contents = [{"Key": k} for k in keys if k.startswith(Prefix)]
        return {"Contents": contents, "IsTruncated": False}

    def delete_object(self, Bucket, Key):
        self.deletes.append(Key)
        self.objects.pop(Key, None)
        self._preexisting.pop(Key, None)
        return {}


def _write(root: Path, relpath: str, content: str):
    path = root / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


class SyncDirectoryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_uploads_markdown_with_metadata_and_ignores_non_markdown(self):
        _write(
            self.root,
            "intro.md",
            "---\ntitle: Intro\ntags: [alpha, beta]\n---\nSee [x](./sub/x.md).\n",
        )
        _write(self.root, "sub/x.md", "# X\nplain body\n")
        _write(self.root, "notes.txt", "not markdown, ignored")

        s3 = FakeS3Client()
        result = sync_directory(s3, "bucket", self.root)

        self.assertEqual(sorted(result.uploaded), ["intro.md", "sub/x.md"])
        self.assertEqual(result.skipped, [])
        self.assertNotIn("notes.txt", s3.objects)

        meta = s3.objects["intro.md"]["Metadata"]
        self.assertEqual(meta["fm-title"], "Intro")
        self.assertEqual(meta["fm-tags"], "alpha,beta")
        self.assertEqual(meta["links"], "./sub/x.md")
        self.assertEqual(
            s3.objects["intro.md"]["kwargs"]["ContentType"],
            "text/markdown; charset=utf-8",
        )

    def test_skips_unchanged_objects(self):
        _write(self.root, "a.md", "# A\nbody\n")
        s3 = FakeS3Client()

        first = sync_directory(s3, "bucket", self.root)
        self.assertEqual(first.uploaded, ["a.md"])

        # Second run: content hash matches, so it is skipped.
        s3.puts.clear()
        second = sync_directory(s3, "bucket", self.root)
        self.assertEqual(second.uploaded, [])
        self.assertEqual(second.skipped, ["a.md"])
        self.assertEqual(s3.puts, [])

    def test_large_front_matter_writes_sidecar_object(self):
        big_fm = "".join(f"key{i}: {'x' * 200}\n" for i in range(40))
        _write(self.root, "big.md", f"---\n{big_fm}---\nbody\n")

        s3 = FakeS3Client()
        result = sync_directory(s3, "bucket", self.root)

        sidecar_key = "big.md" + SIDECAR_SUFFIX
        self.assertEqual(result.sidecars, [sidecar_key])
        self.assertIn(sidecar_key, s3.objects)
        self.assertEqual(s3.objects["big.md"]["Metadata"]["metadata-overflow"], "sidecar")

    def test_prune_removes_stale_objects(self):
        _write(self.root, "keep.md", "# keep\n")
        s3 = FakeS3Client(preexisting={"keep.md": "old", "gone.md": "stale"})

        result = sync_directory(s3, "bucket", self.root, prune=True)

        self.assertIn("keep.md", result.uploaded)  # hash differs from "old"
        self.assertEqual(result.pruned, ["gone.md"])
        self.assertIn("gone.md", s3.deletes)

    def test_missing_source_raises(self):
        s3 = FakeS3Client()
        with self.assertRaises(NotADirectoryError):
            sync_directory(s3, "bucket", self.root / "does-not-exist")


if __name__ == "__main__":
    unittest.main()
