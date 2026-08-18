data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# The vault-worker publishes the private subnet the Fargate workloads run in (NAT
# egress + Bedrock reachability already there). The eval task runs there too. It
# needs no inbound, so it does not use the worker client SG; it gets its own
# egress-only SG below.
data "aws_ssm_parameter" "worker_private_subnet" {
  name = "/${var.project_name}/${var.environment}/vault-worker/private_subnet_id"
}
data "aws_subnet" "worker_private" {
  id = data.aws_ssm_parameter.worker_private_subnet.value
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "eval"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}-eval"
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition

  container_image = "${aws_ecr_repository.this.repository_url}:${var.eval_image_tag}"

  pricing_param_name = "/${var.project_name}/${var.environment}/eval/pricing"

  # Bedrock InvokeModel resources for exactly the models under test plus the judge.
  # A us./eu./apac./global. prefix marks a cross-region inference profile, which
  # needs both the profile ARN and the underlying foundation-model ARN; a bare id
  # (for example zai.glm-5, qwen.*) is invoked as a foundation model directly.
  eval_models = distinct(concat(var.models, [var.judge]))
  model_invoke_arns = flatten([
    for m in local.eval_models : (
      length(regexall("^(us|eu|apac|global)[.]", m)) > 0 ? [
        "arn:${local.partition}:bedrock:${var.aws_region}:${local.account_id}:inference-profile/${m}",
        "arn:${local.partition}:bedrock:*::foundation-model/${replace(m, "/^(us|eu|apac|global)[.]/", "")}",
        ] : [
        "arn:${local.partition}:bedrock:*::foundation-model/${m}",
      ]
    )
  ])
}

# KMS key for logs, ECR, DynamoDB, and the S3 artifacts bucket.
module "kms" {
  source = "../../modules/kms"

  alias              = local.name_prefix
  description        = "Homebase ${var.environment} eval logs, ECR, DynamoDB, and artifacts key"
  service_principals = ["logs.amazonaws.com"]
  tags               = local.common_tags
}

# ---------------------------------------------------------------------------
# ECR + logs
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "this" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.kms.key_arn
  }
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "task" {
  name              = "/${var.project_name}/${var.environment}/eval/task"
  retention_in_days = var.log_retention_days
  kms_key_id        = module.kms.key_arn
  tags              = local.common_tags
}

# ---------------------------------------------------------------------------
# Result store: DynamoDB run ledger + S3 artifacts.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "results" {
  name         = local.name_prefix
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = module.kms.key_arn
  }

  tags = local.common_tags
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.name_prefix}-artifacts-${local.account_id}"
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = module.kms.key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Suspended"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "expire-artifacts"
    status = "Enabled"
    filter {}
    expiration {
      days = var.artifact_retention_days
    }
  }
}

# ---------------------------------------------------------------------------
# Pricing parameter: the runner reads this at run time so prices update without a
# redeploy. Seeded from the committed default table; edit the parameter to change
# prices. NOTE: the committed values are PLACEHOLDERS, confirm current Bedrock
# on-demand pricing for the region.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "pricing" {
  name  = local.pricing_param_name
  type  = "String"
  tier  = "Advanced"
  value = file("${path.module}/../../../eval/fixtures/pricing.json")
  tags  = local.common_tags

  lifecycle {
    # The operator edits real prices in place; do not let an apply revert them.
    ignore_changes = [value]
  }
}

# ---------------------------------------------------------------------------
# Networking: egress-only task SG in the vault-worker private subnet.
# ---------------------------------------------------------------------------
resource "aws_security_group" "task" {
  name        = local.name_prefix
  description = "Eval task: no inbound, outbound only (Bedrock, S3, DynamoDB, SSM)"
  vpc_id      = data.aws_subnet.worker_private.vpc_id

  egress {
    description = "Outbound only"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = local.name_prefix })
}

