"""Pre-Sign-Up trigger: restrict account creation to an allow-list of emails.

Cognito invokes this before creating an account. It fires for native self
sign-up (PreSignUp_SignUp), first-time federated sign-in
(PreSignUp_ExternalProvider, e.g. Google), and admin creation
(PreSignUp_AdminCreateUser). Any email not on the allow-list is rejected, so the
pool is not open to anyone who reaches the hosted UI, on either the native or the
Google path.

The allow-list is supplied via the ALLOWED_EMAILS env var (comma-separated),
sourced from the git-ignored tfvars. No email is ever hardcoded here.
"""

import os

_ALLOWED = frozenset(
    part.strip().lower()
    for part in os.environ.get("ALLOWED_EMAILS", "").split(",")
    if part.strip()
)


def handler(event, _context):
    attributes = event.get("request", {}).get("userAttributes") or {}
    email = (attributes.get("email") or "").strip().lower()

    if not email or email not in _ALLOWED:
        # Raising fails the sign-up; Cognito surfaces the message to the caller.
        raise Exception("This application is invite-only; your account is not authorized.")

    return event
