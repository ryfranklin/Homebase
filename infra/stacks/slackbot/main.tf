data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Non-secret identifier published by the agent stack (P6): the runtime this bridge
# invokes on the user's behalf.
data "aws_ssm_parameter" "agent_runtime_arn" {
  name = "/${var.project_name}/${var.environment}/agent/runtime_arn"
}

# The vault-worker publishes the shared private subnet the Fargate services run in
# (NAT egress already there). The Slack bridge reuses it: Socket Mode is an
# OUTBOUND WebSocket, so it needs internet egress via the NAT, not VPC endpoints.
data "aws_ssm_parameter" "worker_private_subnet" {
  name = "/${var.project_name}/${var.environment}/vault-worker/private_subnet_id"
}
data "aws_subnet" "worker_private" {
  id = data.aws_ssm_parameter.worker_private_subnet.value
}

# The three BY-HAND Slack/app secrets (values never in Terraform; referenced by
# name). Create them before the service can connect. See README.
data "aws_secretsmanager_secret" "bot_token" {
  name = var.slack_bot_token_secret_name
}
data "aws_secretsmanager_secret" "app_token" {
  name = var.slack_app_token_secret_name
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "slackbot"
  }, var.tags)

  name_prefix       = "${var.project_name}-${var.environment}-slackbot"
  account_id        = data.aws_caller_identity.current.account_id
  partition         = data.aws_partition.current.partition
  region            = data.aws_region.current.name
  agent_runtime_arn = data.aws_ssm_parameter.agent_runtime_arn.value
  container_image   = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"

  # The by-hand SSM SecureString holding allowed emails. Referenced by NAME only;
  # the value never enters Terraform, state, or plans (same pattern as the
  # Cognito sign-up allow-list in the identity stack).
  allowlist_param_name = "/${var.project_name}/${var.environment}/slackbot/allowed-emails"
  allowlist_param_arn  = "arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter${local.allowlist_param_name}"
}

# KMS key for logs and the ECS Exec data channel.
module "kms" {
  source = "../../modules/kms"

  alias              = local.name_prefix
  description        = "Homebase ${var.environment} Slack bridge logs and ECS Exec channel key"
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
  name              = "/${var.project_name}/${var.environment}/slackbot/task"
  retention_in_days = 30
  kms_key_id        = module.kms.key_arn
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/${var.project_name}/${var.environment}/slackbot/exec"
  retention_in_days = 30
  kms_key_id        = module.kms.key_arn
  tags              = local.common_tags
}

# ---------------------------------------------------------------------------
# ECS cluster with ECS Exec (KMS-encrypted, logged) for debugging.
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  configuration {
    execute_command_configuration {
      kms_key_id = module.kms.key_arn
      logging    = "OVERRIDE"
      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.exec.name
      }
    }
  }

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# IAM: execution role (pull image, logs, inject the two Slack secrets) + task
# role (invoke the agent, read+decrypt the allow-list, ECS Exec).
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
    sid       = "UseKmsForLogs"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms.key_arn]
  }
  # Inject the Slack bot + app tokens into the container as env secrets.
  statement {
    sid     = "InjectSlackSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "${data.aws_secretsmanager_secret.bot_token.arn}*",
      "${data.aws_secretsmanager_secret.app_token.arn}*",
    ]
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
    sid       = "InvokeAgentRuntime"
    effect    = "Allow"
    actions   = ["bedrock-agentcore:InvokeAgentRuntime", "bedrock-agentcore:InvokeAgentRuntimeForUser"]
    resources = [local.agent_runtime_arn, "${local.agent_runtime_arn}/*"]
  }

  # Read and decrypt the by-hand allow-list SecureString at runtime. GetParameter
  # is scoped to the single parameter; kms:Decrypt is constrained to decryption
  # performed via SSM only, so no key ARN is hardcoded (aws/ssm or a CMK both work).
  statement {
    sid       = "ReadAllowlistParam"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [local.allowlist_param_arn]
  }
  statement {
    sid       = "DecryptAllowlistViaSsm"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com"]
    }
  }

  # ECS Exec data channel (requires resource "*"; scoped by session).
  statement {
    sid    = "EcsExecChannel"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "ExecChannelKms"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms.key_arn]
  }
  statement {
    sid       = "ExecLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogGroups"]
    resources = ["${aws_cloudwatch_log_group.exec.arn}:*", aws_cloudwatch_log_group.exec.arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name_prefix}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Security group: NO ingress at all. Socket Mode is an outbound WebSocket, so the
# task needs only egress (443 to Slack and AWS via the NAT). No load balancer, no
# public IP, no inbound webhook.
# ---------------------------------------------------------------------------
resource "aws_security_group" "task" {
  name        = local.name_prefix
  description = "Slack bridge task: no inbound; egress 443 to Slack and AWS via the NAT"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS egress (Slack Socket Mode, bedrock-agentcore, SSM, ECR, Logs)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Task definition + service (one long-lived task holding the Socket Mode socket).
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
      name            = "slackbot"
      image           = local.container_image
      essential       = true
      linuxParameters = { initProcessEnabled = true }
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "HOMEBASE_AGENT_RUNTIME_ARN", value = local.agent_runtime_arn },
        { name = "HOMEBASE_TENANT_ID", value = var.tenant_id },
        { name = "HOMEBASE_SLACK_ALLOWLIST_PARAM", value = local.allowlist_param_name },
      ]
      secrets = [
        { name = "SLACK_BOT_TOKEN", valueFrom = data.aws_secretsmanager_secret.bot_token.arn },
        { name = "SLACK_APP_TOKEN", valueFrom = data.aws_secretsmanager_secret.app_token.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "slackbot"
        }
      }
    }
  ])

  tags = local.common_tags
}

resource "aws_ecs_service" "this" {
  name                   = local.name_prefix
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true

  # Runs in the shared private subnet (NAT egress); no inbound, no public IP.
  network_configuration {
    subnets          = [data.aws_subnet.worker_private.id]
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  tags = local.common_tags
}

# Non-secret identifiers exported for the start-session / debugging commands.
resource "aws_ssm_parameter" "cluster_name" {
  name  = "/${var.project_name}/${var.environment}/slackbot/cluster_name"
  type  = "String"
  value = aws_ecs_cluster.this.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "service_name" {
  name  = "/${var.project_name}/${var.environment}/slackbot/service_name"
  type  = "String"
  value = aws_ecs_service.this.name
  tags  = local.common_tags
}
