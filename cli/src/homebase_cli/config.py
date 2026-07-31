"""CLI configuration, all from environment variables that the ECS task provides.
No literals: the runtime ARN and the tenant/user identity come from task config.
"""

from __future__ import annotations

from dataclasses import dataclass

RUNTIME_ARN_ENV = "HOMEBASE_AGENT_RUNTIME_ARN"
USER_ID_ENV = "HOMEBASE_USER_ID"
TENANT_ID_ENV = "HOMEBASE_TENANT_ID"
REGION_ENV = "AWS_REGION"


@dataclass(frozen=True)
class CliConfig:
    runtime_arn: str
    user_id: str
    tenant_id: str
    region: str | None


def load_config(env):
    required = {RUNTIME_ARN_ENV: None, USER_ID_ENV: None, TENANT_ID_ENV: None}
    missing = [k for k in required if not env.get(k)]
    if missing:
        raise SystemExit(f"missing required env: {', '.join(missing)}")
    return CliConfig(
        runtime_arn=env[RUNTIME_ARN_ENV],
        user_id=env[USER_ID_ENV],
        tenant_id=env[TENANT_ID_ENV],
        region=env.get(REGION_ENV),
    )
