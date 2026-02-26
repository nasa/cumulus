"""lambda function used to translate CMA message to CNM messages with cumulus"""

from datetime import datetime, timezone
from typing import Any, List, cast
import uuid

import pydantic
from . import models_cnm, models_cma
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

# Create Cumulus Logger instance
LOGGER = CumulusLogger("cma_to_cnm")


def task(event: dict[str, Any], context: object) -> dict[str, Any]:
    """Entry point of the lambda
    Args:
        event: Passed through from {handler}
        context: An object required by AWS Lambda. Unused.

    Returns:
        A dict representing input and copied files. See schemas/output.json for more information.

    """
    input = event["input"]
    config = event["config"]

    # Config Content
    meta_identifier = config["identifier"]
    LOGGER.debug("meta_identifier: {}", meta_identifier)
    meta_provider = config.get("provider")
    meta_collection = config.get("collection")
    meta_cumulus = config.get("cumulus_meta", {})
    LOGGER.debug(
        "collection: {} | granules found: {}",
        meta_collection.get("name"),
        len(input["granules"]),
    )

    LOGGER.debug("provider: {}", meta_provider)
    # Building the URI from info provided by provider since the granule itself might not have it
    uri = f"{meta_provider['protocol']}://{meta_provider['host']}/"
    try:
        # json dict to granule pydantic model
        granule_model = models_cma.DiscoverGranulesOutput.model_validate(input)
        granules: List[models_cma.Granule] = granule_model.granules
        cnm_json_dicts: List[dict] = []
        for granule in granules:
            LOGGER.debug("granuleId: {}", granule.granuleId)
            cnm_provider = meta_provider.get("id", "")
            cnm_dataset = granule.dataType
            cnm_data_version = granule.version
            cnm_files: list[models_cnm.File] = []

            granule_file: models_cma.File
            for granule_file in granule.files:
                LOGGER.debug(
                    f"file name: {granule_file.name} | file path: {granule_file.path} "
                    f"| file size: {granule_file.size}"
                )
                cnm_file: models_cnm.File = models_cnm.File(
                    name=granule_file.name,
                    type=granule_file.type or "",
                    uri=uri
                    + (granule_file.path or "").lstrip("/")
                    + "/"
                    + granule_file.name
                    if granule_file.path is not None
                    else uri + granule_file.name,
                    size=(
                        granule_file.size
                        if granule_file.size not in (None, 0, False)
                        else (_ for _ in ()).throw(ValueError(f"granule file {granule_file.name} size illegal value: {granule_file.size}"))
                    )
                )
                cnm_files.append(cnm_file)
            cnm_product = models_cnm.Product(
                name=granule.granuleId,
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
                identifier=meta_identifier if meta_identifier is not None else str(uuid.uuid4()),
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
