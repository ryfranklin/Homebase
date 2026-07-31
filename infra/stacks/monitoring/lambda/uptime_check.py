"""Scheduled check: alert if the workstation has been running too long.

There is no CloudWatch metric for instance uptime, so a small scheduled Lambda
reads the instance launch time and publishes to the P2 budget SNS topic when the
box has been running past a threshold. Config comes from environment variables
(instance id, topic ARN, threshold); nothing is hardcoded.
"""

import datetime
import json
import os

import boto3


def _hours_running(instance):
    launch = instance["LaunchTime"]
    now = datetime.datetime.now(datetime.timezone.utc)
    return (now - launch).total_seconds() / 3600.0


def handler(event, context):
    instance_id = os.environ["WORKSTATION_INSTANCE_ID"]
    topic_arn = os.environ["ALERT_TOPIC_ARN"]
    threshold = float(os.environ.get("UPTIME_THRESHOLD_HOURS", "12"))

    ec2 = boto3.client("ec2")
    sns = boto3.client("sns")

    reservations = ec2.describe_instances(InstanceIds=[instance_id]).get("Reservations", [])
    instances = [i for r in reservations for i in r.get("Instances", [])]
    if not instances:
        return {"checked": instance_id, "state": "not-found"}

    instance = instances[0]
    state = instance.get("State", {}).get("Name")
    if state != "running":
        return {"checked": instance_id, "state": state}

    hours = _hours_running(instance)
    if hours >= threshold:
        sns.publish(
            TopicArn=topic_arn,
            Subject="Homebase workstation running long",
            Message=json.dumps(
                {
                    "instance_id": instance_id,
                    "hours_running": round(hours, 1),
                    "threshold_hours": threshold,
                    "action": "consider stopping the workstation to cap cost/exposure",
                }
            ),
        )
        return {"checked": instance_id, "state": state, "hours": round(hours, 1), "alerted": True}

    return {"checked": instance_id, "state": state, "hours": round(hours, 1), "alerted": False}
