"""Task implementation."""

from cumulus_process import Process

from .create_cnm import CnmGenerator
from .sender import Message, Sender, get_sender
from .types import MessageAttributesDict


class SendException(Exception):
    """An exception indicating that CNM messages failed to be sent to a response
    location.
    """

    pass


class CnmResponse(Process):
    """Cumulus Process for CNM Response task."""

    def __init__(
        self,
        input: list[str],
        path: str | None = None,
        config: dict = {},
        **kwargs,
    ):
        """Construct CnmResponse."""

        super().__init__(input, path=path, config=config, **kwargs)

        self.senders = [get_sender(arn) for arn in self.config["responseArns"]]
        self.cnm_generator = CnmGenerator(
            distribution_endpoint=self.config.get("distribution_endpoint"),
        )
        # Input schema guarantees there is exactly one granule
        self.granule = self.input["granules"][0] if "granules" in self.input else None

    def process(self) -> dict:
        """Run the task code."""

        cnm_s = {}
        try:
            cnm_s = self.config["cnm_s"] or self.input
            cnm_r = self.cnm_generator.get_cnm_r(
                cnm_s=cnm_s,
                exception=self.config["exception"],
                granule=self.granule,
            )
        except Exception as e:
            self.logger.exception("Unexpected exception")
            # Send error

            cnm_r = self.cnm_generator.get_default_cnm_r_error(
                cnm_s=cnm_s,
                cause=str(e),
            )

            _send_to_senders(
                self.senders,
                Message(
                    body=cnm_r,
                    attributes=_get_message_attributes(cnm_r),
                ),
            )

            raise
        # TODO(reweeden): Handle retries... Only send response on last retry
        # to avoid getting multiple responses for a single request.
        # Send message
        results = _send_to_senders(
            self.senders,
            Message(
                body=cnm_r,
                attributes=_get_message_attributes(cnm_r),
            ),
        )
        if results:
            raise SendException(results)

        return {
            "cnm": cnm_r,
            "input": self.input,
        }


def _send_to_senders(senders: list[Sender], message: Message) -> list[Exception]:
    results = []
    for sender in senders:
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
