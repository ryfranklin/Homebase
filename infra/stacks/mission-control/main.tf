data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# The vault-worker publishes the private subnet the Fargate services run in and the
# client SG the BFF attaches to. Mission Control reuses both: it runs in the same
# private subnet (NAT egress + BFF reachability already there) and admits that
# client SG on its port, so the BFF can reach it over Cloud Map.
data "aws_ssm_parameter" "worker_private_subnet" {
  name = "/${var.project_name}/${var.environment}/vault-worker/private_subnet_id"
}
data "aws_ssm_parameter" "worker_client_sg" {
  name = "/${var.project_name}/${var.environment}/vault-worker/client_security_group_id"
}
data "aws_subnet" "worker_private" {
  id = data.aws_ssm_parameter.worker_private_subnet.value
}

# The private DNS namespace the vault-worker created; register mission-control in it.
data "aws_service_discovery_dns_namespace" "internal" {
  name = var.dns_namespace
  type = "DNS_PRIVATE"
}

# The by-hand GitHub token secret (value never in Terraform; referenced by name).
data "aws_secretsmanager_secret" "github_token" {
  name = var.github_token_secret_name
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "mission-control"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}-mission-control"
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition

  container_image = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"

  # The worker reaches Claude via Bedrock. Grant InvokeModel on the inference profile
  # AND the underlying foundation model (the us.* profile fans out across regions),
  # matching the agent stack's profile-aware grant.
  inference_profile_arn = "arn:${local.partition}:bedrock:${var.aws_region}:${local.account_id}:inference-profile/${var.worker_model}"
  foundation_model_arn  = "arn:${local.partition}:bedrock:*::foundation-model/${trimprefix(var.worker_model, "us.")}"
}

# KMS key for logs, the ECS Exec channel, the generated secrets, and RDS storage.
module "kms" {
  source = "../../modules/kms"

  alias              = local.name_prefix
  description        = "Homebase ${var.environment} mission-control logs, exec channel, secrets, and RDS key"
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
  name              = "/${var.project_name}/${var.environment}/mission-control/task"
  retention_in_days = 30
  kms_key_id        = module.kms.key_arn
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/${var.project_name}/${var.environment}/mission-control/exec"
  retention_in_days = 30
  kms_key_id        = module.kms.key_arn
  tags              = local.common_tags
}

# ---------------------------------------------------------------------------
# Secrets: the BFF -> Mission Control bearer token, and the Postgres connection
# URL (holds the generated DB password). Both generated here; the GitHub token is
# by-hand (referenced above). Injected into the container by the execution role.
# ---------------------------------------------------------------------------
resource "random_password" "api_token" {
  length  = 48
  special = false
}

resource "random_password" "db" {
  length  = 32
  special = false # keep the password URL-safe (no escaping in the connection string)
}

resource "aws_secretsmanager_secret" "api_token" {
  name        = "${var.project_name}-${var.environment}/mission-control-api-token"
  description = "Bearer token the BFF presents to the Mission Control service"
  kms_key_id  = module.kms.key_arn
  tags        = local.common_tags
}

resource "aws_secretsmanager_secret_version" "api_token" {
  secret_id     = aws_secretsmanager_secret.api_token.id
  secret_string = random_password.api_token.result
}

resource "aws_secretsmanager_secret" "db_url" {
  name        = "${var.project_name}-${var.environment}/mission-control-postgres-url"
  description = "Postgres connection URL (with generated password) for the Mission Control ledger"
  kms_key_id  = module.kms.key_arn
  tags        = local.common_tags
}

resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id     = aws_secretsmanager_secret.db_url.id
  secret_string = "postgresql://mc:${random_password.db.result}@${aws_db_instance.this.address}:5432/mission_control?sslmode=require"
}

# ---------------------------------------------------------------------------
# RDS-only private subnets (two AZs) + the Postgres instance. These subnets carry
# no NAT route: RDS talks intra-VPC only. The Fargate task (in the vault-worker
# private subnet) reaches it by security-group reference.
# ---------------------------------------------------------------------------
resource "aws_subnet" "db" {
  count             = 2
  vpc_id            = var.vpc_id
  cidr_block        = var.rds_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = merge(local.common_tags, { Name = "${local.name_prefix}-db-${count.index}", Tier = "db" })
}

resource "aws_db_subnet_group" "this" {
  name       = local.name_prefix
  subnet_ids = aws_subnet.db[*].id
  tags       = local.common_tags
}

resource "aws_security_group" "db" {
  name        = "${local.name_prefix}-db"
  description = "Mission Control RDS: Postgres from the service task only"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name_prefix}-db" })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_task" {
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from the Mission Control task"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.task.id
}

