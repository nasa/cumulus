"""Task implementation."""

import logging
import os

from cumulus_logger import CumulusLogger
from run_cumulus_task import run_cumulus_task

from .create_cnm import CnmGenerator
from .sender import Message, Sender, get_sender
from .types import MessageAttributesDict

logger = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))


class SendException(Exception):
    """An exception indicating that CNM messages failed to be sent to a response
    location.
    """

    pass


def lambda_adapter(event: dict, context) -> dict:
    """Run the task code."""

    config = event["config"]
    input = event["input"]

    senders = [get_sender(arn) for arn in config["responseArns"]]
    cnm_generator = CnmGenerator(
        distribution_endpoint=config.get("distribution_endpoint"),
    )
    # Input schema guarantees there is exactly one granule
    granule = input["granules"][0] if "granules" in input else None

    cnm_s = {}
    try:
        cnm_s = config["cnm"] or input
        logger.info(f"Generating response for CNM-S: {cnm_s}")
        cnm_r = cnm_generator.get_cnm_r(
            cnm_s=cnm_s,
            exception=config["exception"],
            granule=granule,
        )
    except Exception as e:
        logger.error("Unexpected exception", exc_info=True)
        # Send error

        cnm_r = cnm_generator.get_default_cnm_r_error(
            cnm_s=cnm_s,
            cause=str(e),
        )

        _send_message(
            senders,
            Message(
                body=cnm_r,
                attributes=_get_message_attributes(cnm_r),
            ),
        )

        raise
    # TODO(reweeden): Handle retries... Only send response on last retry
    # to avoid getting multiple responses for a single request.
    # Send message
    results = _send_message(
        senders,
        Message(
            body=cnm_r,
            attributes=_get_message_attributes(cnm_r),
        ),
    )
    if results:
        raise SendException(results)

    return {
        "cnm": cnm_r,
        "input": input,
    }


def _send_message(senders: list[Sender], message: Message) -> list[Exception]:
    logger.info(f"Sending CNM-R: {message}")

    results = []
    for sender in senders:
        logger.info(f"Sending response to {sender.arn}")
        try:
            sender.send(message)
        except Exception as e:
            results.append(e)

    return results


def _get_message_attributes(cnm_r: dict) -> MessageAttributesDict:
    # TODO(reweeden): Fallback to getting collection from input
    cnm_collection = cnm_r["collection"]
    if isinstance(cnm_collection, str):
        # For CNM <= 1.6.0
        collection = cnm_collection
    else:
        # For CNM == 1.6.1
        collection = cnm_collection["name"]

    attributes: MessageAttributesDict = {
        "COLLECTION": collection,
        "CNM_RESPONSE_STATUS": cnm_r["response"]["status"],
        "DATA_VERSION": cnm_r.get("product", {}).get("dataVersion")
        or "Unknown/Missing",
    }

    if val := cnm_r.get("product", {}).get("dataProcessingType"):
        attributes["dataProcessingType"] = val

    if val := cnm_r.get("trace"):
        attributes["trace"] = val

    return attributes


def lambda_handler(event: dict, context):
    """Lambda handler.

    AWS Lambda invokes this function when the Lambda is triggered.
    Runs the task through the Cumulus Message Adapter (CMA).

    :param event: Lambda event input
    :param context: Lambda context object

    :return: Output from the task wrapped by CMA
    """
    logger.setMetadata(event, context)
    cumulus_task_return = run_cumulus_task(lambda_adapter, event, context)
    return cumulus_task_return
