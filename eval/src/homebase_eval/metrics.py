"""Retrieval metrics: hit rate at k and reciprocal rank."""

from __future__ import annotations


def hit_at_k(ranking, expected, k: int) -> float:
    """1.0 if any expected source appears in the top k of the ranking, else 0.0."""
    expected = set(expected)
    return 1.0 if any(item in expected for item in ranking[:k]) else 0.0


def reciprocal_rank(ranking, expected) -> float:
    """1/rank of the first expected source in the ranking, or 0.0 if none appear."""
    expected = set(expected)
    for position, item in enumerate(ranking, start=1):
        if item in expected:
            return 1.0 / position
    return 0.0


def mean(values) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0
