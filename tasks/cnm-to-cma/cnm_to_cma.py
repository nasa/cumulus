"""lambda function used to translate CNM messages to CMA messages in aws lambda with cumulus"""

from typing import Any, Dict, List, Union
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task
from cnm2cma import models_cnm
from cnm2cma import models_cma_file
import pydantic
import re
from datetime import datetime, timezone

# Create Cumulus Logger instance
LOGGER = CumulusLogger("cnm_to_cma")


def task(event: Dict[str, Union[List[str], Dict]], context: object) -> Dict[str, Any]:
    """
    Entry point of the lambda
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
    granule_array = [granule]
    now_as_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    cnm["receivedTime"] = now_as_iso
    output = {"cnm": cnm, "output_granules": {"granules": granule_array}}
    return output


def mapper(cnm: Dict, config: Dict) -> Dict:
    """
    Maps CNM to CMA message

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
        cnm_input_files: List[models_cnm.File] = get_cnm_input_files(product)
        cma_files: List[models_cma_file.ModelItem] = create_cma_files(cnm_input_files)
        # Constructing the return message in normal List, Dict but not Pydantic models
        granule = {
            "granuleId": granule_id,
            "version": config.get("collection", {}).get("version"),
            "dataType": config.get("collection", {}).get("name"),
            "files": [
                item.model_dump() for item in cma_files
            ],  # cma_files to normal List
        }
        return granule
    except pydantic.ValidationError as pydan_error:
        LOGGER.error("pydantic schema validation failed:", pydan_error)
        raise pydan_error


def get_cnm_input_files(product: Any) -> List[models_cnm.File]:
    input_files = product.files
    if input_files is None:
        input_files = []
        filegroups = product.filegroups or []
        for fg in filegroups:
            input_files.extend(fg.files or [])
    return input_files


def create_cma_files(
    input_files: List[models_cnm.File],
) -> List[models_cma_file.ModelItem]:
    cma_files = models_cma_file.Model(root=[])
    for cnm_file in input_files:
        uri = cnm_file.uri.strip()
        if uri.lower().startswith("s3://"):
            cma_file = build_granule_file(cnm_file, "s3")
        elif uri.lower().startswith("https://") or uri.lower().startswith("http://"):
            protocol = "https" if uri.lower().startswith("https://") else "http"
            cma_file = build_granule_file(cnm_file, protocol)
        elif uri.lower().startswith("sftp://"):
            cma_file = build_granule_file(cnm_file, "sftp")
        else:
            cma_file = None
        if cma_file:
            cma_files.root.append(cma_file)
    return cma_files.root


def build_granule_file(cnm_file: Any, protocol: str) -> models_cma_file.ModelItem:
    uri = cnm_file.uri.strip() if cnm_file.uri else ""
    # Set defaults for required fields
    bucket = ""
    key = ""
    source = protocol
    if protocol == "s3":
        bucket_key = uri[5:].split("/", 1)
        bucket = bucket_key[0]
        key = bucket_key[1] if len(bucket_key) > 1 else ""
        source = "s3"
    elif protocol in ("http", "https"):
        source = "https" if uri.lower().startswith("https://") else "http"
    elif protocol == "sftp":
        source = "sftp"

    cma_file = models_cma_file.ModelItem(
        size=cnm_file.size,
        type=cnm_file.type,
        fileName=cnm_file.name,
        checksum=getattr(cnm_file, "checksum", None),
        checksumType=getattr(cnm_file, "checksumType", None),
        source=source,
        bucket=bucket,
        key=key,
    )
    return cma_file


def build_granule_file_NotWorking(
    cnm_file: Any, protocol: str
) -> models_cma_file.ModelItem:
    uri = cnm_file.uri.strip() if cnm_file.uri else ""
    cma_file = models_cma_file.ModelItem()
    cma_file.name = cnm_file.name
    cma_file.size = cnm_file.size
    cma_file.type = cnm_file.type
    cma_file.fileName = cnm_file.name
    if cnm_file.checksum:
        cma_file.checksum = cnm_file.checksum
    if cnm_file.checksumType:
        cma_file.checksumType = cnm_file.checksumType

    if protocol == "s3":
        bucket_key = uri[5:].split("/", 1)
        cma_file.source = "s3"
        cma_file.bucket = bucket_key[0]
        cma_file.key = bucket_key[1] if len(bucket_key) > 1 else ""
    elif protocol in ("http", "https"):
        cma_file.source = "https" if uri.lower().startswith("https://") else "http"
        # Add more protocol-specific logic if needed
    elif protocol == "sftp":
        cma_file.source = "sftp"
        # Add more protocol-specific logic if needed

    return cma_file


# handler that is provided to aws lambda
def handler(event: Dict[str, Union[List[str], Dict]], context: object) -> Any:
    """Lambda handler. Runs a cumulus task that

    Args:
        event: Event passed into the step from the aws workflow.
        context: An object required by AWS Lambda. Unused.

    Returns:
        The result of the cumulus task. See schemas/output.json for more information.
    """
    return run_cumulus_task(task, event, context)
