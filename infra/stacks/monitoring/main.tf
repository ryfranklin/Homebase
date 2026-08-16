data "aws_partition" "current" {}

# The P2 budget SNS topic and the KMS key that encrypts it. Cost/uptime alarms
# wire to THIS topic, not a new orphan.
data "aws_ssm_parameter" "budget_sns_topic_arn" {
  name = "/${var.project_name}/${var.environment}/foundation/budget_sns_topic_arn"
}

data "aws_ssm_parameter" "kms_key_arn" {
  name = "/${var.project_name}/${var.environment}/foundation/kms_key_arn"
}

locals {
  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "monitoring"
  }, var.tags)

  name_prefix   = "${var.project_name}-${var.environment}"
  sns_topic_arn = data.aws_ssm_parameter.budget_sns_topic_arn.value
  kms_key_arn   = data.aws_ssm_parameter.kms_key_arn.value

  bff_function_name = "${local.name_prefix}-bff"
  cli_cluster_name  = "${local.name_prefix}-cli"

  enable_uptime = var.workstation_instance_id != ""
}

# ---------------------------------------------------------------------------
# Cost/usage alarms on Bedrock (agent spend proxy), wired to the P2 SNS topic.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "bedrock_invocations" {
  alarm_name          = "${local.name_prefix}-bedrock-invocations"
  namespace           = "AWS/Bedrock"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.bedrock_invocations_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Bedrock invocations/hour high (agent spend proxy). $ budgeting is AWS Budgets (P2)."
  alarm_actions       = [local.sns_topic_arn]
  ok_actions          = [local.sns_topic_arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "bedrock_output_tokens" {
  alarm_name          = "${local.name_prefix}-bedrock-output-tokens"
  namespace           = "AWS/Bedrock"
  metric_name         = "OutputTokenCount"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.bedrock_output_tokens_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Bedrock output tokens/hour high (agent spend proxy)."
  alarm_actions       = [local.sns_topic_arn]
  ok_actions          = [local.sns_topic_arn]
  tags                = local.common_tags
}

# ---------------------------------------------------------------------------
# Workstation running-too-long alert. There is no uptime metric, so a scheduled
# Lambda checks launch time and publishes to the P2 SNS topic past a threshold.
# ---------------------------------------------------------------------------
data "archive_file" "uptime" {
  count       = local.enable_uptime ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/build/uptime.zip"
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "uptime" {
  count              = local.enable_uptime ? 1 : 0
  name               = "${local.name_prefix}-uptime-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "uptime" {
  count = local.enable_uptime ? 1 : 0

  # DescribeInstances has no resource-level scoping (AWS requirement).
  statement {
    sid       = "DescribeInstances"
    effect    = "Allow"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  statement {
    sid       = "PublishAlert"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [local.sns_topic_arn]
  }

  statement {
    sid       = "UseTopicKey"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [local.kms_key_arn]
  }

  statement {
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:*:*"]
  }
}

resource "aws_iam_role_policy" "uptime" {
  count  = local.enable_uptime ? 1 : 0
  name   = "${local.name_prefix}-uptime-policy"
  role   = aws_iam_role.uptime[0].id
  policy = data.aws_iam_policy_document.uptime[0].json
}

resource "aws_lambda_function" "uptime" {
  count            = local.enable_uptime ? 1 : 0
  function_name    = "${local.name_prefix}-uptime-check"
  role             = aws_iam_role.uptime[0].arn
  runtime          = "python3.12"
  handler          = "uptime_check.handler"
  filename         = data.archive_file.uptime[0].output_path
  source_code_hash = data.archive_file.uptime[0].output_base64sha256
  timeout          = 30

  environment {
    variables = {
      WORKSTATION_INSTANCE_ID = var.workstation_instance_id
      ALERT_TOPIC_ARN         = local.sns_topic_arn
      UPTIME_THRESHOLD_HOURS  = tostring(var.workstation_uptime_threshold_hours)
    }
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_event_rule" "uptime" {
  count               = local.enable_uptime ? 1 : 0
  name                = "${local.name_prefix}-uptime-check"
  schedule_expression = var.uptime_check_schedule
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "uptime" {
  count     = local.enable_uptime ? 1 : 0
  rule      = aws_cloudwatch_event_rule.uptime[0].name
  target_id = "uptime-lambda"
  arn       = aws_lambda_function.uptime[0].arn
}

resource "aws_lambda_permission" "uptime" {
  count         = local.enable_uptime ? 1 : 0
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.uptime[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.uptime[0].arn
}

# ---------------------------------------------------------------------------
# Per-plane dashboards.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "agent" {
  dashboard_name = "${local.name_prefix}-agent-retrieval"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title  = "Agent: Bedrock invocations and latency",
          region = var.aws_region,
          metrics = [
            ["AWS/Bedrock", "Invocations", { stat = "Sum" }],
            ["AWS/Bedrock", "InvocationLatency", { stat = "Average" }],
          ],
        },
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title  = "Retrieval: token throughput (input/output)",
          region = var.aws_region,
          metrics = [
            ["AWS/Bedrock", "InputTokenCount", { stat = "Sum" }],
            ["AWS/Bedrock", "OutputTokenCount", { stat = "Sum" }],
          ],
        },
      },
      # Per-model breakdown: with several models selectable in the GUI, aggregate
      # Bedrock metrics hide which model is driving spend. These SEARCH widgets
      # auto-discover every ModelId that reports (no hardcoded ids), so newly
      # allowed models appear automatically. Output tokens are the main cost driver.
      # Metrics only (counts/tokens), NOT model-invocation logging, which would
      # capture full prompts/responses (user email, calendar, secrets).
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6,
        properties = {
          title   = "Bedrock invocations by model",
          region  = var.aws_region,
          view    = "timeSeries",
          stacked = false,
          period  = 300,
          metrics = [
            [{ expression = "SEARCH('{AWS/Bedrock,ModelId} MetricName=\"Invocations\"', 'Sum', 300)", id = "invByModel", label = "" }],
          ],
        },
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6,
        properties = {
          title   = "Bedrock output tokens by model (cost driver)",
          region  = var.aws_region,
          view    = "timeSeries",
          stacked = false,
          period  = 300,
          metrics = [
            [{ expression = "SEARCH('{AWS/Bedrock,ModelId} MetricName=\"OutputTokenCount\"', 'Sum', 300)", id = "outTokByModel", label = "" }],
          ],
        },
      },
    ]
  })
}

