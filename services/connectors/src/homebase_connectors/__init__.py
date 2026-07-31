"""Homebase connectors: six live integrations as read-first, write-gated MCP tools.

The safety core is the write-confirmation gate (gate.py): any write action returns
a confirmation contract instead of executing, and the gate lives at the tool layer
so both front doors (the GUI and the SSH CLI) inherit it. Connector data is fetched
live per query and is NEVER written into the corpus / S3 Vectors store (ADR-004).
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