resource "aws_db_instance" "this" {
  identifier                 = local.name_prefix
  engine                     = "postgres"
  engine_version             = var.db_engine_version
  instance_class             = var.db_instance_class
  allocated_storage          = var.db_allocated_storage
  storage_type               = "gp3"
  storage_encrypted          = true
  kms_key_id                 = module.kms.key_arn
  db_name                    = "mission_control"
  username                   = "mc"
  password                   = random_password.db.result
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = [aws_security_group.db.id]
  multi_az                   = false
  publicly_accessible        = false
  auto_minor_version_upgrade = true
  backup_retention_period    = 7
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name_prefix}-final"
  tags                       = local.common_tags

  # auto_minor_version_upgrade will bump the minor over time; ignore it so a later
  # plan does not show a perpetual diff against the pinned floor.
  lifecycle {
    ignore_changes = [engine_version]
  }
}

# ---------------------------------------------------------------------------
# Service security group + Cloud Map registration
# ---------------------------------------------------------------------------
resource "aws_security_group" "task" {
  name        = "${local.name_prefix}-task"
  description = "Mission Control task: HTTP from the BFF client SG; egress via the NAT"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name_prefix}-task" })
}

resource "aws_vpc_security_group_ingress_rule" "task_from_bff" {
  security_group_id            = aws_security_group.task.id
  description                  = "Mission Control HTTP from the BFF"
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
  referenced_security_group_id = data.aws_ssm_parameter.worker_client_sg.value
}

resource "aws_vpc_security_group_egress_rule" "task_egress" {
  security_group_id = aws_security_group.task.id
  description       = "All egress (ECR, Bedrock, GitHub, Secrets Manager via the NAT)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_service_discovery_service" "this" {
  name = "mission-control"

  dns_config {
    namespace_id = data.aws_service_discovery_dns_namespace.internal.id
    dns_records {
      type = "A"
      ttl  = 15
    }
    routing_policy = "MULTIVALUE"
  }

  tags = local.common_tags
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
# IAM: execution role (pull image, logs, inject secrets) + task role (Bedrock,
# ECS Exec). The GitHub token is injected as an env secret by the execution role,
# so the task role needs no Secrets Manager access.
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
  # Inject the bearer token, the Postgres URL, and the GitHub token into the container.
  statement {
    sid     = "InjectSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "${aws_secretsmanager_secret.api_token.arn}*",
      "${aws_secretsmanager_secret.db_url.arn}*",
      data.aws_secretsmanager_secret.github_token.arn,
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
    sid       = "InvokeBedrockWorkerModel"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [local.inference_profile_arn, local.foundation_model_arn]
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
# Task definition + service
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
      name            = "mission-control"
      image           = local.container_image
      essential       = true
      linuxParameters = { initProcessEnabled = true }
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MC_SERVICE_HOST", value = "0.0.0.0" },
        { name = "MC_SERVICE_PORT", value = "8000" },
        { name = "MC_SERVICE_SDK", value = "1" },
        { name = "CLAUDE_CODE_USE_BEDROCK", value = "1" },
        { name = "MC_WORKER_MODEL", value = var.worker_model },
        { name = "MC_WORKER_MAX_TURNS", value = tostring(var.worker_max_turns) },
      ]
      secrets = [
        { name = "MC_API_TOKEN", valueFrom = aws_secretsmanager_secret.api_token.arn },
        { name = "MC_POSTGRES_URL", valueFrom = aws_secretsmanager_secret.db_url.arn },
        # The worker's isolated-DB var points at the same instance for v1 (the SDK
        # subprocess does not use it meaningfully; true isolation is a later split).
        { name = "MC_WORKER_POSTGRES_URL", valueFrom = aws_secretsmanager_secret.db_url.arn },
        { name = "GITHUB_TOKEN", valueFrom = data.aws_secretsmanager_secret.github_token.arn },
      ]
      portMappings = [{ containerPort = 8000, protocol = "tcp" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "mission-control"
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
  desired_count          = 1
  launch_type            = "FARGATE"
  enable_execute_command = true

  # Runs in the shared private subnet (NAT egress); ingress only from the BFF.
  network_configuration {
    subnets          = [data.aws_subnet.worker_private.id]
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.this.arn
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# SSM exports the api stack reads to wire the BFF (HOMEBASE_MISSION_CONTROL_URL +
# token ARN).
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "mission_url" {
  name  = "/${var.project_name}/${var.environment}/mission-control/url"
  type  = "String"
  value = "http://mission-control.${var.dns_namespace}:8000"
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "mission_token_secret_arn" {
  name  = "/${var.project_name}/${var.environment}/mission-control/api_token_secret_arn"
  type  = "String"
  value = aws_secretsmanager_secret.api_token.arn
  tags  = local.common_tags
}

# The by-hand GitHub token secret's ARN, published so the BFF (P7) can write it from
# the GUI settings panel (POST /api/settings/github-token) and restart this service.
resource "aws_ssm_parameter" "github_token_secret_arn" {
  name  = "/${var.project_name}/${var.environment}/mission-control/github_token_secret_arn"
  type  = "String"
  value = data.aws_secretsmanager_secret.github_token.arn
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "cluster_name" {
  name  = "/${var.project_name}/${var.environment}/mission-control/cluster_name"
  type  = "String"
  value = aws_ecs_cluster.this.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "service_name" {
  name  = "/${var.project_name}/${var.environment}/mission-control/service_name"
  type  = "String"
  value = aws_ecs_service.this.name
  tags  = local.common_tags
}
