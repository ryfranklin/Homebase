data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# Latest Amazon Linux 2023 (arm64) AMI.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "workstation"
  }, var.tags)

  name_prefix = "${var.project_name}-${var.environment}-ws"
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition
  az          = data.aws_availability_zones.available.names[var.az_index]

  home_device = "/dev/sdf"

  use_nat_instance = var.nat_egress_type == "nat_instance"
  use_nat_gateway  = var.nat_egress_type == "nat_gateway"

  # Instances that the scheduled stop turns off (workstation, plus the NAT
  # instance so egress cost stops too).
  stoppable_instance_ids = compact([
    aws_instance.workstation.id,
    local.use_nat_instance ? aws_instance.nat[0].id : "",
  ])
  stoppable_instance_arns = [
    for id in local.stoppable_instance_ids :
    "arn:${local.partition}:ec2:${var.aws_region}:${local.account_id}:instance/${id}"
  ]
}

# KMS key for the encrypted EBS volumes.
module "workstation_kms" {
  source = "../../modules/kms"

  alias       = local.name_prefix
  description = "Homebase ${var.environment} workstation EBS encryption key"
  tags        = local.common_tags
}

# ---------------------------------------------------------------------------
# Egress path. The private-only foundation VPC has no internet access; this adds
# an internet gateway, a public subnet holding only the NAT, and a dedicated
# private subnet for the workstation whose default route is the NAT. Egress is
# OUTBOUND ONLY: the workstation has no public IP and no inbound path.
# ---------------------------------------------------------------------------
resource "aws_internet_gateway" "this" {
  vpc_id = var.vpc_id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  vpc_id                  = var.vpc_id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = local.az
  map_public_ip_on_launch = true
  tags                    = merge(local.common_tags, { Name = "${local.name_prefix}-public", Tier = "public" })
}

resource "aws_route_table" "public" {
  vpc_id = var.vpc_id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-public-rt" })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_subnet" "workstation" {
  vpc_id                  = var.vpc_id
  cidr_block              = var.workstation_subnet_cidr
  availability_zone       = local.az
  map_public_ip_on_launch = false
  tags                    = merge(local.common_tags, { Name = "${local.name_prefix}-private", Tier = "private" })
}

resource "aws_route_table" "workstation" {
  vpc_id = var.vpc_id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-private-rt" })
}

resource "aws_route" "workstation_egress" {
  route_table_id         = aws_route_table.workstation.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = local.use_nat_gateway ? aws_nat_gateway.this[0].id : null
  network_interface_id   = local.use_nat_instance ? aws_instance.nat[0].primary_network_interface_id : null
}

resource "aws_route_table_association" "workstation" {
  subnet_id      = aws_subnet.workstation.id
  route_table_id = aws_route_table.workstation.id
}

# --- NAT gateway option (managed, always-on) ---
resource "aws_eip" "nat_gateway" {
  count  = local.use_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = local.common_tags
}

resource "aws_nat_gateway" "this" {
  count         = local.use_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat_gateway[0].id
  subnet_id     = aws_subnet.public.id
  tags          = merge(local.common_tags, { Name = "${local.name_prefix}-natgw" })
  depends_on    = [aws_internet_gateway.this]
}

# --- NAT instance option (stoppable, cheaper; default) ---
resource "aws_security_group" "nat" {
  count       = local.use_nat_instance ? 1 : 0
  name        = "${local.name_prefix}-nat"
  description = "NAT instance: inbound from the workstation subnet, egress anywhere"
  vpc_id      = var.vpc_id

  ingress {
    description = "From the workstation subnet"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.workstation_subnet_cidr]
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
  count                       = local.use_nat_instance ? 1 : 0
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.nat_instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.nat[0].id]
  associate_public_ip_address = true
  source_dest_check           = false
  # No instance profile: the NAT only forwards packets and needs no AWS access.

  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    encrypted   = true
    kms_key_id  = module.workstation_kms.key_arn
    volume_size = 8
  }

  # Enable IP forwarding and masquerade so the private subnet reaches the internet.
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    sysctl -w net.ipv4.ip_forward=1
    echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-nat.conf
    IFACE=$(ip route show default | awk '/default/ {print $5; exit}')
    iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
    iptables -A FORWARD -i "$IFACE" -o "$IFACE" -j ACCEPT
  EOT

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-nat" })
}

# ---------------------------------------------------------------------------
# Instance role. NOT admin. Scoped to exactly what the box needs: SSM Session
# Manager, reading its own dotfiles/secret pointers and the shell secret, and
# assuming task-specific roles for anything broad (short-lived credentials
# instead of standing permissions or stored keys).
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "instance_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workstation" {
  name               = "${local.name_prefix}-role"
  assume_role_policy = data.aws_iam_policy_document.instance_trust.json
  tags               = local.common_tags
}

