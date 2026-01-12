"""Task implementation."""

from cumulus_process import Process

from .create_cnm import CnmGenerator
from .sender import Message, get_sender
from .types import MessageAttributesDict


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

    def process(self) -> dict:
        """Run the task code."""

        cnm_s = {}
        try:
            cnm_s = self.config["cnm_s"]
            cnm_r = self.cnm_generator.get_cnm_r(
                cnm_s=cnm_s,
                exception=self.config["exception"],
                granule=self.input["granules"][0],
            )
            # Send message
            for sender in self.senders:
                sender.send(
                    Message(
                        body=cnm_r,
                        attributes=_get_message_attributes(cnm_r),
                    )
                )
            return {
                "cnm": cnm_r,
                "input": self.input,
            }
        except Exception as e:
            self.logger.exception("Unexpected exception")
            # Send error

            cnm_r = self.cnm_generator.get_default_cnm_r_error(
                cnm_s=cnm_s,
                cause=str(e),
            )

            for sender in self.senders:
                sender.send(
                    Message(
                        body=cnm_r,
                        attributes=_get_message_attributes(cnm_r),
                    )
                )

            raise


def _get_message_attributes(cnm_r: dict) -> MessageAttributesDict:
    # TODO(reweeden): Fallback to getting collection from input
    cnm_collection = cnm_r["collection"]
    if isinstance(cnm_collection, str):
        # For CNM <= 1.6.0
        collection = cnm_collection
    else:
        # For CNM == 1.6.1
        collection = cnm_collection["name"]

    attributes = {
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
