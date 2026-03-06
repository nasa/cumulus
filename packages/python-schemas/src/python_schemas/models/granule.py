"""CMA granule models."""

from pydantic import BaseModel, ConfigDict, Field

from python_schemas.helpers import SkipNone, pop_default


class File(BaseModel):
    """CMA granule file model."""

    model_config = ConfigDict(json_schema_extra={"additionalProperties": False})

    bucket: str = Field(description="Bucket where file is archived in S3")
    checksum: str | SkipNone = Field(
        None,
        description="Checksum value for file",
        json_schema_extra=pop_default,
    )
    checksumType: str | SkipNone = Field(
        None,
        description="Type of checksum (e.g. md5, sha256, etc)",
        json_schema_extra=pop_default,
        title="ChecksumType",
    )
    fileName: str | SkipNone = Field(
        None,
        description="Name of file (e.g. file.txt)",
        json_schema_extra=pop_default,
        title="FileName",
    )
    key: str = Field(description="S3 Key for archived file")
    size: float | SkipNone = Field(
        None,
        description="Size of file (in bytes)",
        json_schema_extra=pop_default,
    )
    source: str | SkipNone = Field(
        None,
        description="Source URI of the file from origin system (e.g. S3, FTP, HTTP)",
        json_schema_extra=pop_default,
    )
    type: str | SkipNone = Field(
        None,
        description="Type of file (e.g. data, metadata, browse)",
        json_schema_extra=pop_default,
    )


class Granule(BaseModel):
    """CMA granule model."""

    granuleId: str = Field(..., title="GranuleId")
    files: list[File]
