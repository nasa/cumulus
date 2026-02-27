"""Task for archiving PDRs."""

import json
import logging
import os
from datetime import datetime

import boto3
from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

logger = CumulusLogger("pdr-cleanup", logging.INFO)


def cleanup_pdr(event: dict, context: dict) -> dict:
    """Task to archive PDRs.

    :param event: A lambda event object.
    :param context: An AWS Lambda context.
    """

    logger.debug("## EVENT OBJ \n" + json.dumps(event))

    provider = event["config"]["provider"]
    payload = event["input"]
    pdr = payload["pdr"]

    if payload["failed"]:
        logger.info("PDR failed to ingest all granules successfully, NOT archiving")
        raise Exception(
            "PDR failed to ingest all granules successfully\n"
            f"Ingest Granule workflow failure count: {len(event['input']['failed'])}"
        )
    return {
        **payload,
        "pdr": {
            **payload["pdr"],
            "archivePath": move_pdr(provider, pdr),
        },
    }


def move_pdr(provider: dict, pdr: dict) -> str:
    """Move PDR to location <provider.host>/<PDRs>/ .

    :param provider: Provider information.
    :param pdr: PDR information.
    :return: The archive location of the PDR.
    """

    curr_date = datetime.now().strftime("%Y.%m.%d")
    src_path = os.path.join(pdr["path"], pdr["name"])
    dest_path = os.path.join("PDRs", pdr["path"], curr_date, pdr["name"])

    s3_client = boto3.client("s3")
    try:
        s3_client.copy_object(
            CopySource=os.path.join(provider["host"], src_path),
            Bucket=provider["host"],
            Key=dest_path,
        )
        logger.info(
            "COPIED FROM {0}/{1} TO {0}/{2}", provider["host"], src_path, dest_path
        )
    except Exception:
        logger.error(
            "FAILED TO COPY FROM {0}/{1} TO {0}/{2}",
            provider["host"],
            src_path,
            dest_path,
            exc_info=True,
        )
        raise

    try:
        s3_client.delete_object(Bucket=provider["host"], Key=src_path)
        logger.info("DELETED: {0}/{1}", provider["host"], src_path)
    except Exception as err:
        logger.error(err)
        raise
    return dest_path


def handler(event: dict, context: dict) -> dict:
    """Lambda handler that runs the task through CMA.

    :param event: A Cumulus Message.
    :param context: An AWS Lambda context.
    :return: output from task.
    """

    return run_cumulus_task(cleanup_pdr, event, context)
