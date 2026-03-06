"""CNM models."""

from enum import Enum

from pydantic import AwareDatetime, BaseModel, Field, RootModel

from python_schemas.helpers import SkipNone, pop_default


class ResponseStatus(Enum):
    """CNM response status enum."""

    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class IngestionMetadata(BaseModel):
    """CNM ingestionMetadata model."""

    catalogId: str | SkipNone = Field(
        None,
        description="Identifier for catalog",
        json_schema_extra=pop_default,
    )
    catalogUrl: str | SkipNone = Field(
        None,
        description="URL of catalog entry",
        json_schema_extra=pop_default,
    )


class ResponseErrorCode(Enum):
    """CNM response errorCode enum."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    PROCESSING_ERROR = "PROCESSING_ERROR"
    TRANSFER_ERROR = "TRANSFER_ERROR"


class Response(BaseModel):
    """CNM response model."""

    status: ResponseStatus = Field(description="Successful or error.")
    ingestionMetadata: IngestionMetadata | SkipNone = Field(
        None,
        description=(
            "Object defining ingestion metadata, like CMR Concept IDs, URLS, etc"
        ),
        json_schema_extra=pop_default,
    )
    errorCode: ResponseErrorCode | SkipNone = Field(
        None,
        description="Error message. Success messages can be ignored.",
        json_schema_extra=pop_default,
    )
    errorMessage: str | SkipNone = Field(
        None,
        description="The message error for the failure that occurred.",
        json_schema_extra=pop_default,
    )


class DataProcessingType(Enum):
    """CNM dataProcessingType enum."""

    forward = "forward"
    reprocessing = "reprocessing"


class FileType(Enum):
    """CNM file type enum."""

    data = "data"
    browse = "browse"
    metadata = "metadata"
    ancillary = "ancillary"
    linkage = "linkage"


class ChecksumType(Enum):
    """CNM file checksumType enum."""

    SHA512 = "SHA512"
    SHA256 = "SHA256"
    SHA2 = "SHA2"
    SHA1 = "SHA1"
    md5 = "md5"


class File(BaseModel):
    """CNM file model."""

    type: FileType = Field(
        description=(
            "The type of file. science files (netcdf, HDF, binary) should use "
            "the 'data' type. More can be added if need and consensus demand."
        ),
    )
    subtype: str | SkipNone = Field(
        None,
        description=(
            "An optional, specific implementation of the file::type. e.g. "
            "NetCDF for a file of type 'data'"
        ),
        json_schema_extra=pop_default,
    )
    uri: str = Field(description="the URI of the file (s3://...)")
    name: str = Field(
        description="The human readable filename that this file represents."
    )
    checksumType: ChecksumType | SkipNone = Field(None, json_schema_extra=pop_default)
    checksum: str | SkipNone = Field(
        None,
        description="Checksum of the file.",
        json_schema_extra=pop_default,
    )
    size: float = Field(description="Size, in bytes, of the file.")


class FileGroup(BaseModel):
    """CNM filegroup model."""

    id: str = Field(
        description="string id of the filegroup by which all files are associated."
    )
    files: list[File] = Field(description="array of files that make up this product")


class Collection(BaseModel):
    """CNM collection model."""

    name: str = Field(description="collection short name.")
    version: str = Field(description="collection version.")


class ProductBase(BaseModel):
    """CNM product model base class."""

    name: str = Field(description="Identifier/name of the product")
    producerGranuleId: str | SkipNone = Field(
        None,
        description="Optional producer granule identifier.",
        json_schema_extra=pop_default,
    )
    dataVersion: str | SkipNone = Field(
        None,
        description="Version of this product",
        json_schema_extra=pop_default,
    )
    dataProcessingType: DataProcessingType | SkipNone = Field(
        None,
        description="The type of data processing stream that generated the product",
        json_schema_extra=pop_default,
    )


class ProductWithFiles(ProductBase):
    """CNM product model with required files list."""

    files: list[File] = Field(description="array of files that make up this product")
    filegroups: list[FileGroup] | SkipNone = Field(
        None,
        description="array of filegroups that make up this product",
        json_schema_extra=pop_default,
    )


class ProductWithFileGroups(ProductBase):
    """CNM product model with required filegroups list."""

    files: list[File] | SkipNone = Field(
        None,
        description="array of files that make up this product",
        json_schema_extra=pop_default,
    )
    filegroups: list[FileGroup] = Field(
        description="array of filegroups that make up this product"
    )


class CnmBase(BaseModel):
    """CNM model base class."""

    version: str = Field(
        description="The CNM Version used. e.g. '1.3'",
        pattern=r"[0-9]+\.[0-9]+(\.[0-9]+(-(alpha|beta)(\.[0-9]+)?)?)?",
    )
    submissionTime: AwareDatetime = Field(
        description=(
            "The time the message was created (and presumably sent) to the "
            "publication mechanism."
        ),
    )
    identifier: str = Field(
        description=(
            "Unique identifier for the message as a whole. It is the senders "
            "responsibility to ensure uniqueness. This identifier can be used "
            "in response messages to provide tracability."
        ),
    )
    collection: str | Collection = Field(
        description="The collection to which these granules will belong."
    )
    provider: str | SkipNone = Field(
        None,
        description=(
            "the name of the provider (e.g. SIP, SDS, etc. ) producing these files."
        ),
        json_schema_extra=pop_default,
    )
    trace: str | SkipNone = Field(
        None,
        description="Information on the message or who is sending it.",
        json_schema_extra=pop_default,
    )


class CnmS(CnmBase):
    """CNM-S model."""

    receivedTime: AwareDatetime | SkipNone = Field(
        None,
        description="Time message was received by the ingest system",
        json_schema_extra=pop_default,
    )
    processCompleteTime: AwareDatetime | SkipNone = Field(
        None,
        description="The time processing completed by the receiving entity.",
        json_schema_extra=pop_default,
    )
    response: Response | SkipNone = Field(
        None,
        description=(
            "The response message type sent. Can be a success message or error "
            "message. Akin to both the PAN and PDRD"
        ),
        json_schema_extra=pop_default,
    )
    product: ProductWithFiles | ProductWithFileGroups


class CnmR(CnmBase):
    """CNM-R model."""

    receivedTime: AwareDatetime = Field(
        description="Time message was received by the ingest system"
    )
    processCompleteTime: AwareDatetime = Field(
        description="The time processing completed by the receiving entity."
    )
    response: Response = Field(
        description=(
            "The response message type sent. Can be a success message or error "
            "message. Akin to both the PAN and PDRD"
        ),
    )
    product: ProductWithFiles | ProductWithFileGroups | SkipNone = Field(
        None,
        json_schema_extra=pop_default,
    )


class Cnm(RootModel):
    """CNM model. Either CNM-R or CNM-S."""

    root: CnmS | CnmR = Field(
        description="A message format to trigger or respond to processing. Version 1.2",
        title="Cloud Notification Message (CNM) 1.2 ",
    )
