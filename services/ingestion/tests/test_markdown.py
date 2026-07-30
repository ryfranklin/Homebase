import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_ingestion.markdown import (
    extract_relative_links,
    split_front_matter,
)


class SplitFrontMatterTests(unittest.TestCase):
    def test_parses_flat_keys_inline_and_block_lists(self):
        text = (
            "---\n"
            "title: Onboarding Notes\n"
            "author: 'Jane Doe'\n"
            "tags: [alpha, beta, gamma]\n"
            "topics:\n"
            "  - retrieval\n"
            "  - agents\n"
            "---\n"
            "# Body\n"
            "content here\n"
        )
        fm, raw, body = split_front_matter(text)
        self.assertEqual(fm["title"], "Onboarding Notes")
        self.assertEqual(fm["author"], "Jane Doe")
        self.assertEqual(fm["tags"], ["alpha", "beta", "gamma"])
        self.assertEqual(fm["topics"], ["retrieval", "agents"])
        self.assertIn("title: Onboarding Notes", raw)
        self.assertTrue(body.startswith("# Body"))

    def test_no_front_matter_returns_body_unchanged(self):
        text = "# Just a heading\n\nno front matter\n"
        fm, raw, body = split_front_matter(text)
        self.assertEqual(fm, {})
        self.assertEqual(raw, "")
        self.assertEqual(body, text)

    def test_unclosed_fence_is_not_front_matter(self):
        text = "---\ntitle: broken\n# no closing fence\n"
        fm, raw, body = split_front_matter(text)
        self.assertEqual(fm, {})
        self.assertEqual(body, text)


class ExtractRelativeLinksTests(unittest.TestCase):
    def test_keeps_relative_excludes_absolute_scheme_and_anchor(self):
        body = (
            "See [notes](./notes/intro.md) and [up](../shared/glossary.md).\n"
            "An image ![diagram](assets/diagram.png).\n"
            "External [site](https://example.invalid/page) and [mail](mailto:x@example.invalid).\n"
            "Site absolute [root](/index.html), protocol relative [pr](//host/x),\n"
            "and an [anchor](#section).\n"
            "Duplicate [again](./notes/intro.md).\n"
        )
        links = extract_relative_links(body)
        self.assertEqual(
            links,
            ["./notes/intro.md", "../shared/glossary.md", "assets/diagram.png"],
        )

    def test_empty_body_has_no_links(self):
        self.assertEqual(extract_relative_links("plain text, no links"), [])


if __name__ == "__main__":
    unittest.main()
