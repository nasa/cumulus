"""lambda function used to translate CMA messages to CNM messages in aws lambda with cumulus"""

from datetime import datetime, timezone
from typing import Any, List, cast
import uuid

import pydantic
from cma2cnm import models_cnm
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

# Create Cumulus Logger instance
LOGGER = CumulusLogger("cma_to_cnm")


def task(event: dict[str, list[str] | dict], context: object) -> dict[str, Any]:
    """Entry point of the lambda
    Args:
        event: Passed through from {handler}
        context: An object required by AWS Lambda. Unused.

    Returns:
        A dict representing input and copied files. See schemas/output.json for more information.

    """
    LOGGER.debug(event)
    input = event["input"]
    config = event["config"]

    # Config Content
    meta_provider = config.get("provider", [])
    meta_collection = config.get("collection")
    meta_cumulus = config.get("cumulus_meta", {})

    LOGGER.debug("provider: {}", meta_provider)

    # Building the URI from info provided by provider since the granule itself might not have it
    uri = f"{meta_provider['protocol']}://{meta_provider['host']}/"

    # if has granules, read first item and find collection
    if "granules" not in input.keys():
        raise Exception('"granules" is missing from input')

    LOGGER.debug(
        "collection: {} | granules found: {}",
        meta_collection.get("name"),
        len(input["granules"]),
    )

    cnm_json_dicts: List[dict] = []  # this is the final array of cnm messages to return
    try:
        for granule in input["granules"]:
            LOGGER.debug("granuleId: {}", granule["granuleId"])
            cnm_provider = meta_provider.get("id", "")
            cnm_dataset = granule["dataType"]
            cnm_data_version = granule["version"]
            cnm_files: list[models_cnm.File] = []

            for file in granule["files"]:
                cnm_file: models_cnm.File = models_cnm.File(
                    name=file.get("name", ""),
                    type=file.get("type", "") or "",
                    uri=uri
                    + (file.get("path", "")).lstrip("/")
                    + "/"
                    + file.get("name", "")
                    or "",
                    size=file.get("size", 0) or 0,
                )
                cnm_files.append(cnm_file)
            cnm_product = models_cnm.Product(
                name=granule["granuleId"],
                dataVersion=cnm_data_version,
                files=cnm_files,
                producerGranuleId="",
                dataProcessingType=None,
                filegroups=None,
            )
            now_aware = cast(pydantic.AwareDatetime, datetime.now(timezone.utc))
            msg = models_cnm.CloudNotificationMessageCnm121(
                version=models_cnm.Version.field_1_6_0,
                provider=cnm_provider,
                receivedTime=now_aware,
                processCompleteTime=now_aware,
                submissionTime=now_aware,
                identifier=str(uuid.uuid4()),
                collection=cnm_dataset,
                response=None,
                product=cnm_product,
                trace=f"source: {meta_cumulus.get('state_machine', '')} | "
                f"execution_name: {meta_cumulus.get('execution_name', '')}",
            )

            cnm_message = models_cnm.CloudNotificationMessageCnm12(root=msg)
            cnm_json_dicts.append(
                cnm_message.model_dump(
                    serialize_as_any=True, by_alias=True, mode="json"
                )
            )
    except pydantic.ValidationError as pydan_error:
        LOGGER.error("pydantic schema validation failed:", pydan_error)
        raise pydan_error

    return_data = {"cnm_list": cnm_json_dicts}

    return return_data


# handler that is provided to aws lambda
def handler(event: dict[str, list[str] | dict], context: object) -> Any:
    """Lambda handler. Runs a cumulus task that

    Args:
        event: Event passed into the step from the aws workflow.
        context: An object required by AWS Lambda. Unused.

    Returns:
        The result of the cumulus task. See schemas/output.json for more information.

    """
    return run_cumulus_task(task, event, context)
