"""get_cnm Lambda function.

This file provides the Lambda handler for the get_cnm task.
"""

import logging
import os
from pathlib import Path
from typing import Any

from cumulus_logger import CumulusLogger
from get_cnm.get_cnm import lambda_adapter
from run_cumulus_task import run_cumulus_task

LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))
SCHEMAS = {
    "input": str(
        Path(__file__).resolve().parent / "get_cnm" / "schemas" / "input_schema.json"
    ),
    "output": str(
        Path(__file__).resolve().parent / "get_cnm" / "schemas" / "output_schema.json"
    ),
}


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
    cumulus_task_return = run_cumulus_task(lambda_adapter, event, context, SCHEMAS)
    return cumulus_task_return
