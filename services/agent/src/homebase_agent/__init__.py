"""Homebase AgentCore agent: Claude on Bedrock with cited retrieval.

The agent answers only from passages retrieved from the P5 Knowledge Base and
attaches source citations to every grounded answer. User and tenant identity are
explicit in the session model.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
