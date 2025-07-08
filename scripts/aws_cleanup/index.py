import json

import os

import logging

import boto3

from datetime import datetime
from typing import TypedDict, List

# Initialize the S3 client outside of the handler
s3_client = boto3.client("s3")

# Initialize the logger
logger = logging.getLogger()
logger.setLevel("INFO")


class HandlerReturn(TypedDict):
    statusCode: int
    message: str


class TagObject(TypedDict):
    Key: str
    Value: str


class InstanceObject(TypedDict):
    Tags: List[TagObject]


def rotation_time(rotate_by: str) -> bool:
    rotate_date = datetime.strptime(rotate_by, "%Y-%m-%d %H:%M:%S")
    if rotate_date < datetime.today():
        return True
    return False


def should_be_cleaned_up(instance_object: dict) -> bool:
    timeout_key = os.getenv("timeout_key", "Rotate By")

    for tag in instance_object["Tags"]:

        if tag["Key"] == timeout_key:
            return rotation_time(tag["Value"])
    logger.warning("never found timeout key for", instance_object["InstanceId"])
    return False


def handler(_, __) -> HandlerReturn:
    """
    Main Lambda handler function
    Returns:
        Dict containing status message
    """
    try:
        client = boto3.client("ec2")
        response = client.describe_instances()
        instances = [
            instance
            for reservation in response["Reservations"]
            for instance in reservation["Instances"]
        ]
        to_clean = [
            instance["InstanceId"]
            for instance in instances
            if should_be_cleaned_up(instance)
        ]
        print(f'attempting to clean up: {to_clean}')
        termination = client.terminate_instances(
            InstanceIds=to_clean,
            DryRun=True,
        )
        return {
            "statusCode": 200,
            "message": f"termination completed with response {json.stringify(termination)}",
        }

    except Exception as e:
        logger.error(f"Error processing order: {str(e)}")
        raise


if __name__ == "__main__":
    handler({}, {})
