# ---------------------------------------------------------------------------
# Connector shim Lambdas: one per connector (homebase-<env>-connector-<key>).
# The Gateway targets route MCP tool calls here; each shim enforces the write
# gate and resolves the tenant's OAuth token from AgentCore Identity, then calls
# the vendor API. Built from services/connectors (stdlib + the runtime's boto3,
# so a source-only zip is enough). The Gateway's execution role already grants
# lambda:InvokeFunction on homebase-<env>-connector-* (see main.tf).
# ---------------------------------------------------------------------------
# A caller-owned workload identity for the shim's on-behalf-of token flow. The
# Gateway auto-creates its own workload identity, but that one is service-linked
# ("cannot retrieve an access token by the caller"), so the shim needs its own.
resource "aws_bedrockagentcore_workload_identity" "shim" {
  name = "${local.name_prefix}-connector-shim"
}

# The web GUI domain (from the web stack, P8): AgentCore returns the browser here
# after the user completes 3LO connector consent. Non-secret; read at plan time.
data "aws_ssm_parameter" "web_domain" {
  name = "/${var.project_name}/${var.environment}/web/distribution_domain"
}

data "archive_file" "shim" {
  type        = "zip"
  source_dir  = "${path.module}/../../../services/connectors/src"
  output_path = "${path.module}/build/connectors-shim.zip"
}

data "aws_iam_policy_document" "shim_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "shim" {
  name               = "${local.name_prefix}-connector-shim"
  assume_role_policy = data.aws_iam_policy_document.shim_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "shim" {
  # The AgentCore Identity token flow. Both the workload-token calls (step 1) and
  # GetResourceOauth2Token (step 2) authorize against the workload-identity
  # resource and do NOT honor a credential-provider-scoped grant, so AWS requires
  # resource "*".
  statement {
    sid    = "AgentCoreTokenFlow"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetResourceOauth2Token",
    ]
    resources = ["*"]
  }

  # GetResourceOauth2Token reads the provider's stored OAuth credentials from the
  # AgentCore-managed Secrets Manager vault using the CALLER's identity, so the
  # shim role needs GetSecretValue on this env's identity secrets. The secret name
  # is bedrock-agentcore-identity!default/oauth2/<provider>-<random>; the wildcard
  # covers the random hash and the Secrets Manager 6-char suffix.
  statement {
    sid       = "ReadIdentitySecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:bedrock-agentcore-identity!default/oauth2/${local.name_prefix}-*"]
  }

  statement {
    sid       = "DecryptCredentials"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.connectors_kms.key_arn]
  }

  statement {
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "shim" {
  name   = "${local.name_prefix}-connector-shim-policy"
  role   = aws_iam_role.shim.id
  policy = data.aws_iam_policy_document.shim.json
}

resource "aws_lambda_function" "shim" {
  for_each = local.connectors

  function_name    = "${local.name_prefix}-connector-${each.key}"
  role             = aws_iam_role.shim.arn
  runtime          = "python3.12"
  handler          = "homebase_connectors.handler.handler"
  filename         = data.archive_file.shim.output_path
  source_code_hash = data.archive_file.shim.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      CONNECTOR               = each.key
      CONNECTOR_PROVIDER_ARN  = each.value.provider_arn
      CONNECTOR_PROVIDER_NAME = each.value.provider_name
      CONNECTOR_SCOPES        = join(",", each.value.scopes)
      # Our own caller-owned workload identity for the on-behalf-of token flow.
      WORKLOAD_NAME           = aws_bedrockagentcore_workload_identity.shim.name
      HOMEBASE_DEFAULT_TENANT = var.project_name
      # Where AgentCore returns the browser after 3LO consent completes.
      CONNECTOR_RETURN_URL = "https://${data.aws_ssm_parameter.web_domain.value}/"
    }
  }

  tags = local.common_tags
}
