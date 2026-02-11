#!/usr/bin/env python
"""AWS API proxy task for Cumulus.

This module provides a CMA-wrapped way to call a specified boto3 client within AWS
lambda. This may be called once or multiple times against a provided list. Guardrails
are provided via configuration validation which specifies a predefined set of allowed
services and actions in addition to a dedicated IAM role for this lambda.
"""

from typing import Any

import boto3

from . import LOGGER

EVENT_TYPING = dict[Any, Any]


def lambda_adapter(event: EVENT_TYPING, _: Any) -> dict[str, Any]:
    """Handle AWS API Proxy requests."""
    LOGGER.info(f"Received event: {event}")
    config = event.get("config", {})
    service = config.get("service")
    action = config.get("action")
    parameters = config.get("parameters", {})
    parameters_list = config.get("parameters_list")
    LOGGER.info(
        f"Received request to call AWS service {service} "
        f"with action {action} and parameters {parameters}"
    )
    client = boto3.client(service)
    method = getattr(client, action)
    if parameters_list:
        responses = [method(**params) for params in parameters_list]
        LOGGER.info(
            f"Received response from AWS service {service} "
            f"with action {action}: {responses}"
        )
        return {"responses": responses}

    response = method(**parameters)
    LOGGER.info(
        f"Received response from AWS service {service} with action {action}: {response}"
    )
    return response


if __name__ == "__main__":
    lambda_adapter(
        {
            "config": {
                "service": "sns",
                "action": "publish",
                "parameters": {
                    "TopicArn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
                    "Message": "Test message",
                },
            }
        },
        None,
    )
