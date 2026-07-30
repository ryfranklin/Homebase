data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# Non-secret identifiers published by earlier stacks. Read at plan/apply time;
# validate does not call AWS.
data "aws_ssm_parameter" "agent_runtime_arn" {
  name = "/${var.project_name}/${var.environment}/agent/runtime_arn"
}

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
    Stack       = "api"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}"

  agent_runtime_arn = data.aws_ssm_parameter.agent_runtime_arn.value
  issuer_url        = data.aws_ssm_parameter.issuer_url.value
  app_client_id     = data.aws_ssm_parameter.app_client_id.value
}

# KMS key for the BFF log group.
module "api_kms" {
  source = "../../modules/kms"

  alias              = "${local.name_prefix}-api"
  description        = "Homebase ${var.environment} API/BFF logs key"
  service_principals = ["logs.amazonaws.com"]
  tags               = local.common_tags
}

# ---------------------------------------------------------------------------
# Package the Node.js BFF from services/bff/src. The BFF has no npm runtime
# dependencies of its own (Node stdlib plus the AWS SDK provided by the runtime),
# so zipping the source is enough. The build zip lands in a git-ignored build/.
# ---------------------------------------------------------------------------
data "archive_file" "bff" {
  type        = "zip"
  source_dir  = "${path.module}/../../../services/bff/src"
  output_path = "${path.module}/build/bff.zip"
}

# ---------------------------------------------------------------------------
# Least-privilege execution role: invoke the AgentCore runtime and write logs.
# No S3, no broad Bedrock.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bff" {
  name               = "${local.name_prefix}-bff-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  tags               = local.common_tags
}

resource "aws_cloudwatch_log_group" "bff" {
  name              = "/aws/lambda/${local.name_prefix}-bff"
  retention_in_days = 30
  kms_key_id        = module.api_kms.key_arn
  tags              = local.common_tags
}

data "aws_iam_policy_document" "bff" {
  statement {
    sid       = "InvokeAgentRuntime"
    effect    = "Allow"
    actions   = ["bedrock-agentcore:InvokeAgentRuntime", "bedrock-agentcore:InvokeAgentRuntimeForUser"]
    resources = [local.agent_runtime_arn, "${local.agent_runtime_arn}/*"]
  }

  statement {
    sid       = "WriteLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.bff.arn}:*"]
  }
}

resource "aws_iam_role_policy" "bff" {
  name   = "${local.name_prefix}-bff-policy"
  role   = aws_iam_role.bff.id
  policy = data.aws_iam_policy_document.bff.json
}

# ---------------------------------------------------------------------------
# The streaming BFF Lambda (Node.js: response streaming is a Node managed-runtime
# feature).
# ---------------------------------------------------------------------------
resource "aws_lambda_function" "bff" {
  function_name = "${local.name_prefix}-bff"
  role          = aws_iam_role.bff.arn
  runtime       = "nodejs20.x"
  handler       = "handler.handler"
  filename      = data.archive_file.bff.output_path

  source_code_hash = data.archive_file.bff.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = {
      HOMEBASE_ISSUER            = local.issuer_url
      HOMEBASE_AUDIENCE          = local.app_client_id
      HOMEBASE_AGENT_RUNTIME_ARN = local.agent_runtime_arn
      HOMEBASE_ALLOWED_ORIGIN    = var.spa_origin
    }
  }

  depends_on = [aws_cloudwatch_log_group.bff, aws_iam_role_policy.bff]
  tags       = local.common_tags
}

# ---------------------------------------------------------------------------
# Lambda Function URL with response streaming. The streaming endpoint is a
# Function URL, NEVER behind API Gateway (HTTP APIs buffer; they do not stream).
# CORS is restricted to the SPA origin.
# ---------------------------------------------------------------------------
resource "aws_lambda_function_url" "bff" {
  function_name      = aws_lambda_function.bff.function_name
  authorization_type = var.function_url_auth_type
  invoke_mode        = "RESPONSE_STREAM"

  cors {
    allow_credentials = false
    allow_origins     = [var.spa_origin]
    allow_methods     = ["POST"]
    allow_headers     = ["authorization", "content-type"]
    max_age           = 300
  }
}

# ---------------------------------------------------------------------------
# CloudFront OAC seam (only when auth type is AWS_IAM). The distribution and the
# lambda permission that grants it invoke are created in P8, where the
# distribution ARN exists. See README for the POST body-signing caveat that made
# NONE the default.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "bff" {
  count = var.function_url_auth_type == "AWS_IAM" ? 1 : 0

  name                              = "${local.name_prefix}-bff-oac"
  description                       = "OAC for the BFF Lambda Function URL origin"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# No API Gateway HTTP API is created: the only endpoint is the streaming BFF,
# which must not sit behind API Gateway. If non-streaming request/response
# endpoints are added later, add an aws_apigatewayv2_api (HTTP) with a Cognito
# JWT authorizer here, and keep the streaming path on the Function URL.
# ---------------------------------------------------------------------------

# Non-secret endpoint published for the CloudFront wiring in P8.
resource "aws_ssm_parameter" "bff_function_url" {
  name  = "/${var.project_name}/${var.environment}/api/bff_function_url"
  type  = "String"
  value = aws_lambda_function_url.bff.function_url
  tags  = local.common_tags
}
