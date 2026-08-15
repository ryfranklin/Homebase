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

# Vault workspace: the BFF reads/writes the S3 Markdown corpus (the editable vault)
# and triggers a KB sync on save. Bucket + CMK come from storage (P3); the KB and
# data source ids come from retrieval (P4).
data "aws_ssm_parameter" "corpus_bucket_name" {
  name = "/${var.project_name}/${var.environment}/storage/corpus_bucket_name"
}

data "aws_ssm_parameter" "corpus_kms_key_arn" {
  name = "/${var.project_name}/${var.environment}/storage/corpus_kms_key_arn"
}

data "aws_ssm_parameter" "knowledge_base_id" {
  name = "/${var.project_name}/${var.environment}/retrieval/knowledge_base_id"
}

data "aws_ssm_parameter" "data_source_id" {
  name = "/${var.project_name}/${var.environment}/retrieval/data_source_id"
}

# Vault worker (git source of truth). The BFF joins the worker's client SG + private
# subnet to reach the internal write API, and reads the worker URL + shared secret.
data "aws_ssm_parameter" "vault_worker_url" {
  name = "/${var.project_name}/${var.environment}/vault-worker/url"
}
data "aws_ssm_parameter" "vault_worker_secret_arn" {
  name = "/${var.project_name}/${var.environment}/vault-worker/shared_secret_arn"
}
data "aws_ssm_parameter" "vault_worker_client_sg" {
  name = "/${var.project_name}/${var.environment}/vault-worker/client_security_group_id"
}
data "aws_ssm_parameter" "vault_worker_private_subnet" {
  name = "/${var.project_name}/${var.environment}/vault-worker/private_subnet_id"
}

# Mission Control (the execution engine): the BFF reaches it over Cloud Map and
# presents the bearer token (read from Secrets Manager at cold start). Published by
# the mission-control stack, which must be applied before this stack.
data "aws_ssm_parameter" "mission_control_url" {
  name = "/${var.project_name}/${var.environment}/mission-control/url"
}
data "aws_ssm_parameter" "mission_control_token_secret_arn" {
  name = "/${var.project_name}/${var.environment}/mission-control/api_token_secret_arn"
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

  corpus_bucket_name = data.aws_ssm_parameter.corpus_bucket_name.value
  corpus_kms_key_arn = data.aws_ssm_parameter.corpus_kms_key_arn.value
  knowledge_base_id  = data.aws_ssm_parameter.knowledge_base_id.value
  data_source_id     = data.aws_ssm_parameter.data_source_id.value
  corpus_bucket_arn  = "arn:${data.aws_partition.current.partition}:s3:::${data.aws_ssm_parameter.corpus_bucket_name.value}"
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
# Origin shared secret. CloudFront (P8) injects this as a custom header on origin
# requests; the BFF requires it, so a direct hit on the Function URL that bypasses
# CloudFront and the WAF is refused. The value is generated here and stored in
# Secrets Manager; it is never a literal in the repo. The web stack reads it from
# Secrets Manager (by the ARN exported to SSM below) for the CloudFront header.
# ---------------------------------------------------------------------------
resource "random_password" "origin_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "origin_secret" {
  name        = "${local.name_prefix}/origin-shared-secret"
  description = "Shared secret CloudFront injects on BFF origin requests"
  kms_key_id  = module.api_kms.key_arn
  tags        = local.common_tags
}

resource "aws_secretsmanager_secret_version" "origin_secret" {
  secret_id     = aws_secretsmanager_secret.origin_secret.id
  secret_string = random_password.origin_secret.result
}

resource "aws_ssm_parameter" "origin_secret_arn" {
  name  = "/${var.project_name}/${var.environment}/api/origin_secret_arn"
  type  = "String"
  value = aws_secretsmanager_secret.origin_secret.arn
  tags  = local.common_tags
}

