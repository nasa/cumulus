"""Python type annotation implementations."""

from typing import NotRequired, TypedDict


# TODO: Should we standardize the naming convention here?
class MessageAttributesDict(TypedDict):
    """Message attribute dictionary type."""

    COLLECTION: str
    CNM_RESPONSE_STATUS: str
    DATA_VERSION: str
    dataProcessingType: NotRequired[str]
    trace: NotRequired[str]


class ChecksumDict(TypedDict):
    """Checksum dictionary type."""

    checksum: NotRequired[str]
    checksumType: NotRequired[str]
