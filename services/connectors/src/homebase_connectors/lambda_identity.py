"""AgentCore Identity token client used by the deployed shim Lambda.

Resolves a tenant's connector OAuth token at runtime via AgentCore Identity's
two-step on-behalf-of flow:

  1. get_workload_access_token_for_user_id(workloadName, userId=tenant) -> a
     workload identity token scoped to that user/tenant.
  2. get_resource_oauth2_token(workloadIdentityToken, resourceCredentialProviderName,
     scopes, oauth2Flow) -> the connector's OAuth access token, or an authorization
     URL the user must visit once to grant consent (3LO).

Everything is env-driven (CONNECTOR_PROVIDER_NAME, CONNECTOR_SCOPES, WORKLOAD_NAME)
and the boto3 client is injected in tests, so no token or id is hardcoded and
importing this module makes no AWS calls.

LIVE VERIFICATION PENDING: the exact WORKLOAD_NAME (the agent's registered workload
identity) and the first-time consent round-trip are confirmed by running a real
connector read; the API call shapes here match the documented parameters.
"""

from __future__ import annotations

import os


class AuthorizationRequiredError(RuntimeError):
    """Raised on the first use of a connector for a tenant: the user must visit
    ``authorization_url`` to grant consent before a token can be issued."""

    def __init__(self, authorization_url):
        super().__init__("connector authorization required")
        self.authorization_url = authorization_url


class AgentCoreIdentityClient:
    def __init__(
        self,
        provider_name=None,
        scopes=None,
        workload_name=None,
        oauth2_flow="USER_FEDERATION",
        region=None,
        client=None,
    ):
        self._provider_name = provider_name or os.environ.get("CONNECTOR_PROVIDER_NAME", "")
        env_scopes = os.environ.get("CONNECTOR_SCOPES", "")
        self._scopes = scopes if scopes is not None else [s for s in env_scopes.split(",") if s]
        self._workload_name = workload_name or os.environ.get("WORKLOAD_NAME", "")
        self._oauth2_flow = oauth2_flow
        self._region = region or os.environ.get("AWS_REGION")
        self._client = client

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
        """Return the connector OAuth token for a tenant-namespaced key
        (``<tenant_id>/<connector>``). Raises AuthorizationRequiredError if the
        user has not yet consented."""
        tenant_id = key.split("/", 1)[0]
        c = self._agentcore()

        workload = c.get_workload_access_token_for_user_id(
            workloadName=self._workload_name, userId=tenant_id
        )
        workload_token = workload.get("workloadAccessToken") or workload.get("workload_access_token")

        resp = c.get_resource_oauth2_token(
            workloadIdentityToken=workload_token,
            resourceCredentialProviderName=self._provider_name,
            scopes=self._scopes,
            oauth2Flow=self._oauth2_flow,
        )
        token = resp.get("accessToken") or resp.get("access_token")
        if token:
            return token

        url = resp.get("authorizationUrl") or resp.get("authorization_url")
        if url:
            raise AuthorizationRequiredError(url)
        return ""
