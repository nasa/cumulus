"""Task for adding granules cleanup input."""

import json
import logging

from cumulus_api import CumulusApi
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

logger = CumulusLogger("add-input-granules", logging.INFO)


def _get_granules_from_exc(executions: list) -> list:
    """Get a list of granules from ingest executions using Cumulus API.

    :param executions: List of execution ARNs or execution objects.
    """
    cml = CumulusApi()
    arns = [exc["arn"] if isinstance(exc, dict) else exc for exc in executions]
    response = cml.list_executions(
        arn__in=",".join(arns), fields="finalPayload", limit=None
    )
    results = response.get("results", [])

    input_granules = []
    for execution in results:
        granules = execution["finalPayload"].get("granules", [])
        for granule in granules:
            input_granules.append(granule)
    logger.info("INPUT GRANULES \n" + json.dumps(input_granules))
    return input_granules


def add_input_granules(event: dict, _context: dict) -> dict:
    """Add list of input granules to task output.

    :param event: Lambda event object.
    :param _context: Lambda context object, unused.
    """
    logger.info("## EVENT OBJ \n" + json.dumps(event))

    # Executions in running state might not have started yet
    if len(event["input"]["running"]) > 0:
        raise Exception("Executions still running")
    if len(event["input"]["failed"]) > 0:
        raise Exception("Some executions failed")

    event["input"]["granules"] = _get_granules_from_exc(event["input"]["completed"])
    return event["input"]


def handler(event: dict, _context: dict) -> dict:
    """Lambda handler for the task using CMA.

    :param event: Lambda event object in Cumulus message format.
    :param _context: Lambda context object.
    """
    return run_cumulus_task(add_input_granules, event, _context)
