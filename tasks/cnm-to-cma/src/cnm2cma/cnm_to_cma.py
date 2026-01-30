"""lambda function used to translate CNM messages to CMA messages in aws lambda with cumulus"""

import re
from datetime import UTC, datetime
from typing import Any

import pydantic
from cnm2cma import models_cnm, models_granule
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

# Create Cumulus Logger instance
LOGGER = CumulusLogger("cnm_to_cma")


def task(event: dict[str, list[str] | dict], context: object) -> dict[str, Any]:
    """Entry point of the lambda
    Args:
        event: Passed through from {handler}
        context: An object required by AWS Lambda. Unused.

    Returns:
        A dict representing input and copied files. See schemas/output.json for more information.

    """
    LOGGER.debug(event)
    cnm = event["input"]
    config = event["config"]

    LOGGER.info(f"cnm message: {cnm} config: {config}")
    granule = mapper(cnm, config)
    output: models_granule.SyncGranuleInput = models_granule.SyncGranuleInput(
        granules=[granule]
    )
    now_as_iso = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    cnm["receivedTime"] = now_as_iso
    output_dict = {"cnm": cnm, "output_granules": output.model_dump()}
    return output_dict


def mapper(cnm: dict, config: dict) -> models_granule.Granule:
    """Maps CNM to CMA message

    Args:
        cnm: The CNM message in Dict format.
        config: The configuration in Dict format. Come from workflow configuration.

    Returns:
        The corresponding granule type.

    """
    try:
        cnm_model = models_cnm.CloudNotificationMessageCnm12.model_validate(cnm)
        LOGGER.info(f"CNM Model in mapper: {cnm_model}")
        granule_id = cnm_model.root.product.name
        granule_id_extraction = config.get("collection").get("granuleIdExtraction")
        # retrieve granule_id from product.names
        product = cnm_model.root.product
        granule_id = product.name
        LOGGER.info(f"Raw granule_id: {granule_id}")
        # Extract the last token after the last slash
        granule_id = product.name.rsplit("/", 1)[-1]
        # Apply regex extraction if provided
        if granule_id_extraction:
            matcher = re.search(granule_id_extraction, granule_id)
            if matcher:
                granule_id = matcher.group(1)
        LOGGER.info(f"Granule ID: {granule_id}")
        cnm_input_files: list[models_cnm.File] = get_cnm_input_files(product)
        cma_files: list[models_cnm.File] = create_granule_files(cnm_input_files)
        granule = models_granule.Granule(
            granuleId=granule_id,
            producerGranuleId=cnm_model.root.product.producerGranuleId,
            files=cma_files,
            dataType=config.get("collection", {}).get("name"),
            version=config.get("collection", {}).get("version"),
        )
        LOGGER.info(f"Granule Model in mapper: {granule}")
        return granule
    except pydantic.ValidationError as pydan_error:
        LOGGER.error("pydantic schema validation failed:", pydan_error)
        raise pydan_error


def get_cnm_input_files(product: Any) -> list[models_cnm.File]:
    input_files = product.files
    if input_files is None:
        input_files = []
        filegroups = product.filegroups or []
        for fg in filegroups:
            input_files.extend(fg.files or [])
    return input_files


def create_granule_files(
    input_files: list[models_cnm.File],
) -> list[models_granule.File]:
    granule_files: list[models_granule.File] = []
    for cnm_file in input_files:
        uri = cnm_file.uri.strip()
        granule_file: models_granule.File = None
        if uri.lower().startswith("s3://"):
            granule_file = build_granule_file(cnm_file, "s3")
        elif uri.lower().startswith("https://") or uri.lower().startswith("http://"):
            protocol = "https" if uri.lower().startswith("https://") else "http"
            granule_file = build_granule_file(cnm_file, protocol)
        elif uri.lower().startswith("sftp://"):
            granule_file = build_granule_file(cnm_file, "sftp")
        else:
            LOGGER.error(
                "Got problem here while granule file is NONE. "
                " Probably due to unsupported protocol in uri: {uri}"
            )
        if granule_file:
            granule_files.append(granule_file)
    return granule_files


def build_granule_file(cnm_file: Any, protocol: str) -> models_granule.File:
    """Builds a granule file from a CNM file based on the protocol.

    Args:
        cnm_file: cnm file object
        protocol: s3, http, https, sftp

    Returns:
        a single  models_granule.File object

    """
    uri = cnm_file.uri.strip() if cnm_file.uri else ""
    uri_protocol_stripped = (
        uri.replace("s3://", "")
        .replace("sftp://", "")
        .replace("https://", "")
        .replace("http://", "")
    )
    tokens = uri_protocol_stripped.split("/", 1)
    # the host represents the bucket name for s3 protocol or hosturl for http/sftp protocols
    host = tokens[0]
    path = tokens[1].rsplit("/", 1)[0] if len(tokens) > 1 and "/" in tokens[1] else ""
    granule_file = models_granule.File(
        name=cnm_file.name,
        filename=cnm_file.name,
        type=cnm_file.type,
        source_bucket=host if protocol == "s3" else None,
        path=path,
    )
    return granule_file


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
