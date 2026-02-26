import uuid

import boto3
import moto
import pytest


@pytest.fixture
def mock_sns():
    with moto.mock_aws():
        yield boto3.client("sns")


@pytest.fixture
def mock_sqs():
    with moto.mock_aws():
        yield boto3.client("sqs")


@pytest.fixture
def setup_sns_test(mock_sns, mock_sqs):
    sns_topic = mock_sns.create_topic(Name=uuid.uuid4().hex)
    topic_arn = sns_topic["TopicArn"]

    sqs_queue = mock_sqs.create_queue(QueueName=uuid.uuid4().hex)
    queue_url = sqs_queue["QueueUrl"]

    attrs = mock_sqs.get_queue_attributes(
        QueueUrl=queue_url, AttributeNames=["QueueArn"]
    )
    queue_arn = attrs["Attributes"]["QueueArn"]

    mock_sns.subscribe(
        TopicArn=topic_arn,
        Protocol="sqs",
        Endpoint=queue_arn,
    )
    return sns_topic, sqs_queue
