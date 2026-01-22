"""CNM SQS Logger."""

import logging
import os

import boto3
from mandible.log import (
    init_custom_log_record_factory,
    init_root_logger,
    log_errors,
)

log = logging.getLogger(__name__)


def send_message_workflow_sqs(sqs_messages):
    """Send SQS messages to SQS queue.

    Args:
        sqs_messages (list): SQS messages to send

    """
    sqs_client = boto3.client("sqs")
    workflow_sqs_url = os.getenv("WORKFLOW_SQS")
    for sqs_message in sqs_messages:
        response = sqs_client.send_message(
            QueueUrl=workflow_sqs_url,
            MessageBody=sqs_message["body"],
        )
        log.info(response)


def lambda_handler(event: dict, _context):
    """Lambda handler.

    Args:
        event (dict): Lambda event
        _context (Context): Lambda context

    """
    init_root_logger()
    init_custom_log_record_factory(event)
    with log_errors():
        messages = event["Records"]
        log.debug(f"Received the following SQS message:\n{messages}")

        for message in messages:
            log.info(f"Received the following CNM message:\n{message['body']}")

        send_message_workflow_sqs(messages)
