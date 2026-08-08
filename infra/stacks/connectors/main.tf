data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# Non-secret identifiers from the identity stack (P3): the Cognito issuer and app
# client, used to authorize callers of the Gateway with the same JWT the GUI and
# CLI carry (so per-tenant scoping is consistent).
data "aws_ssm_parameter" "issuer_url" {
  name = "/${var.project_name}/${var.environment}/identity/issuer_url"
}

data "aws_ssm_parameter" "app_client_id" {
  name = "/${var.project_name}/${var.environment}/identity/app_client_id"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "connectors"
  }, var.tags)

  name_prefix   = "${var.project_name}-${var.environment}"
  account_id    = data.aws_caller_identity.current.account_id
  partition     = data.aws_partition.current.partition
  issuer_url    = data.aws_ssm_parameter.issuer_url.value
  app_client_id = data.aws_ssm_parameter.app_client_id.value
  discovery_url = "${local.issuer_url}/.well-known/openid-configuration"

  # The union of Google read scopes, shared by all three Google connectors (see
  # the note on the map below).
  google_read_scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ]

  # Read-first scopes per connector. Source of truth is services/connectors
  # catalog.py; these mirror the read scopes only. Write scopes are NOT requested
  # here; a write tool requests its scope only when its gated action runs.
  connectors = {
    # All three Google connectors share ONE provider and request the SAME union of
    # read scopes, because AgentCore vaults tokens by exact scope set (a subset
    # request restarts the 3LO flow). One consent then satisfies gmail/gcal/gdrive
    # and means a single weekly re-auth while the app is in Google Testing mode.
    gmail     = { provider_arn = aws_bedrockagentcore_oauth2_credential_provider.google.credential_provider_arn, provider_name = aws_bedrockagentcore_oauth2_credential_provider.google.name, scopes = local.google_read_scopes, read_tool = "gmail_search_messages", read_desc = "Search Gmail messages (read-only)" }
    gcal      = { provider_arn = aws_bedrockagentcore_oauth2_credential_provider.google.credential_provider_arn, provider_name = aws_bedrockagentcore_oauth2_credential_provider.google.name, scopes = local.google_read_scopes, read_tool = "gcal_list_events", read_desc = "List calendar events (read-only)" }
    gdrive    = { provider_arn = aws_bedrockagentcore_oauth2_credential_provider.google.credential_provider_arn, provider_name = aws_bedrockagentcore_oauth2_credential_provider.google.name, scopes = local.google_read_scopes, read_tool = "gdrive_search_files", read_desc = "Search Drive files (read-only)" }
    slack     = { provider_arn = aws_bedrockagentcore_oauth2_credential_provider.slack.credential_provider_arn, provider_name = aws_bedrockagentcore_oauth2_credential_provider.slack.name, scopes = ["channels:history", "groups:history", "channels:read", "groups:read"], read_tool = "slack_read_messages", read_desc = "Read Slack messages (read-only)" }
    atlassian = { provider_arn = aws_bedrockagentcore_oauth2_credential_provider.atlassian.credential_provider_arn, provider_name = aws_bedrockagentcore_oauth2_credential_provider.atlassian.name, scopes = ["read:jira-work"], read_tool = "jira_search_issues", read_desc = "Search Jira issues (read-only)" }
  }
}

# KMS key for the Gateway and stored connector credentials.
module "connectors_kms" {
  source = "../../modules/kms"

