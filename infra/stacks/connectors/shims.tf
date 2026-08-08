# ---------------------------------------------------------------------------
# Connector shim Lambdas: one per connector (homebase-<env>-connector-<key>).
# The Gateway targets route MCP tool calls here; each shim enforces the write
# gate and resolves the tenant's OAuth token from AgentCore Identity, then calls
# the vendor API. Built from services/connectors (stdlib + the runtime's boto3,
# so a source-only zip is enough). The Gateway's execution role already grants
# lambda:InvokeFunction on homebase-<env>-connector-* (see main.tf).
# ---------------------------------------------------------------------------
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
  # Resolve the per-tenant connector OAuth token from AgentCore Identity, scoped
  # to this stack's credential providers only.
  statement {
    sid    = "GetConnectorToken"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetResourceOauth2Token",
      "bedrock-agentcore:GetWorkloadAccessToken",
    ]
    resources = [
      aws_bedrockagentcore_oauth2_credential_provider.google.credential_provider_arn,
      aws_bedrockagentcore_oauth2_credential_provider.slack.credential_provider_arn,
      aws_bedrockagentcore_oauth2_credential_provider.atlassian.credential_provider_arn,
    ]
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
      HOMEBASE_DEFAULT_TENANT = var.project_name
    }
  }

  tags = local.common_tags
}
