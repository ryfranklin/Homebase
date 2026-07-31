# ---------------------------------------------------------------------------
# Cost guardrail. A monthly cost budget notifies an SNS topic at each configured
# threshold, and email addresses are subscribed to that topic. This keeps a
# single-user personal project from silently running up cost. The email target
# is a variable, never a literal.
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

resource "aws_sns_topic" "budget_alerts" {
  name              = "${var.project_name}-${var.environment}-budget-alerts"
  kms_master_key_id = module.kms.key_id
  tags              = local.common_tags
}

# Published so the monitoring stack (P12) wires its cost/uptime alarms to THIS
# topic, not a new orphan topic.
resource "aws_ssm_parameter" "budget_sns_topic_arn" {
  name  = "/${var.project_name}/${var.environment}/foundation/budget_sns_topic_arn"
  type  = "String"
  value = aws_sns_topic.budget_alerts.arn
  tags  = local.common_tags
}

# The topic is KMS-encrypted; a Lambda publisher needs this key. Published for the
# monitoring stack.
resource "aws_ssm_parameter" "kms_key_arn" {
  name  = "/${var.project_name}/${var.environment}/foundation/kms_key_arn"
  type  = "String"
  value = module.kms.key_arn
  tags  = local.common_tags
}

# Allow the AWS Budgets service to publish to the topic, scoped to this account.
data "aws_iam_policy_document" "budget_sns" {
  statement {
    sid       = "AllowBudgetsPublish"
    effect    = "Allow"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.budget_alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "budget_alerts" {
  arn    = aws_sns_topic.budget_alerts.arn
  policy = data.aws_iam_policy_document.budget_sns.json
}

resource "aws_sns_topic_subscription" "budget_emails" {
  for_each = toset(var.budget_alert_emails)

  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_amount)
  limit_unit   = var.budget_currency
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = var.budget_alert_thresholds
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
    }
  }
}
