# ---------------------------------------------------------------------------
# Sign-up allow-list gate (opt-in via allowed_signup_emails).
#
# A Pre-Sign-Up Lambda rejects any account whose email is not on the list,
# covering BOTH native self sign-up and first-time Google federation. This is the
# access gate that keeps the pool from being open to anyone who reaches the hosted
# UI. When allowed_signup_emails is empty the trigger is NOT created and the pool
# behaves as before (open self-signup). The pool's lambda_config.pre_sign_up is
# wired in main.tf, gated on the same condition.
# ---------------------------------------------------------------------------
data "aws_partition" "current" {}

locals {
  signup_gate_enabled = length(var.allowed_signup_emails) > 0
}

data "archive_file" "presignup" {
  count       = local.signup_gate_enabled ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/presignup"
  output_path = "${path.module}/build/presignup.zip"
}

data "aws_iam_policy_document" "presignup_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "presignup" {
  count              = local.signup_gate_enabled ? 1 : 0
  name               = "${local.name_prefix}-presignup-role"
  assume_role_policy = data.aws_iam_policy_document.presignup_trust.json
  tags               = local.common_tags
}

# Minimal permissions: write its own CloudWatch logs. No app permissions.
resource "aws_iam_role_policy_attachment" "presignup_logs" {
  count      = local.signup_gate_enabled ? 1 : 0
  role       = aws_iam_role.presignup[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "presignup" {
  count            = local.signup_gate_enabled ? 1 : 0
  function_name    = "${local.name_prefix}-presignup-allowlist"
  role             = aws_iam_role.presignup[0].arn
  runtime          = "python3.12"
  handler          = "allowlist.handler"
  filename         = data.archive_file.presignup[0].output_path
  source_code_hash = data.archive_file.presignup[0].output_base64sha256
  timeout          = 5

  environment {
    variables = {
      # Allow-list sourced from git-ignored tfvars; never a committed literal.
      ALLOWED_EMAILS = join(",", var.allowed_signup_emails)
    }
  }

  tags = local.common_tags
}

resource "aws_lambda_permission" "presignup" {
  count         = local.signup_gate_enabled ? 1 : 0
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presignup[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}
