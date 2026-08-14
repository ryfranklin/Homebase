data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# The VPC's existing internet gateway (created by the workstation stack). The
# worker's public subnet routes to it for GitHub egress.
data "aws_internet_gateway" "this" {
  filter {
    name   = "attachment.vpc-id"
    values = [var.vpc_id]
  }
}

# The corpus bucket + KB (mirror target and grounding), published by earlier stacks.
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

# The by-hand GitHub PAT secret (value never in Terraform; referenced by name).
data "aws_secretsmanager_secret" "github_token" {
  name = var.github_token_secret_name
}

# Latest AL2023 arm64 AMI for the NAT instance (matches the workstation NAT).
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "vault-worker"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}-vault-worker"
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition

  corpus_bucket_name = data.aws_ssm_parameter.corpus_bucket_name.value
  corpus_kms_key_arn = data.aws_ssm_parameter.corpus_kms_key_arn.value
  corpus_bucket_arn  = "arn:${data.aws_partition.current.partition}:s3:::${data.aws_ssm_parameter.corpus_bucket_name.value}"
  knowledge_base_id  = data.aws_ssm_parameter.knowledge_base_id.value
  data_source_id     = data.aws_ssm_parameter.data_source_id.value
  knowledge_base_arn = "arn:${local.partition}:bedrock:${var.aws_region}:${local.account_id}:knowledge-base/${data.aws_ssm_parameter.knowledge_base_id.value}"

  container_image = "${aws_ecr_repository.worker.repository_url}:${var.image_tag}"
}

# KMS key for logs, the ECS Exec channel, and the generated worker secret.
module "worker_kms" {
  source = "../../modules/kms"

  alias              = local.name_prefix
  description        = "Homebase ${var.environment} vault-worker logs, exec channel, and worker secret key"
  service_principals = ["logs.amazonaws.com"]
  tags               = local.common_tags
}

# ---------------------------------------------------------------------------
# Networking (internal architecture). A public subnet holds only an always-on NAT
# instance; the worker and the BFF run PRIVATE and egress through it (GitHub, AWS).
# The worker has no public IP and no inbound except port 8080 from the BFF.
# ---------------------------------------------------------------------------
resource "aws_subnet" "public" {
  vpc_id                  = var.vpc_id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = merge(local.common_tags, { Name = "${local.name_prefix}-nat-public", Tier = "public" })
}

resource "aws_route_table" "public" {
  vpc_id = var.vpc_id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = data.aws_internet_gateway.this.id
  }
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-public-rt" })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_subnet" "private" {
  vpc_id            = var.vpc_id
  cidr_block        = var.private_subnet_cidr
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = merge(local.common_tags, { Name = "${local.name_prefix}-private", Tier = "private" })
}

resource "aws_route_table" "private" {
  vpc_id = var.vpc_id
  route {
    cidr_block           = "0.0.0.0/0"
    network_interface_id = aws_instance.nat.primary_network_interface_id
  }
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-private-rt" })
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# NAT instance: forwards the private subnet's traffic to the internet. AL2023 has
# no iptables by default, so install + persist the rules (same as the workstation).
resource "aws_security_group" "nat" {
  name        = "${local.name_prefix}-nat"
  description = "NAT instance: inbound from the private subnet, egress anywhere"
  vpc_id      = var.vpc_id

  ingress {
    description = "From the private subnet"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.private_subnet_cidr]
  }
  egress {
    description = "Outbound anywhere"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-nat" })
}

resource "aws_instance" "nat" {
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.nat_instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.nat.id]
  associate_public_ip_address = true
  source_dest_check           = false

  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    encrypted   = true
    kms_key_id  = module.worker_kms.key_arn
    volume_size = 8
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-nat.conf
    sysctl -w net.ipv4.ip_forward=1
    dnf install -y iptables-services
    IFACE=$(ip route show default | awk '/default/ {print $5; exit}')
    iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
    iptables -A FORWARD -i "$IFACE" -o "$IFACE" -j ACCEPT
    iptables-save > /etc/sysconfig/iptables
    systemctl enable iptables
  EOT

  user_data_replace_on_change = true
  tags                        = merge(local.common_tags, { Name = "${local.name_prefix}-nat" })
}

# The BFF attaches to this SG so the worker can allow it in by reference (the BFF's
# source IP is not stable). Egress-only; it also lets the BFF reach the NAT and AWS.
resource "aws_security_group" "client" {
  name        = "${local.name_prefix}-client"
  description = "BFF -> worker client SG (egress only)"
  vpc_id      = var.vpc_id

  egress {
    description = "Outbound anywhere (worker, NAT, AWS)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.common_tags
}

# Worker: inbound 8080 only from the client SG; egress anywhere (via the NAT).
resource "aws_security_group" "worker" {
  name        = local.name_prefix
  description = "vault-worker: inbound 8080 from the BFF client SG; egress via NAT"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Internal write API from the BFF"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.client.id]
  }
  egress {
    description = "Outbound anywhere (GitHub, S3, Bedrock, ECR, DNS) via the NAT"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Cloud Map service discovery: the worker registers as worker.<namespace>, a
# stable name the BFF resolves to the current task IP.
# ---------------------------------------------------------------------------
resource "aws_service_discovery_private_dns_namespace" "this" {
  name = var.dns_namespace
  vpc  = var.vpc_id
  tags = local.common_tags
}

resource "aws_service_discovery_service" "worker" {
  name = "worker"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      type = "A"
      ttl  = 15
    }
    routing_policy = "MULTIVALUE"
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# ECR + logs + a generated internal shared secret (BFF -> worker auth, later).
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "worker" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.worker_kms.key_arn
  }
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "task" {
  name              = "/${var.project_name}/${var.environment}/vault-worker/task"
  retention_in_days = 30
  kms_key_id        = module.worker_kms.key_arn
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/${var.project_name}/${var.environment}/vault-worker/exec"
  retention_in_days = 30
  kms_key_id        = module.worker_kms.key_arn
  tags              = local.common_tags
}

resource "random_password" "worker_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "worker_secret" {
  name        = "${var.project_name}-${var.environment}/vault-worker-shared-secret"
  description = "Shared secret the BFF presents to the vault worker's internal API"
  kms_key_id  = module.worker_kms.key_arn
  tags        = local.common_tags
}