# SSM Session Manager baseline (the standard least-privilege managed policy for
# SSM-managed instances; it contains no admin and no "*:*").
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.workstation.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "workstation" {
  # Read the dotfiles/secret pointers this stack publishes.
  statement {
    sid       = "ReadWorkstationParameters"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:${local.partition}:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project_name}/${var.environment}/workstation/*"]
  }

  # Pull the machine-local shell secret at session start (scoped to this secret,
  # plus the optional git-auth secret for cloning a private dotfiles repo).
  statement {
    sid     = "ReadShellSecret"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      ["arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:${var.dotfiles_secret_name}*"],
      var.dotfiles_auth_secret_name != "" ? ["arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:${var.dotfiles_auth_secret_name}*"] : [],
    )
  }

  # Decrypt the shell secret if it is encrypted with the workstation key.
  statement {
    sid       = "DecryptSecret"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.workstation_kms.key_arn]
  }

  # Assume task-specific roles for short-lived credentials. This is how broad
  # operations happen: never through standing instance permissions.
  dynamic "statement" {
    for_each = length(var.assumable_role_arns) > 0 ? [1] : []
    content {
      sid       = "AssumeTaskRoles"
      effect    = "Allow"
      actions   = ["sts:AssumeRole"]
      resources = var.assumable_role_arns
    }
  }
}

resource "aws_iam_role_policy" "workstation" {
  name   = "${local.name_prefix}-policy"
  role   = aws_iam_role.workstation.id
  policy = data.aws_iam_policy_document.workstation.json
}

resource "aws_iam_instance_profile" "workstation" {
  name = "${local.name_prefix}-profile"
  role = aws_iam_role.workstation.name
}

# Pointers the bootstrap reads at boot (not secret; the real dotfiles URL is your
# input, kept out of the committed bootstrap script).
resource "aws_ssm_parameter" "dotfiles_repo_url" {
  name  = "/${var.project_name}/${var.environment}/workstation/dotfiles_repo_url"
  type  = "String"
  value = var.dotfiles_repo_url == "" ? "unset" : var.dotfiles_repo_url
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "dotfiles_secret_name" {
  name  = "/${var.project_name}/${var.environment}/workstation/dotfiles_secret_name"
  type  = "String"
  value = var.dotfiles_secret_name
  tags  = local.common_tags
}

# Pointer to the optional git-auth secret used to clone a private dotfiles repo.
# "unset" when not configured; the bootstrap then does an unauthenticated clone.
resource "aws_ssm_parameter" "dotfiles_auth_secret_name" {
  name  = "/${var.project_name}/${var.environment}/workstation/dotfiles_auth_secret_name"
  type  = "String"
  value = var.dotfiles_auth_secret_name == "" ? "unset" : var.dotfiles_auth_secret_name
  tags  = local.common_tags
}

# ---------------------------------------------------------------------------
# Workstation instance and persistent home volume. SSM-only: no key pair, no
# inbound, no public IP. Encrypted root and home volumes. IMDSv2 required.
# ---------------------------------------------------------------------------
resource "aws_security_group" "workstation" {
  name        = local.name_prefix
  description = "Workstation: no inbound, outbound only"
  vpc_id      = var.vpc_id

  egress {
    description = "Outbound only (via NAT)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = local.name_prefix })
}

resource "aws_instance" "workstation" {
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.workstation.id
  vpc_security_group_ids      = [aws_security_group.workstation.id]
  iam_instance_profile        = aws_iam_instance_profile.workstation.name
  associate_public_ip_address = false
  # No key_name: access is exclusively via SSM Session Manager.

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted   = true
    kms_key_id  = module.workstation_kms.key_arn
    volume_size = var.root_volume_size
  }

  user_data = templatefile("${path.module}/../../../workstation/bootstrap/user-data.sh.tftpl", {
    project_name     = var.project_name
    environment      = var.environment
    aws_region       = var.aws_region
    workstation_user = var.workstation_user
    home_device      = local.home_device
  })

  tags = merge(local.common_tags, { Name = local.name_prefix })

  depends_on = [aws_route.workstation_egress]
}

resource "aws_ebs_volume" "home" {
  availability_zone = local.az
  size              = var.home_volume_size
  encrypted         = true
  kms_key_id        = module.workstation_kms.key_arn
  tags              = merge(local.common_tags, { Name = "${local.name_prefix}-home" })
}

resource "aws_volume_attachment" "home" {
  device_name = local.home_device
  volume_id   = aws_ebs_volume.home.id
  instance_id = aws_instance.workstation.id
  # Keep the persistent home volume on instance stop/replace.
  stop_instance_before_detaching = true
}

# ---------------------------------------------------------------------------
# Auto-stop-when-idle.
# ---------------------------------------------------------------------------
# Scheduled: EventBridge Scheduler stops the workstation AND the NAT instance,
# so egress cost stops too.
data "aws_iam_policy_document" "scheduler_trust" {
  count = var.auto_stop_mode == "scheduled" ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = var.auto_stop_mode == "scheduled" ? 1 : 0
  name               = "${local.name_prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust[0].json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "scheduler" {
  count = var.auto_stop_mode == "scheduled" ? 1 : 0
  statement {
    sid       = "StopInstances"
    effect    = "Allow"
    actions   = ["ec2:StopInstances"]
    resources = local.stoppable_instance_arns
  }
}

resource "aws_iam_role_policy" "scheduler" {
  count  = var.auto_stop_mode == "scheduled" ? 1 : 0
  name   = "${local.name_prefix}-scheduler-policy"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler[0].json
}

resource "aws_scheduler_schedule" "stop" {
  count = var.auto_stop_mode == "scheduled" ? 1 : 0
  name  = "${local.name_prefix}-stop"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = var.stop_schedule

  target {
    arn      = "arn:${local.partition}:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = local.stoppable_instance_ids })
  }
}

# Activity: stop the workstation when CPU stays low. (Use scheduled mode if you
# also want the NAT instance stopped.)
resource "aws_cloudwatch_metric_alarm" "idle" {
  count               = var.auto_stop_mode == "activity" ? 1 : 0
  alarm_name          = "${local.name_prefix}-idle-stop"
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = var.idle_periods
  threshold           = var.idle_cpu_threshold
  comparison_operator = "LessThanThreshold"
  dimensions          = { InstanceId = aws_instance.workstation.id }
  alarm_actions       = ["arn:${local.partition}:automate:${var.aws_region}:ec2:stop"]
  tags                = local.common_tags
}
