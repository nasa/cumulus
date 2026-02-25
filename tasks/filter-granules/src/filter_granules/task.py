"""Filter Granule task for Cumulus.

This task filters out completed granules
and returns their completed execution ARNs.
"""

import logging

from cumulus_api import CumulusApi
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

logger = CumulusLogger("filter-granules", logging.INFO)

EXECUTION_SEARCH_LIMIT = 10


def _get_granule_execution_arn(api_granule: dict, workflow_name: str) -> str | None:
    """Retrieve the execution ARN for a specific granule's ingest workflow.

    :param api_granule: Granule object from the Cumulus API.
    :param workflow_name: Name of the granule ingest workflow to search for.
    :return: Execution ARN if found, None otherwise.
    """
    search_executions_definition = {
        "granules": [
            {
                "granuleId": api_granule["granuleId"],
                "collectionId": api_granule["collectionId"],
            }
        ]
    }
    cml = CumulusApi()
    response = cml.search_executions_by_granules(
        search_executions_definition,
        limit=EXECUTION_SEARCH_LIMIT,
        sort_by="updated_at",
        order="desc",
    )
    executions = response.get("results", [])
    workflow_execution_arn = next(
        (exc["arn"] for exc in executions if exc["type"] == workflow_name),
        None,
    )
    return workflow_execution_arn


def filter_granules(event: dict, _context: dict) -> dict:
    """Task to filter out completed granules.

    :param event: A lambda event object.
    :param context: An AWS Lambda context.
    :return: Updates the input dict with failed granules and completed execution ARNs.
    """
    parsed_granules = event["input"]["granules"]
    granule_ingest_workflow_name = event["config"]["granuleIngestWorkflow"]
    filtering = event["config"].get("filtering", True)
    cml = CumulusApi()

    if not filtering:
        event["input"]["completed"] = []
        return event["input"]

    completed_arns = []
    filtered_granules = []
    for granule in parsed_granules:
        collection_id = f"{granule['dataType']}___{granule['version']}"
        api_granule = cml.get_granule(
            granule_id=granule["granuleId"], collection_id=collection_id
        )
        status = api_granule.get("status")

        if not status:
            logger.info("No status for granule: {0}", granule["granuleId"])
            filtered_granules.append(granule)
            continue

        if status == "failed":
            logger.info("Failed status for granule: {0}", granule["granuleId"])
            filtered_granules.append(granule)
        elif status == "completed":
            logger.info("Completed status for granule: {0}", granule["granuleId"])
            granule_ingest_execution_arn = _get_granule_execution_arn(
                api_granule, granule_ingest_workflow_name
            )
            if granule_ingest_execution_arn:
                completed_arns.append(granule_ingest_execution_arn)
            else:
                logger.info("No execution found for granule: {0}", granule["granuleId"])
                filtered_granules.append(granule)
        elif status == "running":
            logger.error("Granule Still running: {0}", granule["granuleId"])
            raise Exception("Granule still running: " + granule["granuleId"])
        else:
            logger.error("Unknown Status for granule: {0}", granule["granuleId"])
            raise Exception("Unknown Status for granule: " + granule["granuleId"])

    event["input"]["granules"] = filtered_granules
    event["input"]["completed"] = completed_arns
    return event["input"]


def handler(event: dict, _context: dict) -> dict:
    """Lambda handler that runs the task through CMA.

    :param event: A Cumulus Message.
    :param context: An AWS Lambda context.
    :return: output from task.
    """
    return run_cumulus_task(filter_granules, event, _context)
