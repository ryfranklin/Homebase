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
  # Step 2 of the token flow: exchange a workload identity token for the
  # connector's OAuth token, scoped to this stack's credential providers.
  statement {
    sid     = "GetConnectorToken"
    effect  = "Allow"
    actions = ["bedrock-agentcore:GetResourceOauth2Token"]
    resources = [
      aws_bedrockagentcore_oauth2_credential_provider.google.credential_provider_arn,
      aws_bedrockagentcore_oauth2_credential_provider.slack.credential_provider_arn,
      aws_bedrockagentcore_oauth2_credential_provider.atlassian.credential_provider_arn,
    ]
  }

  # Step 1 of the token flow: get the per-user workload identity token. These act
  # on the workload-identity resource (the WORKLOAD_NAME the shim presents), NOT
  # the credential provider.
  statement {
    sid    = "GetWorkloadToken"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
    ]
    resources = [
      "arn:${local.partition}:bedrock-agentcore:${var.aws_region}:${local.account_id}:workload-identity-directory/default/workload-identity/${local.name_prefix}-connectors",
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
      CONNECTOR_PROVIDER_NAME = each.value.provider_name
      CONNECTOR_SCOPES        = join(",", each.value.scopes)
      # The agent workload identity used for the on-behalf-of token flow. Defaults
      # to the gateway name; confirm/correct at live verification.
      WORKLOAD_NAME           = "${local.name_prefix}-connectors"
      HOMEBASE_DEFAULT_TENANT = var.project_name
    }
  }

  tags = local.common_tags
}
