"""Tests for aws api proxy module."""

import asyncio
import json
import time
import uuid

import boto3
import jsonschema
import pytest
from aws_api_proxy.aws_api_proxy import lambda_adapter, run_with_limit
from main import lambda_handler
from moto import mock_aws

SNS_CLIENT = boto3.client("sns")
SQS_CLIENT = boto3.client("sqs")


@mock_aws
def test_lambda_adapter_list_publish() -> None:
    """Verify that lambda_adapter calls the AWS API with a list as expected."""
    topic = SNS_CLIENT.create_topic(Name=uuid.uuid4().hex)
    topic_arn = topic["TopicArn"]

    queue = SQS_CLIENT.create_queue(QueueName=uuid.uuid4().hex)
    queue_url = queue["QueueUrl"]

    attrs = SQS_CLIENT.get_queue_attributes(
        QueueUrl=queue_url, AttributeNames=["QueueArn"]
    )
    queue_arn = attrs["Attributes"]["QueueArn"]

    SNS_CLIENT.subscribe(
        TopicArn=topic_arn,
        Protocol="sqs",
        Endpoint=queue_arn,
    )

    messages = [
        {"m": "first message"},
        {"m": "second message"},
    ]

    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": topic_arn,
                "Message": messages,
            },
            "iterate_by": "Message",
            "parameter_filters": [
                {
                    "name": "json.dumps",
                    "field": "Message",
                }
            ],
        }
    }
    responses = lambda_adapter(event, None)

    assert len(responses) == len(messages)
    assert all("MessageId" in response for response in responses)

    receive_message_response = SQS_CLIENT.receive_message(
        QueueUrl=queue_url, MaxNumberOfMessages=len(messages)
    )

    # The JSON we want is encoded within an encoded portion of the response
    decoded_sqs_responses = [
        json.loads(m["Body"]) for m in receive_message_response.get("Messages")
    ]
    decoded_sqs_messages = [json.loads(m["Message"]) for m in decoded_sqs_responses]

    assert decoded_sqs_messages == messages


def test_lambda_adapter_no_filter_mapping() -> None:
    """Verify an exception is raised when no filter match is found."""

    messages = [
        {"m": "first message"},
        {"m": "second message"},
    ]

    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
                "Message": messages,
            },
            "iterate_by": "Message",
            "parameter_filters": [
                {
                    "name": "nonexistent_filter",
                    "field": "Message",
                }
            ],
        }
    }
    with pytest.raises(ValueError):
        lambda_adapter(event, None)


def test_lambda_adapter_iterate_by_nonexistent_field() -> None:
    """Verify an exception is raised when the iterate_by field does not exist."""

    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
                "Message": "abc",
            },
            "iterate_by": "nonexistent_field",
        }
    }
    with pytest.raises(ValueError):
        lambda_adapter(event, None)


def test_lambda_adapter_iterate_by_not_list() -> None:
    """Verify an exception is raised when the iterate_by field is not a list."""

    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
                "Message": "abc",
            },
            "iterate_by": "Message",
        }
    }
    with pytest.raises(ValueError):
        lambda_adapter(event, None)


def test_run_with_limit_respects_max_concurrency() -> None:
    """Verify run_with_limit caps concurrent calls and runs calls in parallel."""

    concurrency = 2
    count = 10
    sleep_time = 0.5
    expected_total_time = (count / concurrency) * sleep_time

    # Add this buffer to the expected time to account for any overhead in scheduling
    # tasks and running them in parallel.
    extra_time = 0.1

    def blocking_task():
        time.sleep(sleep_time)

    start_time = time.time()
    results = asyncio.run(
        run_with_limit(blocking_task, [{}] * count, max_concurrency=2)
    )
    total_time = time.time() - start_time

    # We should get a result for each call
    assert len(results) == count

    # If the total time is less, our semaphore/parallelism limit isn't working
    assert total_time >= expected_total_time

    # If the total time is significantly more, we may not be running in parallel
    assert total_time <= expected_total_time + extra_time


def test_partial_failure() -> None:
    """Verify run_with_limit caps concurrent calls and runs calls in parallel."""

    count = 10
    cutoff = count / 2

    def task(num):
        if num >= cutoff:
            raise ValueError("Simulated failure")

    results = asyncio.run(
        run_with_limit(task, [{"num": i} for i in range(count)], max_concurrency=2)
    )
    assert len(results) == count
    assert len([r for r in results if isinstance(r, Exception)]) == count - cutoff
    assert len([r for r in results if r is None]) == count - cutoff


def test_lambda_handler_prohibits_additional_parameters() -> None:
    """Verify that lambda_adapter fails schema validation when unexpected parameters are
    passed.  This is explicitly tested to assure we're setting appropriate security
    guardrails.
    """
    event = {
        "task_config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": "abc",
                "Message": "abc",
                # Subject is not permitted in the schema
                "Subject": "abc",
            },
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)


def test_lambda_handler_prohibits_additional_actions() -> None:
    """Verify that lambda_adapter fails schema validation when unexpected actions are
    passed.  This is explicitly tested to assure we're setting appropriate security
    guardrails.
    """
    event = {
        "task_config": {
            "service": "sns",
            # list_topics is not a permitted action in the schema
            "action": "list_topics",
            "parameters": {},
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)


def test_lambda_handler_prohibits_additional_services() -> None:
    """Verify that lambda_adapter fails schema validation when unexpected services are
    passed.  This is explicitly tested to assure we're setting appropriate security
    guardrails.
    """
    event = {
        "task_config": {
            # Secrets Manager is not a permitted service in the schema
            "service": "secretsmanager",
            "action": "get_secret_value",
            "parameters": {
                "SecretId": "abc",
                "VersionId": "abc",
            },
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)
