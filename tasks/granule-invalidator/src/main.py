"""Granule invalidator Lambda function.

This file provides the Lambda handler for invalidating granules in the Cumulus workflow.
"""
import logging
import os
from typing import Any

from cumulus_logger import CumulusLogger
from granule_invalidator import lambda_adapter, schemas
from run_cumulus_task import run_cumulus_task

EVENT_TYPING = dict[Any, Any]
LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))

def lambda_handler(event: EVENT_TYPING, context: Any) -> Any:
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
    cumulus_task_return = run_cumulus_task(lambda_adapter, event, context, schemas)
    return cumulus_task_return