resource "aws_cloudwatch_dashboard" "front_doors" {
  dashboard_name = "${local.name_prefix}-front-doors"

  dashboard_body = jsonencode({
    widgets = concat([
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title  = "GUI plane: BFF Lambda (duration, errors)",
          region = var.aws_region,
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", local.bff_function_name, { stat = "Average" }],
            ["AWS/Lambda", "Errors", "FunctionName", local.bff_function_name, { stat = "Sum" }],
            ["AWS/Lambda", "Invocations", "FunctionName", local.bff_function_name, { stat = "Sum" }],
          ],
        },
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title  = "Chat CLI plane: ECS CPU / memory",
          region = var.aws_region,
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", local.cli_cluster_name, { stat = "Average" }],
            ["AWS/ECS", "MemoryUtilization", "ClusterName", local.cli_cluster_name, { stat = "Average" }],
          ],
        },
      },
      ],
      var.cloudfront_distribution_id != "" ? [
        {
          type = "metric", x = 0, y = 6, width = 24, height = 6,
          properties = {
            title  = "GUI plane: CloudFront requests and 5xx",
            region = "us-east-1",
            metrics = [
              ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Sum" }],
              ["AWS/CloudFront", "5xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average" }],
            ],
          },
        },
      ] : [],
    )
  })
}

resource "aws_cloudwatch_dashboard" "workstation" {
  count          = local.enable_uptime ? 1 : 0
  dashboard_name = "${local.name_prefix}-workstation"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 24, height = 6,
        properties = {
          title  = "Workstation plane: CPU and network",
          region = var.aws_region,
          metrics = [
            ["AWS/EC2", "CPUUtilization", "InstanceId", var.workstation_instance_id, { stat = "Average" }],
            ["AWS/EC2", "NetworkOut", "InstanceId", var.workstation_instance_id, { stat = "Sum" }],
          ],
        },
      },
    ]
  })
}
