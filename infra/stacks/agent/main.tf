data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# Non-secret identifiers published by the retrieval stack (P5). Read at
# plan/apply time; validate does not call AWS.
data "aws_ssm_parameter" "knowledge_base_id" {
  name = "/${var.project_name}/${var.environment}/retrieval/knowledge_base_id"
}

data "aws_ssm_parameter" "rerank_model_id" {
  name = "/${var.project_name}/${var.environment}/retrieval/rerank_model_id"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "agent"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition

  knowledge_base_id  = data.aws_ssm_parameter.knowledge_base_id.value
  knowledge_base_arn = "arn:${local.partition}:bedrock:${var.aws_region}:${local.account_id}:knowledge-base/${local.knowledge_base_id}"

  rerank_model_id  = data.aws_ssm_parameter.rerank_model_id.value
  rerank_model_arn = "arn:${local.partition}:bedrock:${var.aws_region}::foundation-model/${local.rerank_model_id}"

  # Current Claude models on Bedrock (for example Sonnet 4.6) are invoked through
  # a cross-region inference profile (us./eu./apac./global. prefix), NOT the bare
  # on-demand foundation-model id: a direct on-demand Converse returns
  # ValidationException. When model_id is a profile, IAM must allow InvokeModel on
  # BOTH the inference-profile ARN and the underlying foundation-model ARNs the
  # profile routes to (across its regions), so both are listed here. When model_id
  # is a plain foundation-model id, the single foundation-model ARN is used.
  is_inference_profile = length(regexall("^(us|eu|apac|global)[.]", var.model_id)) > 0
  base_model_id        = replace(var.model_id, "/^(us|eu|apac|global)[.]/", "")

  model_invoke_arns = local.is_inference_profile ? [
    "arn:${local.partition}:bedrock:${var.aws_region}:${local.account_id}:inference-profile/${var.model_id}",
    "arn:${local.partition}:bedrock:*::foundation-model/${local.base_model_id}",
    ] : [
    "arn:${local.partition}:bedrock:*::foundation-model/${var.model_id}",
  ]

  container_uri = "${aws_ecr_repository.agent.repository_url}:${var.agent_image_tag}"

  # Models a chat request may select (the GUI's settings-level default). The default
  # model is always allowed; extras come from var.allowed_model_ids. Their invoke ARNs
  # are derived below, so the operator does not maintain a parallel IAM list.
  allowed_model_ids = join(",", distinct(concat([var.model_id], var.allowed_model_ids)))

  # Invoke ARNs for each selectable extra model, derived the same way as model_id: an
  # inference-profile id needs BOTH its account-scoped profile ARN and the underlying
  # foundation-model ARN; a bare foundation-model id needs just the latter.
  allowed_model_invoke_arns = flatten([
    for m in var.allowed_model_ids : (
      length(regexall("^(us|eu|apac|global)[.]", m)) > 0 ? [
        "arn:${local.partition}:bedrock:${var.aws_region}:${local.account_id}:inference-profile/${m}",
        "arn:${local.partition}:bedrock:*::foundation-model/${replace(m, "/^(us|eu|apac|global)[.]/", "")}",
        ] : [
        "arn:${local.partition}:bedrock:*::foundation-model/${m}",
      ]
    )
  ])

  runtime_environment = {
    HOMEBASE_KB_ID             = local.knowledge_base_id
    HOMEBASE_MODEL_ID          = var.model_id
    HOMEBASE_ALLOWED_MODEL_IDS = local.allowed_model_ids
    HOMEBASE_RERANK_MODEL_ARN  = local.rerank_model_arn
    HOMEBASE_MEMORY_ID         = aws_bedrockagentcore_memory.this.id
    # IANA timezone the agent resolves 'today'/'now' in (falls back to UTC).
    HOMEBASE_TIMEZONE = var.agent_timezone
    # Enables the connector tool-use loop: the shim function name prefix. The agent
    # invokes homebase-<env>-connector-<connector> for each read tool.
    HOMEBASE_CONNECTOR_PREFIX = local.name_prefix
    # Bedrock Guardrail applied to every model call, governing all doors (GUI, CLI,
    # Slack) in one place: prompt-attack + content filters + secret-exfiltration denial.
    HOMEBASE_GUARDRAIL_ID       = aws_bedrock_guardrail.this.guardrail_id
    HOMEBASE_GUARDRAIL_VERSION  = aws_bedrock_guardrail_version.this.version
    AGENT_OBSERVABILITY_ENABLED = "true"
    OTEL_PYTHON_DISTRO          = "aws_distro"
    OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
    OTEL_RESOURCE_ATTRIBUTES    = "service.name=${local.name_prefix}-agent"
  }
}

# Customer managed key for memory and agent logs.
module "agent_kms" {
  source = "../../modules/kms"

