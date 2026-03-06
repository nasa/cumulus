"""lambda function used to translate CNM messages to CMA messages in aws lambda with cumulus"""

import re
import urllib.parse
from datetime import UTC, datetime
from typing import Any

from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

# Create Cumulus Logger instance
LOGGER = CumulusLogger("cnm_to_cma")


def task(event: dict[str, Any], context: object) -> dict[str, Any]:
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

    now_as_iso = datetime.now(UTC).isoformat(timespec="milliseconds") + "Z"
    cnm["receivedTime"] = now_as_iso

    return {
        "cnm": cnm,
        "granules": [granule],
    }


def mapper(cnm: dict, config: dict) -> dict:
    """Maps CNM to CMA message

    Args:
        cnm: The CNM message in Dict format.
        config: The configuration in Dict format. Come from workflow configuration.

    Returns:
        The corresponding granule object.

    """

    granule_id_extraction = config.get("collection", {}).get("granuleIdExtraction")
    # retrieve granule_id from product.names
    product = cnm["product"]
    granule_id = product["name"]

    LOGGER.info(f"Raw granule_id: {granule_id}")
    # Extract the last token after the last slash
    granule_id = granule_id.rsplit("/", 1)[-1]

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
    cnm_input_files = get_cnm_input_files(product)
    cma_files = create_granule_files(cnm_input_files)
    granule = {
        "granuleId": granule_id,
        "producerGranuleId": product.get("producerGranuleId"),
        "files": cma_files,
        "dataType": config.get("collection", {}).get("name"),
        "version": config.get("collection", {}).get("version"),
    }
    LOGGER.info(f"Granule Model in mapper: {granule}")
    return granule


def get_cnm_input_files(product: dict) -> list[dict]:
    input_files = product.get("files")

    if input_files is not None:
        return input_files

    return [
        file
        for file_group in product.get("filegroups") or []
        for file in file_group.get("files") or []
    ]


def create_granule_files(
    input_files: list[dict],
) -> list[dict]:
    granule_files = []
    for cnm_file in input_files:
        uri = cnm_file.get("uri")
        if not uri or not uri.strip():
            raise ValueError("File uri is empty or None")

        granule_file = build_granule_file(cnm_file)
        if granule_file:
            granule_files.append(granule_file)

    return granule_files


def build_granule_file(cnm_file: dict) -> dict:
    """Builds a granule file from a CNM file based on the protocol.

    Args:
        cnm_file: cnm file object
        protocol: s3, http, https, sftp

    Returns:
        a single file object

    """
    uri = cnm_file["uri"].strip()
    parsed_uri = urllib.parse.urlparse(uri)

    if parsed_uri.scheme not in ["http", "https", "sftp", "s3"]:
        raise ValueError(f"Unsupported protocol: {parsed_uri.scheme}")

    host = parsed_uri.netloc
    path = parsed_uri.path[1:].rsplit("/", 1)[0]

    return {
        "name": cnm_file["name"],
        "filename": cnm_file["name"],
        "type": cnm_file["type"],
        "source_bucket": host if parsed_uri.scheme == "s3" else None,
        "path": path,
    }


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
