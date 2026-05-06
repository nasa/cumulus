"""CNM-R generator implementation."""

import copy
import json
import urllib.parse
from abc import ABC, abstractmethod
from datetime import UTC, datetime

from .types import ChecksumDict

CNM_TIME_FORMAT = "%Y-%m-%d %H:%M:%SZ"


class CnmGenerator:
    """Class to generate CNM responses."""

    def __init__(self, distribution_endpoint: str | None = None):
        """Construct CnmGenerator.

        :param distribution_endpoint: The base URL to use for HTTP URIs in
            CNM responses. If not provided, S3 URIs will be used instead.
        """
        self.uri_generator: UriGenerator = (
            S3UriGenerator()
            if distribution_endpoint is None
            else HttpUriGenerator(distribution_endpoint)
        )

    def get_cnm_r(
        self,
        cnm_s: dict,
        exception: str,
        granule: dict | None = None,
    ) -> dict:
        """Create a CNM-R message from a CNM-S message.

        :param cnm_s: the CNM-S message to generate a response for.
        :param exception: the workflow exception message.
        :param granule: the granule object from the payload if any.
        :return: the CNM-R message
        """
        cnm_r = copy.deepcopy(cnm_s)

        response = _get_response(exception)
        if granule is not None and response["status"] == "SUCCESS":
            cnm_r["product"]["files"] = [
                {
                    "type": file.get("type"),
                    "name": file.get("fileName"),
                    "uri": self.uri_generator.get_uri(file),
                    **_get_checksum(file),
                    "size": file.get("size"),
                }
                for file in granule["files"]
            ]
            cnm_r["product"]["name"] = (
                # ruff hint
                granule.get("producerGranuleId") or granule.get("granuleId")
            )

            if (concept_id := granule.get("cmrConceptId")) and (
                cmr_link := granule.get("cmrLink")
            ):
                cnm_r["ingestionMetadata"] = {
                    "catalogId": concept_id,
                    "catalogUrl": cmr_link,
                }
        else:
            del cnm_r["product"]

        cnm_r["response"] = response
        cnm_r["processCompleteTime"] = datetime.now(tz=UTC).strftime(CNM_TIME_FORMAT)

        return cnm_r

    def get_default_cnm_r_error(
        self,
        cnm_s: dict,
        cause: str,
    ) -> dict:
        """Create a CNM-R message from a CNM-S message when an error occorred
        within the response task itself.

        :param cnm_s: the CNM-S message to generate a response for.
        :param cause: the exception message.
        :return: the CNM-R message
        """
        cnm_r = {
            field: cnm_s.get(field) or f"Unknown/Missing {field}"
            for field in (
                "version",
                "provider",
                "collection",
                "submissionTime",
                "receivedTime",
                "identifier",
            )
        }

        cnm_r["response"] = {
            "status": "FAILURE",
            "errorCode": "PROCESSING_ERROR",
            "errorMessage": cause,
        }
        cnm_r["processCompleteTime"] = datetime.now(tz=UTC).strftime(CNM_TIME_FORMAT)

        return cnm_r


class UriGenerator(ABC):
    """Abstract class for creating file URIs."""

    @abstractmethod
    def get_uri(self, file: dict) -> str:
        """Create the URI from a file object.

        :param file: the file object from the granule payload.
        :return: the rendered URI.
        """
        pass


class S3UriGenerator(UriGenerator):
    """Class for creating S3 URIs."""

    def get_uri(self, file: dict) -> str:
        """Create the URI from a file object.

        :param file: the file object from the granule payload.
        :return: the rendered URI.
        """
        bucket = file["bucket"]
        key = file["key"]

        return f"s3://{bucket}/{key}"


class HttpUriGenerator(UriGenerator):
    """Class for creating HTTP URIs."""

    def __init__(self, distribution_endpoint: str):
        """Construct HttpUriGenerator.

        :param distribution_endpoint: the base URL to use for HTTP uris.
        """
        self.distribution_endpoint = distribution_endpoint + "/"

    def get_uri(self, file: dict) -> str:
        """Create the URI from a file object.

        :param file: the file object from the granule payload.
        :return: the rendered URI.
        """
        bucket = file["bucket"]
        key = file["key"]

        return urllib.parse.urljoin(self.distribution_endpoint, f"{bucket}/{key}")


def _get_response(exception: str | dict | None) -> dict:
    if isinstance(exception, dict):
        exc = exception
    elif not exception or exception in {"None", '"None"'}:
        return {
            "status": "SUCCESS",
        }
    else:
        exc = json.loads(exception)

    error_type = exc["Error"]
    match error_type:
        case "FileNotFound" | "RemoteResourceError" | "ConnectionTimeout":
            error_code = "TRANSFER_ERROR"
        case "InvalidChecksum" | "UnexpectedFileSize":
            error_code = "VALIDATION_ERROR"
        case _:
            error_code = "PROCESSING_ERROR"

    error_message = exc["Cause"]

    try:
        error_message = json.loads(error_message)["errorMessage"]
    except (json.JSONDecodeError, KeyError):
        pass

    return {
        "status": "FAILURE",
        "errorCode": error_code,
        "errorMessage": error_message,
    }


def _get_checksum(file: dict) -> ChecksumDict:
    checksum: ChecksumDict = {}
    if (val := file.get("checksumType")) is not None:
        checksum["checksumType"] = val
    if (val := file.get("checksum")) is not None:
        checksum["checksum"] = val

    return checksum