# ---------------------------------------------------------------------------
# Rotation for the origin shared secret (a rotatable, generated credential). The
# rotation Lambda updates both Secrets Manager and the CloudFront custom header,
# and the BFF accepts current+pending during the window, so rotation is
# automatic. (Connector OAuth tokens are NOT rotated this way: AgentCore Identity
# refreshes them. See docs/secrets.md.)
# ---------------------------------------------------------------------------
data "archive_file" "rotation" {
  type        = "zip"
  source_dir  = "${path.module}/rotation"
  output_path = "${path.module}/build/rotation.zip"
}

data "aws_iam_policy_document" "rotation_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rotation" {
  name               = "${local.name_prefix}-origin-rotation-role"
  assume_role_policy = data.aws_iam_policy_document.rotation_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "rotation" {
  statement {
    sid    = "RotateSecret"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = ["${aws_secretsmanager_secret.origin_secret.arn}*"]
  }

  statement {
    sid       = "ReadWebPointers"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/web/*"]
  }

  # Update the CloudFront custom header. GetDistributionConfig/UpdateDistribution
  # require resource "*" (AWS requirement); scope by tag/condition is not
  # available for these actions.
  statement {
    sid       = "UpdateCloudFrontHeader"
    effect    = "Allow"
    actions   = ["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"]
    resources = ["*"]
  }

  statement {
    sid       = "UseKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.api_kms.key_arn]
  }

  statement {
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "rotation" {
  name   = "${local.name_prefix}-origin-rotation-policy"
  role   = aws_iam_role.rotation.id
  policy = data.aws_iam_policy_document.rotation.json
}

resource "aws_lambda_function" "rotation" {
  function_name    = "${local.name_prefix}-origin-rotation"
  role             = aws_iam_role.rotation.arn
  runtime          = "python3.12"
  handler          = "rotate_origin_secret.handler"
  filename         = data.archive_file.rotation.output_path
  source_code_hash = data.archive_file.rotation.output_base64sha256
  timeout          = 60

  environment {
    variables = {
      PROJECT     = var.project_name
      ENVIRONMENT = var.environment
    }
  }

  tags = local.common_tags
}

resource "aws_lambda_permission" "rotation" {
  statement_id  = "AllowSecretsManager"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
}

resource "aws_secretsmanager_secret_rotation" "origin_secret" {
  secret_id           = aws_secretsmanager_secret.origin_secret.id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  rotation_rules {
    automatically_after_days = var.origin_secret_rotation_days
  }

  depends_on = [aws_lambda_permission.rotation]
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

  # Finalize a connector's 3LO consent: when the SPA posts back the session_id from
  # the browser return, the BFF calls CompleteResourceTokenAuth to promote the
  # OAuth token into the vault. Like the other AgentCore token-vault actions it is
  # authorized against the workload-identity resource and does not honor a tighter
  # resource scope, so it requires "*".
  statement {
    sid       = "CompleteConnectorAuth"
    effect    = "Allow"
    actions   = ["bedrock-agentcore:CompleteResourceTokenAuth"]
    resources = ["*"]
  }

  # CompleteResourceTokenAuth reads the connector provider's stored OAuth
  # credentials from the AgentCore-managed Secrets Manager vault using the CALLER's
  # identity, so the BFF role needs GetSecretValue on this env's identity secrets
  # (same grant the connector shim role has). The name is
  # bedrock-agentcore-identity!default/oauth2/<provider>-<random>.
  statement {
    sid       = "ReadConnectorIdentitySecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:bedrock-agentcore-identity!default/oauth2/${local.name_prefix}-*"]
  }

  statement {
    sid       = "WriteLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.bff.arn}:*"]
  }

  # Read the rotating origin secret at runtime (current and pending).
  statement {
    sid       = "ReadOriginSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["${aws_secretsmanager_secret.origin_secret.arn}*"]
  }

  statement {
    sid       = "DecryptOriginSecret"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.api_kms.key_arn]
  }

  # Vault workspace: browse / read the Markdown corpus. Writes (and the KB re-ground)
  # now go through the vault worker, so the BFF is read-only on the corpus bucket.
  statement {
    sid       = "ListVaultBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:ListBucketVersions"]
    resources = [local.corpus_bucket_arn]
  }

  # Read current objects, plus read prior versions for note history/restore
  # (the corpus bucket is versioned).
  statement {
    sid       = "ReadVaultObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${local.corpus_bucket_arn}/*"]
  }

  # The corpus bucket is SSE-KMS with the storage CMK; reads need Decrypt only
  # (the worker owns writes, so no GenerateDataKey here).
  statement {
    sid       = "CorpusKmsForVault"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [local.corpus_kms_key_arn]
  }

  # VPC networking: a VPC-attached Lambda manages its own ENIs (requires "*").
  statement {
    sid    = "VpcNetworking"
    effect = "Allow"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }

  # Read the worker shared secret at cold start (presented to the worker's API).
  statement {
    sid       = "ReadWorkerSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["${data.aws_ssm_parameter.vault_worker_secret_arn.value}*"]
  }

  # Read the Mission Control bearer token at cold start (presented on /runs etc.).
  # KMS decrypt is covered by DecryptWorkerSecret's ViaService=secretsmanager rule.
  statement {
    sid       = "ReadMissionControlToken"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["${data.aws_ssm_parameter.mission_control_token_secret_arn.value}*"]
  }

  # Probe connector connection status by invoking each connector shim Lambda.
  statement {
    sid       = "ProbeConnectorStatus"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.name_prefix}-connector-*"]
  }

  # Decrypt the worker secret (encrypted with the worker's KMS key).
  statement {
    sid       = "DecryptWorkerSecret"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
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
      # Single-tenant seed default: the tenant used when a verified token carries no
      # custom:tenant_id claim. Matches the connector shim so the BFF, agent, and
      # connector token vault agree on the tenant.
      HOMEBASE_DEFAULT_TENANT = var.project_name
      # The BFF reads the origin secret from Secrets Manager at runtime (current
      # and pending during rotation), so the secret rotates without a redeploy.
      HOMEBASE_ORIGIN_SECRET_ARN = aws_secretsmanager_secret.origin_secret.arn
      # Vault workspace: reads from the S3 mirror (corpus bucket); writes go to the
      # git worker (URL + shared secret ARN, fetched at cold start). The KB re-ground
      # on save now happens in the worker, not here.
      HOMEBASE_CORPUS_BUCKET     = local.corpus_bucket_name
      HOMEBASE_KB_ID             = local.knowledge_base_id
      HOMEBASE_KB_DATA_SOURCE_ID = local.data_source_id
      HOMEBASE_VAULT_WORKER_URL  = data.aws_ssm_parameter.vault_worker_url.value
      HOMEBASE_WORKER_SECRET_ARN = data.aws_ssm_parameter.vault_worker_secret_arn.value
      # Connector shim Lambda prefix (<prefix>-connector-<key>) for status probes.
      HOMEBASE_CONNECTOR_PREFIX = local.name_prefix
      # Mission Control execution seam: the BFF launches flight-plan units as runs,
      # streams telemetry, and drives the go/no-go gate over this URL, presenting the
      # bearer token (ARN; read from Secrets Manager at cold start). Enables /api/missions/*.
      HOMEBASE_MISSION_CONTROL_URL       = data.aws_ssm_parameter.mission_control_url.value
      HOMEBASE_MISSION_CONTROL_TOKEN_ARN = data.aws_ssm_parameter.mission_control_token_secret_arn.value
    }
  }

  # Join the VPC so the BFF can reach the private worker via Cloud Map. It uses the
  # worker's client SG (which the worker allows in on 8080) and private subnet
  # (egress via the NAT for Bedrock, Cognito JWKS, and Secrets Manager).
  vpc_config {
    subnet_ids         = [data.aws_ssm_parameter.vault_worker_private_subnet.value]
    security_group_ids = [data.aws_ssm_parameter.vault_worker_client_sg.value]
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
