"""Pydantic schemas for task input."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, RootModel
from python_schemas.helpers import SkipNone, pop_default
from python_schemas.models import CnmS


class File(BaseModel):
    """CMA granule file model."""

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
    type: str | SkipNone = Field(
        None,
        description="Type of file (e.g. data, metadata, browse)",
        json_schema_extra=pop_default,
    )


class Granule(BaseModel):
    """CMA granule model."""

    granuleId: str = Field(title="GranuleId")
    producerGranuleId: str | SkipNone = Field(None, json_schema_extra=pop_default)
    cmrConceptId: str | SkipNone = Field(None, json_schema_extra=pop_default)
    cmrLink: str | SkipNone = Field(None, json_schema_extra=pop_default)
    files: list[File]


class GranuleInput(BaseModel):
    """Input schema for CMA granule input."""

    granules: list[Granule] = Field(
        min_length=1,
        max_length=1,
        description="Array of all granules",
    )


class Model(RootModel):
    """Input schema for the CnmResponse task."""

    model_config = ConfigDict(title="CnmResponseInput")

    root: (
        Annotated[
            GranuleInput,
            Field(
                description="CMA input, the normal expected input",
            ),
        ]
        | Annotated[
            CnmS,
            Field(
                description=(
                    "CNM input, this could happen if the workflow failed before "
                    "CNM-to-CMA conversion"
                ),
            ),
        ]
    )
