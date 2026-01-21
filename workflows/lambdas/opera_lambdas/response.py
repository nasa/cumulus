"""Send a CNM response message."""
import json
import logging
import os
import re
from datetime import datetime

import boto3
import botocore
from mandible.log import (init_custom_log_record_factory, init_root_logger,
                          log_errors)
from run_cumulus_task import run_cumulus_task

log = logging.getLogger(__name__)

CNM_VERSION = "1.6.0"
CNM_TIME_FORMAT = "%Y-%m-%d %H:%M:%SZ"
SQS_REGEX = re.compile(r"https://sqs\.(.*)\.amazonaws\.com")
ERROR_TYPE_MAP = {"ClientError": "TRANSFER_ERROR"}
ENCODER = json.JSONEncoder(indent=2)


def get_sqs_client_and_url(cnm: dict) -> tuple[str, botocore.client.BaseClient]:
    """Get the SQS client and URL from the given CNM dict.

    Args:
        cnm (dict): CNM message from SQS

    """
    try:
        sqs_url_map = json.loads(os.getenv("RESPONSE_SQS_MAP"))
    except (json.JSONDecodeError, TypeError) as e:
        raise Exception("Failed to load SQS URL map") from e

    response_queue_type = cnm.get("trace")
    if response_queue_type:
        sqs_url = sqs_url_map.get(response_queue_type)
    else:
        sqs_url = next(iter(sqs_url_map.values()))

    if not sqs_url:
        log.debug("Unable to send messages to SQS, url not found")
        raise Exception("SQS not set in env")

    match = re.match(SQS_REGEX, sqs_url)
    if not match:
        log.debug("Unable to send messages to SQS, malformed url")
        raise Exception("SQS url malformed in env")

    region = match.group(1)
    return boto3.client("sqs", region_name=region), sqs_url


def _get_uri_from_file(file: dict) -> str | None:
    bucket = file.get("bucket")
    key = file.get("key")

    if not (key and bucket):
        return None

    return f"s3://{bucket}/{key}"


def _generate_message(metadata: dict, files: list, response_info: dict) -> dict:
    log.info("Generating a message from the input: %s", metadata)
    return {
        "version": CNM_VERSION,
        "receivedTime": metadata.get("receivedTime"),
        "processCompleteTime": datetime.utcnow().strftime(CNM_TIME_FORMAT),
        "product": {
            "name": metadata.get("product", {}).get("name"),
            "files": [
                {
                    "type": file.get("type"),
                    "name": file.get("fileName") or file.get("name"),
                    "uri": _get_uri_from_file(file) or file.get("uri"),
                    "checksumType": file.get("checksumType"),
                    "checksum": file.get("checksum"),
                    "size": file.get("size"),
                }
                for file in files
            ],
        },
        "submissionTime": metadata.get("submissionTime"),
        "identifier": metadata.get("identifier"),
        "collection": metadata.get("collection"),
        "response": response_info,
        "provider": metadata.get("provider"),
    }


def _send_message(sqs: boto3.Session, payload: str, sqs_url: str) -> None:
    log.info("sending payload: %s to SQS: %s", payload, sqs_url)
    response = sqs.send_message(
        QueueUrl=sqs_url,
        MessageBody=payload,
    )
    log.info("Sent with the response: %s", response)


def handle_sqs_dlq_record(record: dict):
    """Handle a SQS DLQ record.

    Args:
        record (dict): SQS DLQ record

    """
    cnm = json.loads(record["body"])
    attributes = record["attributes"]
    sqs, sqs_url = get_sqs_client_and_url(cnm)

    if "ApproximateFirstReceiveTimestamp" in attributes:
        received_time = int(attributes["ApproximateFirstReceiveTimestamp"]) / 1000
    else:
        received_time = datetime.utcnow().timestamp()

    response_message = {
        "version": CNM_VERSION,
        "receivedTime": datetime.utcfromtimestamp(received_time).strftime(
            CNM_TIME_FORMAT
        ),
        "processCompleteTime": datetime.utcnow().strftime(CNM_TIME_FORMAT),
        "product": {
            "name": cnm["product"]["name"], "files": cnm["product"]["files"],
        },
        "submissionTime": cnm["submissionTime"],
        "identifier": cnm["identifier"],
        "collection": cnm["collection"],
        "response": {
            "status": "FAILURE",
            "errorCode": "PROCESSING_ERROR",
            "errorMessage": "CNM message unable to trigger ingest",
        },
        "provider": cnm["provider"],
    }

    _send_message(sqs, ENCODER.encode(response_message), sqs_url)


def response_task(event: dict, _context) -> dict:
    """Send a response message to provider.

    Args:
        event (dict): AWS Lambda event
        _context (dict): AWS Lambda context

    """
    payload = event.get("input") or {}
    task_config = event.get("config") or {}

    exception = task_config.get("exception") or "None"
    cnm = task_config.get("cnm")
    received_time = task_config.get("received_time")
    # If CnmToGranules fails, the CNM won't have been moved to the meta section yet
    original_cnm = cnm or payload
    original_cnm["receivedTime"] = datetime.utcfromtimestamp(
        received_time / 1000
    ).strftime(CNM_TIME_FORMAT)

    granules = payload.get("granules")
    if granules is None:
        granule = {}
        files = original_cnm.get("product", {}).get("files", [])
    elif len(granules) == 1:
        granule = granules[0]
        files = granule.get("files") or []
    else:
        raise RuntimeError(
            f"Received wrong number of granules {len(granules)} expected 1"
        )

    log.info("attempting to parse SQS")
    if cnm.get("trace") == "ASF-TOOLS":
        return payload
    sqs, sqs_url = get_sqs_client_and_url(cnm)

    if exception != "None":
        received_count = task_config.get("received_count")
        sqs_max_retries = task_config.get("sqs_max_retries")
        error_type = exception.get("Error")
        cause = exception.get("Cause", "Unknown error")

        error_response = {
            "status": "FAILURE",
            "errorCode": ERROR_TYPE_MAP.get(error_type, "PROCESSING_ERROR"),
            "errorMessage": cause,
        }
        message = _generate_message(original_cnm, files, error_response)
        if received_count > sqs_max_retries:
            _send_message(sqs, ENCODER.encode(message), sqs_url)
        return payload

    if granules is None:
        log.info("No granules or exceptions found in CMA")
        raise Exception("Unknown error occurred, malformed CMA")

    granule_response = {
        "status": "SUCCESS",
        "ingestionMetadata": {
            "catalogId": granule.get("cmrConceptId"),
            "catalogUrl": granule.get("cmrLink"),
        },
    }
    message = _generate_message(original_cnm, files, granule_response)
    _send_message(sqs, ENCODER.encode(message), sqs_url)

    return payload


def lambda_handler(event: dict, _context) -> dict | None:
    """Lambda handler.

    Args:
        event (dict): AWS Lambda event
        _context (dict): AWS Lambda context

    """
    init_root_logger()
    init_custom_log_record_factory(event)
    with log_errors():
        if "Records" in event:
            for record in event["Records"]:
                handle_sqs_dlq_record(record)
        else:
            return run_cumulus_task(response_task, event, _context)