  alias       = "${local.name_prefix}-agent"
  description = "Homebase ${var.environment} agent plane key (memory, logs)"
  service_principals = [
    "logs.amazonaws.com",
    "bedrock-agentcore.amazonaws.com",
  ]
  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# ECR repository for the agent container image. Build from services/agent and
# push here, then the runtime references this repo by tag.
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "agent" {
  name                 = "${local.name_prefix}-agent"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.agent_kms.key_arn
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/${var.project_name}/${var.environment}/agent"
  retention_in_days = 30
  kms_key_id        = module.agent_kms.key_arn
  tags              = local.common_tags
}

# ---------------------------------------------------------------------------
# Bedrock Guardrail applied to every agent model call (Converse), so the same
# governance protects all doors (GUI, CLI, Slack). Tuned for a PERSONAL assistant:
# prompt-attack detection and content filters (universal wins) plus a denial of
# secret-exfiltration requests. PII redaction is intentionally OFF: Homebase reads
# the user's own email/calendar/contacts, so redacting PII would defeat its purpose.
# ---------------------------------------------------------------------------
resource "aws_bedrock_guardrail" "this" {
  name                      = "${local.name_prefix}-guardrail"
  description               = "Homebase agent guardrail: prompt-attack + content filters + secret-exfiltration denial."
  blocked_input_messaging   = "This request was blocked by the Homebase content guardrail."
  blocked_outputs_messaging = "The response was blocked by the Homebase content guardrail."

  content_policy_config {
    # Prompt-attack detection is input-only (output must be NONE).
    filters_config {
      type            = "PROMPT_ATTACK"
      input_strength  = "HIGH"
      output_strength = "NONE"
    }
    filters_config {
      type            = "HATE"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "INSULTS"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "SEXUAL"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "VIOLENCE"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "MISCONDUCT"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
  }

  topic_policy_config {
    topics_config {
      name       = "CredentialExfiltration"
      definition = "Requests to reveal, print, or exfiltrate secrets, credentials, API keys, passwords, tokens, or private keys held by the system or reachable through its connectors."
      type       = "DENY"
    }
  }

  tags = local.common_tags
}

resource "aws_bedrock_guardrail_version" "this" {
  guardrail_arn = aws_bedrock_guardrail.this.guardrail_arn
  description   = "Homebase agent guardrail v1"
}

# ---------------------------------------------------------------------------
# AgentCore Memory: short-term session events, plus an optional long-term
# extraction strategy. Encrypted with the agent key. Tenant identity is carried
# by the agent at write time (actor id namespaced by tenant).
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_memory" "this" {
  name                  = replace("${local.name_prefix}_memory", "-", "_")
  event_expiry_duration = var.memory_event_expiry_days
  encryption_key_arn    = module.agent_kms.key_arn
  description           = "Homebase ${var.environment} agent memory"
  tags                  = local.common_tags
}

# Role the memory service assumes to run model-backed extraction strategies.
data "aws_iam_policy_document" "memory_trust" {
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

resource "aws_iam_role" "memory" {
  count              = var.enable_long_term_memory ? 1 : 0
  name               = "${local.name_prefix}-memory-role"
  assume_role_policy = data.aws_iam_policy_document.memory_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "memory" {
  count = var.enable_long_term_memory ? 1 : 0

  statement {
    sid       = "InvokeStrategyModel"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = local.model_invoke_arns
  }
}

resource "aws_iam_role_policy" "memory" {
  count  = var.enable_long_term_memory ? 1 : 0
  name   = "${local.name_prefix}-memory-policy"
  role   = aws_iam_role.memory[0].id
  policy = data.aws_iam_policy_document.memory[0].json
}

resource "aws_bedrockagentcore_memory_strategy" "long_term" {
  count = var.enable_long_term_memory ? 1 : 0

  memory_id                 = aws_bedrockagentcore_memory.this.id
  name                      = replace("${local.name_prefix}_long_term", "-", "_")
  type                      = var.long_term_memory_strategy_type
  memory_execution_role_arn = aws_iam_role.memory[0].arn
  namespace_templates       = var.long_term_memory_namespaces
  description               = "Long-term extraction for Homebase agent memory"
}

# ---------------------------------------------------------------------------
# AgentCore Runtime execution role: least privilege. Bedrock model invoke, KB
# retrieve, rerank, and AgentCore Memory only. No S3 access, no broad Bedrock.
# The resource "*" entries below are the AWS-required ones (X-Ray, ECR auth
# token, scoped metric publishing).
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "runtime_trust" {
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

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:bedrock-agentcore:${var.aws_region}:${local.account_id}:*"]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name               = "${local.name_prefix}-agent-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.runtime_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "runtime" {
  statement {
    sid       = "InvokeModel"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = distinct(concat(local.model_invoke_arns, local.allowed_model_invoke_arns, var.additional_model_arns))
  }

  # Converse with guardrailConfig requires ApplyGuardrail on the guardrail.
  statement {
    sid       = "ApplyGuardrail"
    effect    = "Allow"
    actions   = ["bedrock:ApplyGuardrail"]
    resources = [aws_bedrock_guardrail.this.guardrail_arn]
  }

  statement {
    sid       = "RetrieveFromKnowledgeBase"
    effect    = "Allow"
    actions   = ["bedrock:Retrieve"]
    resources = [local.knowledge_base_arn]
  }

  # The agent's connector tool loop invokes the connector shim Lambdas directly
  # (each shim resolves the tenant's OAuth token and calls the vendor). Only the
  # invoke permission is needed here; the shims run under their own role.
  statement {
    sid       = "InvokeConnectorShims"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:${local.partition}:lambda:${var.aws_region}:${local.account_id}:function:${local.name_prefix}-connector-*"]
  }

  statement {
    sid       = "Rerank"
    effect    = "Allow"
    actions   = ["bedrock:Rerank", "bedrock:InvokeModel"]
    resources = [local.rerank_model_arn]
  }

  statement {
    sid    = "AgentCoreMemory"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:CreateEvent",
      "bedrock-agentcore:GetEvent",
      "bedrock-agentcore:ListEvents",
      "bedrock-agentcore:ListSessions",
      "bedrock-agentcore:RetrieveMemoryRecords",
      "bedrock-agentcore:GetMemoryRecord",
    ]
    resources = [
      aws_bedrockagentcore_memory.this.arn,
      "${aws_bedrockagentcore_memory.this.arn}/*",
    ]
  }

  statement {
    sid    = "WorkloadIdentity"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
    ]
    resources = [
      "arn:${local.partition}:bedrock-agentcore:${var.aws_region}:${local.account_id}:workload-identity-directory/default",
      "arn:${local.partition}:bedrock-agentcore:${var.aws_region}:${local.account_id}:workload-identity-directory/default/workload-identity/*",
    ]
  }

  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
      "logs:DescribeLogGroups",
    ]
    resources = [
      "arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
      aws_cloudwatch_log_group.agent.arn,
      "${aws_cloudwatch_log_group.agent.arn}:*",
    ]
  }

