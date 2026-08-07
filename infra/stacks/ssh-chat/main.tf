data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

# Non-secret identifier published by the agent stack (P6).
data "aws_ssm_parameter" "agent_runtime_arn" {
  name = "/${var.project_name}/${var.environment}/agent/runtime_arn"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "ssh-chat"
  }, var.tags)

  name_prefix       = "${var.project_name}-${var.environment}-cli"
  account_id        = data.aws_caller_identity.current.account_id
  partition         = data.aws_partition.current.partition
  agent_runtime_arn = data.aws_ssm_parameter.agent_runtime_arn.value
  container_image   = "${aws_ecr_repository.cli.repository_url}:${var.image_tag}"
}

# KMS key for logs and the ECS Exec data channel.
module "cli_kms" {
  source = "../../modules/kms"

  alias       = local.name_prefix
  description = "Homebase ${var.environment} CLI logs and ECS Exec channel key"
  service_principals = [
    "logs.amazonaws.com",
  ]
  tags = local.common_tags
}

resource "aws_ecr_repository" "cli" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.cli_kms.key_arn
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "task" {
  name              = "/${var.project_name}/${var.environment}/cli/task"
  retention_in_days = 30
  kms_key_id        = module.cli_kms.key_arn
  tags              = local.common_tags
}

# Separate log group for the ECS Exec data channel (auditable shell sessions).
resource "aws_cloudwatch_log_group" "exec" {
  name              = "/${var.project_name}/${var.environment}/cli/exec"
  retention_in_days = 30
  kms_key_id        = module.cli_kms.key_arn
  tags              = local.common_tags
}

# ---------------------------------------------------------------------------
# ECS cluster with ECS Exec configured: the exec data channel is KMS-encrypted
# and logged to CloudWatch.
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  configuration {
    execute_command_configuration {
      kms_key_id = module.cli_kms.key_arn
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
# Task execution role: pull the image and write task logs. No app permissions.
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
    resources = [aws_ecr_repository.cli.arn]
  }

  # ECR auth token requires resource "*" (AWS requirement).
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
    sid       = "UseKeyForLogs"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.cli_kms.key_arn]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "${local.name_prefix}-exec-policy"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# ---------------------------------------------------------------------------
# Task role: least privilege. Invoke the agent runtime, plus the SSM channel
# actions ECS Exec needs. No S3, no direct KB, no Secrets Manager. Retrieval
# happens inside the agent, not the CLI.
# ---------------------------------------------------------------------------
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

  # ECS Exec data channel. These SSM Messages actions require resource "*"
  # (AWS requirement); scoping is by the session, not the ARN.
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

  # Encrypt the exec data channel with the CLI key.
  statement {
    sid       = "ExecChannelKms"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.cli_kms.key_arn]
  }

  # Write exec session logs.
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
# Security group: NO ingress at all. Egress on 443 so the task can reach the VPC
# endpoints (SSM, ECR, Logs, bedrock-agentcore). No load balancer, no public IP.
# ---------------------------------------------------------------------------
resource "aws_security_group" "task" {
  name        = local.name_prefix
  description = "CLI task: no inbound, egress 443 to VPC endpoints only"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS egress to AWS endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Task definition and service.
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "this" {
  family                   = local.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  # Pin the CPU architecture explicitly (Fargate defaults to X86_64 otherwise).
  # The CLI image must be built for the matching platform.
  runtime_platform {
    cpu_architecture        = var.task_cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "cli"
      image     = local.container_image
      essential = true
      # initProcessEnabled is recommended for ECS Exec (reaps zombie processes).
      linuxParameters = { initProcessEnabled = true }
      environment = [
        { name = "HOMEBASE_AGENT_RUNTIME_ARN", value = local.agent_runtime_arn },
        { name = "HOMEBASE_USER_ID", value = var.cli_user_id },
        { name = "HOMEBASE_TENANT_ID", value = var.cli_tenant_id },
        { name = "AWS_REGION", value = var.aws_region },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "cli"
        }
      }
    }
  ])

  tags = local.common_tags
}

resource "aws_ecs_service" "this" {
  name            = local.name_prefix
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # ECS Exec: the only way in. No inbound ports, no public IP, no load balancer.
  enable_execute_command = true

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  tags = local.common_tags
}

# Non-secret identifiers exported to SSM for the start-session command.
resource "aws_ssm_parameter" "cluster_name" {
  name  = "/${var.project_name}/${var.environment}/cli/cluster_name"
  type  = "String"
  value = aws_ecs_cluster.this.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "service_name" {
  name  = "/${var.project_name}/${var.environment}/cli/service_name"
  type  = "String"
  value = aws_ecs_service.this.name
  tags  = local.common_tags
}
