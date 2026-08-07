"""Homebase thin chat CLI.

A minimal client for the AgentCore agent runtime. It presents the CLI task's
user and tenant identity (kept explicit, per the multi-tenant seed) and prints
the agent's grounded, cited answer. All configuration is read from environment
variables set on the ssh-chat Fargate task; the task's IAM role is the only
credential.
"""

__version__ = "0.1.0"
