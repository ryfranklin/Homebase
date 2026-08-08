"""AgentCore Identity token client used by the deployed shim Lambda.

Resolves a tenant's connector OAuth token at runtime via AgentCore Identity. The
boto3 client is created lazily and injected in tests, so importing this module
makes no AWS calls and no token is ever hardcoded. Tokens are requested per
tenant-namespaced key (`<tenant_id>/<connector>`), matching the write-gate and
memory-actor scoping.
"""

from __future__ import annotations

import os


class AgentCoreIdentityClient:
    """Thin wrapper exposing get_token(key) over AgentCore Identity.

    Each connector has its own OAuth2 credential provider (from the connectors
    stack). The provider ARN for a connector is supplied via the
    CONNECTOR_PROVIDER_ARN env var on the shim Lambda; the workload identity of
    the caller (the tenant, carried on the Gateway JWT) scopes the token.
    """

    def __init__(self, provider_arn=None, region=None, client=None):
        self._provider_arn = provider_arn or os.environ.get("CONNECTOR_PROVIDER_ARN", "")
        self._region = region or os.environ.get("AWS_REGION")
        self._client = client  # lazily built if None

    def _agentcore(self):
        if self._client is None:
            import boto3

            self._client = (
                boto3.client("bedrock-agentcore", region_name=self._region)
                if self._region
                else boto3.client("bedrock-agentcore")
            )
        return self._client

    def get_token(self, key: str) -> str:
        """Return the OAuth access token for a tenant-namespaced key.

        `key` is `<tenant_id>/<connector>`. AgentCore Identity holds and refreshes
        the token; the resource/workload scoping ensures a tenant only reaches its
        own connector tokens.
        """
        resp = self._agentcore().get_resource_oauth2_token(
            resourceCredentialProviderArn=self._provider_arn,
            workloadIdentityToken=key,
        )
        # The response carries the access token; tolerate the documented shapes.
        return (
            resp.get("accessToken")
            or resp.get("access_token")
            or resp.get("token", "")
        )
