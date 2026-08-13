"""Secrets Manager rotation for the CloudFront origin shared secret.

The origin secret is shared between two places: the BFF (which reads it from
Secrets Manager at runtime, accepting current and pending during the window) and
the CloudFront distribution's custom header (static config). So rotation is
two-sided:

  createSecret : generate a new value as AWSPENDING.
  setSecret    : update the CloudFront distribution's X-Origin-Secret header to
                 the pending value (so CloudFront starts sending it; the BFF
                 already accepts both current and pending).
  testSecret   : no-op (equality is validated implicitly by the BFF).
  finishSecret : promote AWSPENDING to AWSCURRENT.

Config (env): PROJECT, ENVIRONMENT so it can read the distribution id and origin
id from SSM. No secret or account is baked in.
"""

import os
import secrets as pysecrets

import boto3


def _new_secret_value():
    return pysecrets.token_urlsafe(36)


def _ssm_param(ssm, name):
    return ssm.get_parameter(Name=name)["Parameter"]["Value"]


def _update_cloudfront_header(distribution_id, origin_id, secret_value):
    cf = boto3.client("cloudfront")
    current = cf.get_distribution_config(Id=distribution_id)
    etag = current["ETag"]
    config = current["DistributionConfig"]

    for origin in config["Origins"]["Items"]:
        if origin["Id"] == origin_id:
            headers = origin.setdefault("CustomHeaders", {"Quantity": 0, "Items": []})
            items = [h for h in headers.get("Items", []) if h["HeaderName"] != "X-Origin-Secret"]
            items.append({"HeaderName": "X-Origin-Secret", "HeaderValue": secret_value})
            headers["Items"] = items
            headers["Quantity"] = len(items)

    cf.update_distribution(Id=distribution_id, IfMatch=etag, DistributionConfig=config)


def handler(event, context):
    secret_id = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    sm = boto3.client("secretsmanager")
    project = os.environ["PROJECT"]
    environment = os.environ["ENVIRONMENT"]

    if step == "createSecret":
        try:
            sm.get_secret_value(SecretId=secret_id, VersionId=token, VersionStage="AWSPENDING")
        except sm.exceptions.ResourceNotFoundException:
            sm.put_secret_value(
                SecretId=secret_id,
                ClientRequestToken=token,
                SecretString=_new_secret_value(),
                VersionStages=["AWSPENDING"],
            )

    elif step == "setSecret":
        ssm = boto3.client("ssm")
        distribution_id = _ssm_param(ssm, f"/{project}/{environment}/web/distribution_id")
        origin_id = _ssm_param(ssm, f"/{project}/{environment}/web/bff_origin_id")
        pending = sm.get_secret_value(SecretId=secret_id, VersionId=token, VersionStage="AWSPENDING")
        _update_cloudfront_header(distribution_id, origin_id, pending["SecretString"])

    elif step == "testSecret":
        # The BFF accepts current and pending during the window, so no external
        # test call is needed here.
        pass

    elif step == "finishSecret":
        meta = sm.describe_secret(SecretId=secret_id)
        current_version = None
        for version, stages in meta.get("VersionIdsToStages", {}).items():
            if "AWSCURRENT" in stages:
                current_version = version
        if current_version != token:
            sm.update_secret_version_stage(
                SecretId=secret_id,
                VersionStage="AWSCURRENT",
                MoveToVersionId=token,
                RemoveFromVersionId=current_version,
            )

    else:
        raise ValueError(f"unknown rotation step: {step}")
