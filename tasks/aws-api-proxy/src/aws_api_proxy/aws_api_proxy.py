#!/usr/bin/env python
"""AWS API proxy task for Cumulus.

This module provides a CMA-wrapped way to call a specified boto3 client within AWS
lambda. This may be called once or multiple times against a provided list. Guardrails
are provided via configuration validation which specifies a predefined set of allowed
services and actions in addition to a dedicated IAM role for this lambda.
"""

import asyncio
import json
from typing import Any

import boto3

from . import LOGGER

EVENT_TYPING = dict[Any, Any]
PARAMETER_FILTERS = {
    "json.dumps": json.dumps,
}


async def run_with_limit(method, parameters_list, max_concurrency=5):
    """Run the given method with the provided parameters, limiting concurrency."""
    semaphore = asyncio.Semaphore(max_concurrency)

    async def worker(parameters):
        async with semaphore:
            # Since boto3 is not async, run it in a thread
            return await asyncio.to_thread(method, **parameters)

    results = await asyncio.gather(
        *(worker(parameters) for parameters in parameters_list), return_exceptions=True
    )
    return results


def lambda_adapter(event: EVENT_TYPING, _: Any) -> dict[str, Any]:
    """Handle AWS API Proxy requests."""
    config = event.get("config", {})
    service = config.get("service")
    action = config.get("action")
    parameters = config.get("parameters")
    iterate_by = config.get("iterate_by")
    parameter_filters = config.get("parameter_filters", [])
    if iterate_by:
        iterate_by_parameters = parameters.get(iterate_by)
        if not isinstance(iterate_by_parameters, list):
            raise ValueError(
                f"iterate_by field '{iterate_by}' must be a list in parameters."
            )
        parameters_list = [
            {**parameters, iterate_by: value} for value in parameters[iterate_by]
        ]
    else:
        parameters_list = [parameters]

    for parameter_filter in parameter_filters:
        parameter_filter_name = parameter_filter.get("name")
        parameter_filter_field = parameter_filter.get("field")
        parameter_filter_func = PARAMETER_FILTERS.get(parameter_filter_name)
        if not parameter_filter_func:
            raise ValueError(
                f"Unsupported parameter filter: {parameter_filter_name} "
                f"acting on field {parameter_filter_field}"
            )
        parameters_list = [
            {
                k: parameter_filter_func(v) if k == parameter_filter_field else v
                for k, v in parameters.items()
            }
            for parameters in parameters_list
        ]

    LOGGER.info(
        f"Received request to call AWS service {service} "
        f"with action {action} and parameters {parameters_list}"
    )
    client = boto3.client(service)
    method = getattr(client, action)

    responses = asyncio.run(run_with_limit(method, parameters_list))
    LOGGER.info(
        f"Received response from AWS service {service} "
        f"with action {action}: {responses}"
    )

    return responses


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
