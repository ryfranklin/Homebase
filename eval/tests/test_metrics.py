import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.metrics import hit_at_k, mean, reciprocal_rank


class MetricsTests(unittest.TestCase):
    def test_hit_at_k(self):
        ranking = ["a", "b", "c", "d"]
        self.assertEqual(hit_at_k(ranking, ["c"], 3), 1.0)
        self.assertEqual(hit_at_k(ranking, ["d"], 3), 0.0)  # d is rank 4
        self.assertEqual(hit_at_k(ranking, ["z"], 3), 0.0)
        self.assertEqual(hit_at_k(ranking, ["b", "z"], 2), 1.0)

    def test_reciprocal_rank(self):
        ranking = ["a", "b", "c"]
        self.assertEqual(reciprocal_rank(ranking, ["a"]), 1.0)
        self.assertAlmostEqual(reciprocal_rank(ranking, ["b"]), 0.5)
        self.assertAlmostEqual(reciprocal_rank(ranking, ["c"]), 1.0 / 3.0)
        self.assertEqual(reciprocal_rank(ranking, ["z"]), 0.0)

    def test_mean(self):
        self.assertEqual(mean([]), 0.0)
        self.assertAlmostEqual(mean([1.0, 0.0, 0.5]), 0.5)


if __name__ == "__main__":
    unittest.main()
