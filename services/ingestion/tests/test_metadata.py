import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_ingestion.metadata import (
    S3_USER_METADATA_LIMIT_BYTES,
    SIDECAR_SUFFIX,
    build_metadata,
    metadata_size,
)


class BuildMetadataTests(unittest.TestCase):
    def test_maps_front_matter_and_links_inline(self):
        fm = {"title": "Intro", "tags": ["alpha", "beta"]}
        links = ["./a.md", "../b.md"]
        metadata, sidecar = build_metadata("notes/intro.md", "notes/intro.md", fm, links, "abc123")

        self.assertIsNone(sidecar)
        self.assertEqual(metadata["source-path"], "notes/intro.md")
        self.assertEqual(metadata["content-sha256"], "abc123")
        self.assertEqual(metadata["fm-title"], "Intro")
        self.assertEqual(metadata["fm-tags"], "alpha,beta")
        self.assertEqual(metadata["links"], "./a.md,../b.md")
        self.assertEqual(metadata["links-count"], "2")

    def test_sanitizes_non_ascii_keys_and_values(self):
        fm = {"Auteur Principal": "José Ñandú", "café": "value"}
        metadata, sidecar = build_metadata("f.md", "f.md", fm, [], "sha")
        self.assertIsNone(sidecar)
        # Key is lowercased and non [a-z0-9-] replaced.
        self.assertIn("fm-auteur-principal", metadata)
        # Value keeps ASCII, drops non-ascii characters ("José Ñandú" -> "Jos and").
        self.assertEqual(metadata["fm-auteur-principal"], "Jos and")
        self.assertIn("fm-caf", metadata)

    def test_large_front_matter_spills_to_sidecar(self):
        big = {f"key{i}": "x" * 200 for i in range(40)}  # far over 2 KB
        links = ["./a.md", "./b.md"]
        metadata, sidecar = build_metadata("big.md", "corpus/big.md", big, links, "deadbeef")

        # Spilled: pointer present, inline stays small, nothing silently dropped.
        self.assertEqual(metadata["metadata-overflow"], "sidecar")
        self.assertEqual(metadata["sidecar-key"], "corpus/big.md" + SIDECAR_SUFFIX)
        self.assertLessEqual(metadata_size(metadata), S3_USER_METADATA_LIMIT_BYTES)

        self.assertIsNotNone(sidecar)
        sidecar_key, payload = sidecar
        self.assertEqual(sidecar_key, "corpus/big.md" + SIDECAR_SUFFIX)
        self.assertEqual(payload["front_matter"], big)  # full front matter preserved
        self.assertEqual(payload["links"], links)
        self.assertEqual(payload["content_sha256"], "deadbeef")

    def test_no_front_matter_no_links(self):
        metadata, sidecar = build_metadata("x.md", "x.md", {}, [], "sha")
        self.assertIsNone(sidecar)
        self.assertEqual(metadata["links-count"], "0")
        self.assertNotIn("links", metadata)


if __name__ == "__main__":
    unittest.main()
