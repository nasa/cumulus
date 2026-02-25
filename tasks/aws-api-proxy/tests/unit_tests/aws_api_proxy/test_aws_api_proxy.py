"""Tests for aws api proxy module."""

import asyncio
import json
import time

import pytest
from aws_api_proxy.aws_api_proxy import lambda_adapter, run_with_limit


def test_lambda_adapter_list_publish(setup_sns_test, mock_sqs) -> None:
    """Verify that lambda_adapter calls the AWS API with a list as expected."""
    sns_topic, sqs_queue = setup_sns_test

    messages = [
        {"m": "first message"},
        {"m": "second message"},
    ]

    event = {
        "config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": sns_topic["TopicArn"],
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
    lambda_adapter_response = lambda_adapter(event, None)
    responses = lambda_adapter_response.get("result_list")
    assert len(responses) == len(messages)
    assert all("MessageId" in response for response in responses)

    receive_message_response = mock_sqs.receive_message(
        QueueUrl=sqs_queue["QueueUrl"], MaxNumberOfMessages=len(messages)
    )

    # The JSON we want is encoded within an encoded portion of the response
    decoded_sqs_responses = [
        json.loads(m["Body"]) for m in receive_message_response.get("Messages")
    ]
    decoded_sqs_messages = [json.loads(m["Message"]) for m in decoded_sqs_responses]

    assert decoded_sqs_messages == messages


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
    with pytest.raises(
        ValueError,
        match="iterate_by field 'nonexistent_field' must be a list in parameters\\.",
    ):
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


def test_run_with_limit_partial_failure() -> None:
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
