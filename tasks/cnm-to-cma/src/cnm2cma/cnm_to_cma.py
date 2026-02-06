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
    now_as_iso = datetime.now(UTC).isoformat(timespec="milliseconds") + "Z"
    cnm["receivedTime"] = now_as_iso
    output_dict = {"cnm": cnm, "output_granules": output.model_dump(mode="json")}
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
        granule_id_extraction = config.get("collection", {}).get("granuleIdExtraction")
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
            else:
                LOGGER.warn(
                    f"granuleIdExtraction regex: {granule_id_extraction} did not match the "
                    f"granuleId: {granule_id} but program will continue"
                )
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
        if not cnm_file.uri or len(cnm_file.uri.strip()) == 0:
            raise ValueError("File uri is empty or None")
        granule_file: models_granule.File = build_granule_file(cnm_file)
        if granule_file:
            granule_files.append(granule_file)
    return granule_files


def build_granule_file(cnm_file: Any) -> models_granule.File:
    """Builds a granule file from a CNM file based on the protocol.

    Args:
        cnm_file: cnm file object
        protocol: s3, http, https, sftp

    Returns:
        a single  models_granule.File object

    """
    uri = cnm_file.uri
    match = re.match(
        r"^(?P<protocol>.*?)://(?P<host>[^/]+)(?:/(?P<full_path>.*))?$", uri
    )
    if not match:
        LOGGER.error(f"Invalid URI format: {uri}")
        raise ValueError(f"Invalid URI format: {uri}")
    groups = match.groupdict()
    protocol = groups["protocol"]
    if protocol not in ["http", "https", "sftp", "s3"]:
        raise ValueError(f"Unsupported protocol: {protocol}")
    host = groups["host"]
    full_path = groups["full_path"] or ""
    path = full_path.rsplit("/", 1)[0] if full_path else ""
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
