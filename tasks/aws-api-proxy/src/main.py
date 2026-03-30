"""aws-api-proxy Lambda function.

This file provides the Lambda handler for the AWS API proxy task.
"""

import logging
import os
from typing import Any

from aws_api_proxy.aws_api_proxy import lambda_adapter
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))


def lambda_handler(event: dict, context: Any) -> Any:
    """Lambda handler.

    AWS Lambda invokes this function when the Lambda is triggered.
    Runs the task through the Cumulus Message Adapter (CMA).

    Args:
        event: Lambda event input
        context: Lambda context object

    Returns:
        Output from the task wrapped by CMA

    """
    LOGGER.setMetadata(event, context)
    cumulus_task_return = run_cumulus_task(lambda_adapter, event, context)
    return cumulus_task_return
