# ---------------------------------------------------------------------------
# Sign-up allow-list gate (opt-in via enable_signup_allowlist).
#
# A Pre-Sign-Up Lambda rejects any account whose email is not on the list,
# covering BOTH native self sign-up and first-time Google federation. This is the
# access gate that keeps the pool from being open to anyone who reaches the hosted
# UI. The pool's lambda_config.pre_sign_up is wired in main.tf, gated on the same
# flag.
#
# The allow-list itself is NOT in Terraform or this repo. It is a by-hand SSM
# SecureString (KMS-encrypted) at local.allowlist_param_name; Terraform references
# it only by NAME (Lambda env + IAM). The value never enters state, plans, or
# tfvars. Create it before relying on the gate:
#
#   aws ssm put-parameter --type SecureString \
#     --name /homebase/<env>/identity/allowed-signup-emails \
#     --value "you@example.com,other@example.com" --region <region>
#
# When enable_signup_allowlist is false the trigger is not created and the pool
# behaves as before (open self-signup).
# ---------------------------------------------------------------------------
data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

locals {
  signup_gate_enabled  = var.enable_signup_allowlist
  allowlist_param_name = "/${var.project_name}/${var.environment}/identity/allowed-signup-emails"
  allowlist_param_arn  = "arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${local.allowlist_param_name}"
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

# CloudWatch Logs only.
resource "aws_iam_role_policy_attachment" "presignup_logs" {
  count      = local.signup_gate_enabled ? 1 : 0
  role       = aws_iam_role.presignup[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Read and decrypt the by-hand allow-list SecureString. GetParameter is scoped to
# the single parameter; kms:Decrypt is constrained to decryption performed via
# SSM only, so no specific key ARN is hardcoded and the key can be the default
# aws/ssm managed key or a CMK.
data "aws_iam_policy_document" "presignup" {
  count = local.signup_gate_enabled ? 1 : 0

  statement {
    sid       = "ReadAllowlistParam"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [local.allowlist_param_arn]
  }

  statement {
    sid       = "DecryptViaSsm"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "presignup" {
  count  = local.signup_gate_enabled ? 1 : 0
  name   = "${local.name_prefix}-presignup-policy"
  role   = aws_iam_role.presignup[0].id
  policy = data.aws_iam_policy_document.presignup[0].json
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
      # Only the NAME of the by-hand SecureString. No emails in Terraform.
      ALLOWED_EMAILS_PARAM = local.allowlist_param_name
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
