"""Pre-Sign-Up trigger: restrict account creation to an allow-list of emails.

Cognito invokes this before creating an account. It fires for native self
sign-up (PreSignUp_SignUp), first-time federated sign-in
(PreSignUp_ExternalProvider, e.g. Google), and admin creation
(PreSignUp_AdminCreateUser). Any email not on the allow-list is rejected, so the
pool is not open to anyone who reaches the hosted UI, on either the native or the
Google path.

The allow-list is NOT stored in Terraform or in this repo. It is a by-hand SSM
Parameter Store SecureString (KMS-encrypted), referenced only by NAME via the
ALLOWED_EMAILS_PARAM environment variable. The Lambda reads and decrypts it at
runtime. Any failure to read the parameter raises, which Cognito treats as a
trigger failure and denies the sign-up (fail closed).
"""

import os

import boto3

_ssm = boto3.client("ssm")


def _allowed_emails():
    name = os.environ["ALLOWED_EMAILS_PARAM"]
    value = _ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    return frozenset(part.strip().lower() for part in value.split(",") if part.strip())


def handler(event, _context):
    attributes = event.get("request", {}).get("userAttributes") or {}
    email = (attributes.get("email") or "").strip().lower()

    # Reading the allow-list can raise (missing param, no access): fail closed.
    allowed = _allowed_emails()

    if not email or email not in allowed:
        raise Exception("This application is invite-only; your account is not authorized.")

    return event