resource "aws_secretsmanager_secret_version" "worker_secret" {
  secret_id     = aws_secretsmanager_secret.worker_secret.id
  secret_string = random_password.worker_secret.result
}

# ---------------------------------------------------------------------------
# ECS cluster with ECS Exec (KMS-encrypted, logged) for debugging.
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  configuration {
    execute_command_configuration {
      kms_key_id = module.worker_kms.key_arn
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
# Execution role: pull the image, write logs, and inject the two secrets.
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
    resources = [aws_ecr_repository.worker.arn]
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
    resources = [module.worker_kms.key_arn]
  }
  # Inject the GitHub token and the worker shared secret into the container.
  statement {
    sid       = "InjectSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.aws_secretsmanager_secret.github_token.arn, "${aws_secretsmanager_secret.worker_secret.arn}*"]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "${local.name_prefix}-exec-policy"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# ---------------------------------------------------------------------------
# Task role: mirror to the corpus bucket, re-ground the KB, and the ECS Exec
# channel. The token is injected by the execution role, so the task role needs no
# Secrets Manager access.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ListCorpusBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [local.corpus_bucket_arn]
  }
  statement {
    sid       = "MirrorCorpusObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.corpus_bucket_arn}/*"]
  }
  statement {
    sid       = "CorpusKms"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.corpus_kms_key_arn]
  }
  statement {
    sid       = "ReindexKnowledgeBase"
    effect    = "Allow"
    actions   = ["bedrock:StartIngestionJob"]
    resources = [local.knowledge_base_arn]
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
    resources = [module.worker_kms.key_arn]
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

  runtime_platform {
    cpu_architecture        = var.task_cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name            = "vault-worker"
      image           = local.container_image
      essential       = true
      linuxParameters = { initProcessEnabled = true }
      environment = [
        { name = "VAULT_REMOTE_URL", value = var.github_repo_url },
        { name = "VAULT_BRANCH", value = var.vault_branch },
        { name = "VAULT_WORK_DIR", value = "/data/vault" },
        { name = "HOMEBASE_CORPUS_BUCKET", value = local.corpus_bucket_name },
        { name = "HOMEBASE_KB_ID", value = local.knowledge_base_id },
        { name = "HOMEBASE_KB_DATA_SOURCE_ID", value = local.data_source_id },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "VAULT_PULL_INTERVAL_MS", value = tostring(var.pull_interval_ms) },
        { name = "GIT_COMMITTER_NAME", value = var.git_committer_name },
        { name = "GIT_COMMITTER_EMAIL", value = var.git_committer_email },
        { name = "PORT", value = "8080" },
      ]
      secrets = [
        { name = "GITHUB_TOKEN", valueFrom = data.aws_secretsmanager_secret.github_token.arn },
        { name = "WORKER_SHARED_SECRET", valueFrom = aws_secretsmanager_secret.worker_secret.arn },
      ]
      portMappings = [{ containerPort = 8080, protocol = "tcp" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.task.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "vault-worker"
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

  # Private subnet, no public IP: egress is via the NAT, ingress only from the BFF.
  network_configuration {
    subnets          = [aws_subnet.private.id]
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  # Register the task in Cloud Map (worker.<namespace>) for the BFF to resolve.
  service_registries {
    registry_arn = aws_service_discovery_service.worker.arn
  }

  tags = local.common_tags
}

resource "aws_ssm_parameter" "cluster_name" {
  name  = "/${var.project_name}/${var.environment}/vault-worker/cluster_name"
  type  = "String"
  value = aws_ecs_cluster.this.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "service_name" {
  name  = "/${var.project_name}/${var.environment}/vault-worker/service_name"
  type  = "String"
  value = aws_ecs_service.this.name
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "worker_secret_arn" {
  name  = "/${var.project_name}/${var.environment}/vault-worker/shared_secret_arn"
  type  = "String"
  value = aws_secretsmanager_secret.worker_secret.arn
  tags  = local.common_tags
}

# Cross-stack wiring for the BFF (api stack reads these).
resource "aws_ssm_parameter" "worker_url" {
  name  = "/${var.project_name}/${var.environment}/vault-worker/url"
  type  = "String"
  value = "http://worker.${var.dns_namespace}:8080"
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "client_sg_id" {
  name  = "/${var.project_name}/${var.environment}/vault-worker/client_security_group_id"
  type  = "String"
  value = aws_security_group.client.id
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "private_subnet_id" {
  name  = "/${var.project_name}/${var.environment}/vault-worker/private_subnet_id"
  type  = "String"
  value = aws_subnet.private.id
  tags  = local.common_tags
}
