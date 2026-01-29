"""lambda function used to translate CNM messages to CMA messages in aws lambda with cumulus"""

from typing import Any, Dict, List, Union, Optional
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task
from cnm2cma import models_cnm
from cnm2cma import models_granule
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
    output: models_granule.SyncGranuleInput = models_granule.SyncGranuleInput(granules=[granule])
    now_as_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    cnm["receivedTime"] = now_as_iso
    output_dict = {"cnm": cnm, "output_granules": output.model_dump()}
    return output_dict


def mapper(cnm: Dict, config: Dict) -> models_granule.Granule:
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
        cma_files:List[models_cnm.File] = create_granule_files(cnm_input_files)
        granule = models_granule.Granule(granuleId =granule_id,
                                         producerGranuleId=cnm_model.root.product.producerGranuleId,
                                         files=cma_files,
                                         dataType=config.get("collection", {}).get("name"),
                                         version=config.get("collection", {}).get("version"))
        LOGGER.info(f"Granule Model in mapper: {granule}")
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

def create_granule_files(
    input_files: List[models_cnm.File],
) -> List[models_granule.File]:
    granule_files: List[models_granule.File] = []
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
            LOGGER.error(f'Got problem here while granule file is NONE. '
                         ' Probably due to unsupported protocol in uri: {uri}')
        if granule_file:
            granule_files.append(granule_file)
    return granule_files


def build_granule_file(cnm_file: Any, protocol: str) -> models_granule.File:
    """
    Builds a granule file from a CNM file based on the protocol.
    Args:
        cnm_file: cnm file object
        protocol: s3, http, https, sftp

    Returns:
        a single  models_granule.File object
    """
    uri = cnm_file.uri.strip() if cnm_file.uri else ""
    # Set defaults
    source_bucket = None  # only used when protocol is s3
    key = None
    path = None
    if protocol == "s3":
        bucket_key = uri[5:].split("/", 1)
        source_bucket = bucket_key[0]
        key = bucket_key[1] if len(bucket_key) > 1 else ""
    elif protocol in ("http", "https", "sftp"):
        path = uri.replace("sftp://", "").replace("https://", "").replace("http://", "")
        path = path[path.index("/") + 1 : path.rindex("/")]
    else:
        LOGGER.error("Unsupported protocol:", protocol)

    granule_file = models_granule.File(
        name=cnm_file.name,
        filename=cnm_file.name,
        type=cnm_file.type,
        source_bucket=source_bucket,
        path=key if source_bucket else path,
    )
    return granule_file


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