  # X-Ray trace publishing. AWS requires resource "*" for these actions.
  statement {
    sid       = "XRayTracing"
    effect    = "Allow"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
    resources = ["*"]
  }

  # Metric publishing, restricted to the AgentCore namespace by condition.
  statement {
    sid       = "PublishMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["bedrock-agentcore"]
    }
  }

  statement {
    sid       = "PullAgentImage"
    effect    = "Allow"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    resources = [aws_ecr_repository.agent.arn]
  }

  # ECR auth token. AWS requires resource "*" for this action.
  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "UseAgentKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.agent_kms.key_arn]
  }
}

resource "aws_iam_role_policy" "runtime" {
  name   = "${local.name_prefix}-agent-runtime-policy"
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime.json
}

# ---------------------------------------------------------------------------
# AgentCore Runtime.
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_agent_runtime" "this" {
  agent_runtime_name = replace("${local.name_prefix}_agent", "-", "_")
  role_arn           = aws_iam_role.runtime.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = local.container_uri
    }
  }

  network_configuration {
    network_mode = var.runtime_network_mode
  }

  protocol_configuration {
    server_protocol = var.runtime_server_protocol
  }

  environment_variables = local.runtime_environment

  tags = local.common_tags

  depends_on = [aws_iam_role_policy.runtime]
}

# ---------------------------------------------------------------------------
# Observability: CloudWatch Logs resource policy that lets X-Ray deliver trace
# spans (a prerequisite for CloudWatch Transaction Search / GenAI Observability).
#
# NOTE: enabling Transaction Search also requires setting the X-Ray trace
# segment destination to CloudWatch Logs, which has no first-class Terraform
# resource. Do that once by hand (documented in README).
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "xray_to_logs" {
  count = var.enable_transaction_search_log_policy ? 1 : 0

  statement {
    sid    = "AllowXRayToPutSpans"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["xray.amazonaws.com"]
    }

    actions   = ["logs:PutLogEvents", "logs:CreateLogStream"]
    resources = ["arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:aws/spans:*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "xray_to_logs" {
  count           = var.enable_transaction_search_log_policy ? 1 : 0
  policy_name     = "${local.name_prefix}-xray-to-logs"
  policy_document = data.aws_iam_policy_document.xray_to_logs[0].json
}

# ---------------------------------------------------------------------------
# Non-secret identifiers exported to SSM for the BFF (P7).
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "agent_runtime_arn" {
  name  = "/${var.project_name}/${var.environment}/agent/runtime_arn"
  type  = "String"
  value = aws_bedrockagentcore_agent_runtime.this.agent_runtime_arn
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "agent_memory_id" {
  name  = "/${var.project_name}/${var.environment}/agent/memory_id"
  type  = "String"
  value = aws_bedrockagentcore_memory.this.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "agent_ecr_repository_url" {
  name  = "/${var.project_name}/${var.environment}/agent/ecr_repository_url"
  type  = "String"
  value = aws_ecr_repository.agent.repository_url
  tags  = local.common_tags
}
