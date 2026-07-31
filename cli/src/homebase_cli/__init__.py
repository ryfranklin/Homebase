"""Homebase thin chat CLI.

A terminal client for the Homebase agent. It invokes the SAME AgentCore runtime
the GUI uses (behavior parity), rendering the streamed response in a terminal. It
holds no repository access and no long-lived cloud credentials: it authenticates
with the ECS task role via container credentials, and passes tenant and user
identity from task configuration so tenant scoping matches the GUI.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