  alias       = "${local.name_prefix}-connectors"
  description = "Homebase ${var.environment} connectors Gateway/Identity key"
  service_principals = [
    "bedrock-agentcore.amazonaws.com",
  ]
  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Gateway execution role: invoke the connector shim Lambdas only.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "gateway_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "gateway" {
  name               = "${local.name_prefix}-connectors-gw"
  assume_role_policy = data.aws_iam_policy_document.gateway_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "gateway" {
  statement {
    sid       = "InvokeConnectorShims"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:${local.partition}:lambda:${var.aws_region}:${local.account_id}:function:${local.name_prefix}-connector-*"]
  }

  # The Gateway encrypts its data with the connectors KMS key, so its execution
  # role needs identity-based key use (the key policy's service-principal grant is
  # not enough for the assumed role). Without this, CreateGateway fails with
  # "not authorized to perform kms:GenerateDataKey".
  statement {
    sid       = "UseGatewayKey"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
    resources = [module.connectors_kms.key_arn]
  }
}

resource "aws_iam_role_policy" "gateway" {
  name   = "${local.name_prefix}-connectors-gw-policy"
  role   = aws_iam_role.gateway.id
  policy = data.aws_iam_policy_document.gateway.json
}

# ---------------------------------------------------------------------------
# AgentCore Gateway (MCP), authorized by the same Cognito JWT the front doors use.
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_gateway" "this" {
  # Gateway names must match ^([0-9a-zA-Z][-]?){1,100}$ (hyphens, NOT underscores;
  # this is the opposite of the AgentCore runtime/memory naming).
  name            = "${local.name_prefix}-connectors"
  role_arn        = aws_iam_role.gateway.arn
  protocol_type   = "MCP"
  authorizer_type = "CUSTOM_JWT"
  kms_key_arn     = module.connectors_kms.key_arn
  description     = "Homebase connectors gateway"

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = local.discovery_url
      allowed_clients = [local.app_client_id]
    }
  }

  protocol_configuration {
    mcp {
      instructions = "Read-first connector tools. Write actions are gated behind a confirmation contract."
    }
  }

  tags = local.common_tags

  # The gateway references only the role ARN, not the role policy, so without this
  # the CreateGateway (which encrypts with the KMS key) can race ahead of the KMS
  # grant attaching/propagating and fail with kms:GenerateDataKey denied.
  depends_on = [aws_iam_role_policy.gateway]
}

# ---------------------------------------------------------------------------
# AgentCore Identity: one OAuth2 credential provider per vendor. Secrets use
# write-only args so they are not stored in state; client ids come from
# git-ignored tfvars. Homebase authenticates each connector independently.
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_oauth2_credential_provider" "google" {
  name                       = "${local.name_prefix}-google"
  credential_provider_vendor = "GoogleOauth2"

  oauth2_provider_config {
    google_oauth2_provider_config {
      client_id_wo                  = var.google_client_id
      client_secret_wo              = var.google_client_secret
      client_credentials_wo_version = var.google_secret_version
    }
  }

  tags = local.common_tags
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "slack" {
  name                       = "${local.name_prefix}-slack"
  credential_provider_vendor = "SlackOauth2"

  oauth2_provider_config {
    slack_oauth2_provider_config {
      client_id_wo                  = var.slack_client_id
      client_secret_wo              = var.slack_client_secret
      client_credentials_wo_version = var.slack_secret_version
    }
  }

  tags = local.common_tags
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "atlassian" {
  name                       = "${local.name_prefix}-atlassian"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id_wo                  = var.atlassian_client_id
      client_secret_wo              = var.atlassian_client_secret
      client_credentials_wo_version = var.atlassian_secret_version

      oauth_discovery {
        discovery_url = var.atlassian_discovery_url
      }
    }
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Gateway targets: one per connector, each attaching its OAuth provider with
# READ-FIRST scopes and routing to the connector's shim Lambda.
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_gateway_target" "connector" {
  for_each = local.connectors

  gateway_identifier = aws_bedrockagentcore_gateway.this.gateway_id
  name               = "${local.name_prefix}-${each.key}"

  # A Lambda target is invoked by the Gateway via its execution role, so it uses
  # the GATEWAY_IAM_ROLE credential type (an OAuth provider can only attach to a
  # direct HTTP/OpenAPI target). The connector's OAuth token is resolved INSIDE the
  # shim Lambda via AgentCore Identity (CONNECTOR_PROVIDER_ARN + CONNECTOR_SCOPES
  # env), not by the Gateway.
  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = lookup(var.connector_shim_lambda_arns, each.key, aws_lambda_function.shim[each.key].arn)

        # The read-first tool this target exposes. Write tools are added only where
        # a gated write exists; they are not requested here.
        tool_schema {
          inline_payload {
            name        = each.value.read_tool
            description = each.value.read_desc

            input_schema {
              type = "object"
            }
          }
        }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Non-secret identifiers exported to SSM for the agent (P6).
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "gateway_id" {
  name  = "/${var.project_name}/${var.environment}/connectors/gateway_id"
  type  = "String"
  value = aws_bedrockagentcore_gateway.this.gateway_id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "gateway_url" {
  name  = "/${var.project_name}/${var.environment}/connectors/gateway_url"
  type  = "String"
  value = aws_bedrockagentcore_gateway.this.gateway_url
  tags  = local.common_tags
}