# ---------------------------------------------------------------------------
# ECS cluster (run-to-completion tasks; no long-lived service, no schedule).
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# IAM: execution role (pull image, write logs) + task role (Bedrock, DynamoDB,
# S3, SSM pricing, KMS for the S3 CMK).
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "PullImage"
    effect    = "Allow"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    resources = [aws_ecr_repository.this.arn]
  }
  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "WriteTaskLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.task.arn}:*"]
  }
  statement {
    sid       = "UseKmsForLogsAndEcr"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms.key_arn]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "${local.name_prefix}-exec-policy"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "InvokeBedrockModels"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = distinct(concat(local.model_invoke_arns, var.additional_model_arns))
  }
  statement {
    sid    = "WriteResults"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.results.arn]
  }
  statement {
    sid       = "WriteArtifacts"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }
  statement {
    sid       = "ReadPricing"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:${local.partition}:ssm:${var.aws_region}:${local.account_id}:parameter${local.pricing_param_name}"]
  }
  # The S3 bucket and DynamoDB table are CMK-encrypted; the caller needs the key
  # to put objects (DynamoDB uses a service grant and needs nothing extra here).
  statement {
    sid       = "UseCmk"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms.key_arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name_prefix}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Task definition (run-to-completion). Launched on demand by scripts/run-eval.sh.
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "this" {
  family                   = local.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = var.task_cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "eval"
      image     = local.container_image
      essential = true
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "EVAL_MODELS", value = join(",", var.models) },
        { name = "EVAL_JUDGE", value = var.judge },
        { name = "EVAL_TABLE", value = aws_dynamodb_table.results.name },
        { name = "EVAL_BUCKET", value = aws_s3_bucket.artifacts.bucket },
        { name = "EVAL_PRICING_SSM", value = local.pricing_param_name },
        { name = "EVAL_TENANT_ID", value = var.tenant_id },
        { name = "EVAL_USER_ID", value = var.user_id },
        { name = "GIT_SHA", value = var.eval_image_tag },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "eval"
        }
      }
    }
  ])

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Dashboard: quality, latency, and cost per model, discovered from the EMF
# metrics the runner emits (SEARCH picks up whatever models a run used).
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = local.name_prefix

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          title   = "Quality by model (avg)"
          region  = var.aws_region
          view    = "timeSeries"
          stat    = "Average"
          metrics = [[{ expression = "SEARCH('{Homebase/Eval,Model} MetricName=\"Quality\"', 'Average', 300)", label = "Quality" }]]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Latency by model (p95 ms)"
          region  = var.aws_region
          view    = "timeSeries"
          stat    = "p95"
          metrics = [[{ expression = "SEARCH('{Homebase/Eval,Model} MetricName=\"LatencyMs\"', 'p95', 300)", label = "LatencyMs" }]]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Cost per call by model (avg USD)"
          region  = var.aws_region
          view    = "timeSeries"
          stat    = "Average"
          metrics = [[{ expression = "SEARCH('{Homebase/Eval,Model} MetricName=\"CostUsd\"', 'Average', 300)", label = "CostUsd" }]]
        }
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# SSM outputs for the deploy + run scripts and any downstream stack.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "ecr_repository_url" {
  name  = "/${var.project_name}/${var.environment}/eval/ecr_repository_url"
  type  = "String"
  value = aws_ecr_repository.this.repository_url
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "cluster_name" {
  name  = "/${var.project_name}/${var.environment}/eval/cluster_name"
  type  = "String"
  value = aws_ecs_cluster.this.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "task_definition_arn" {
  name  = "/${var.project_name}/${var.environment}/eval/task_definition_arn"
  type  = "String"
  value = aws_ecs_task_definition.this.arn
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "subnet_id" {
  name  = "/${var.project_name}/${var.environment}/eval/subnet_id"
  type  = "String"
  value = data.aws_subnet.worker_private.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "security_group_id" {
  name  = "/${var.project_name}/${var.environment}/eval/security_group_id"
  type  = "String"
  value = aws_security_group.task.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "table_name" {
  name  = "/${var.project_name}/${var.environment}/eval/table_name"
  type  = "String"
  value = aws_dynamodb_table.results.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "bucket_name" {
  name  = "/${var.project_name}/${var.environment}/eval/bucket_name"
  type  = "String"
  value = aws_s3_bucket.artifacts.bucket
  tags  = local.common_tags
}
