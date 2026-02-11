"""Tests for aws api proxy module."""

import json
import uuid

import boto3
import jsonschema
import pytest
from aws_api_proxy.aws_api_proxy import lambda_adapter
from main import lambda_handler
from moto import mock_aws

SNS_CLIENT = boto3.client("sns")
SQS_CLIENT = boto3.client("sqs")


def set_up_sns_tests(count=1) -> None:
    """Set up SNS topics and subscriptions for testing.  Create one or more SNS topics
    and corresponding SQS queues, subscribe the latter to the former and return the
    identifiers for each resource created.
    """
    arn_list = []
    for _ in range(count):
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
        arn_list.append({"TopicArn": topic_arn, "QueueUrl": queue_url})
    return arn_list


@mock_aws
def test_lambda_adapter_single_publish() -> None:
    """Verify that lambda_adapter calls the AWS API as expected."""
    arn_list = set_up_sns_tests()

    message_contents = json.dumps({"a": "b", "c": 1})
    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": arn_list[0]["TopicArn"],
                "Message": message_contents,
            },
        }
    }

    response = lambda_adapter(event, None)

    assert "MessageId" in response

    messages = SQS_CLIENT.receive_message(
        QueueUrl=arn_list[0]["QueueUrl"], MaxNumberOfMessages=1
    )

    body = json.loads(messages["Messages"][0]["Body"])

    assert body["Message"] == message_contents


@mock_aws
def test_lambda_adapter_list_publish() -> None:
    """Verify that lambda_adapter calls the AWS API with a list as expected."""
    arn_list = set_up_sns_tests(count=2)
    topic_arns = [arn["TopicArn"] for arn in arn_list]
    queue_urls = [arn["QueueUrl"] for arn in arn_list]
    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters_list": [
                {
                    "TopicArn": topic_arn,
                    "Message": json.dumps({"topic": topic_arn}),
                }
                for topic_arn in topic_arns
            ],
        }
    }
    responses = lambda_adapter(event, None)

    assert all("MessageId" in response for response in responses["responses"])

    for queue_url in queue_urls:
        messages = SQS_CLIENT.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)

        body = json.loads(messages["Messages"][0]["Body"])

        assert body["Message"] in [
            json.dumps({"topic": topic_arn}) for topic_arn in topic_arns
        ]


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
