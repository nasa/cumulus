"""Pydantic schemas for task output."""

from pydantic import BaseModel, ConfigDict, Field
from python_schemas.helpers import SkipNone, pop_default
from python_schemas.models import CnmS


# File schema used by the SyncGranule task. This is slightly non-standard
# compared to the file schema used by other tasks
class File(BaseModel):
    name: str = Field(description="name of file to be synced")
    filename: str | SkipNone = Field(
        None,
        description="optional field - usage depends on provider type",
        json_schema_extra=pop_default,
    )
    type: str | SkipNone = Field(None, json_schema_extra=pop_default)
    source_bucket: str | SkipNone = Field(
        None,
        description="optional - alternate source bucket to use for this file instead of the provider bucket.  Works with s3 provider only, ignored for other providers",
        json_schema_extra=pop_default,
    )
    path: str = Field(description="provider path of file to be synced")


class Granule(BaseModel):
    granuleId: str
    dataType: str | SkipNone = Field(None, json_schema_extra=pop_default)
    version: str | SkipNone = Field(None, json_schema_extra=pop_default)
    producerGranuleId: str | SkipNone = Field(
        None,
        description="Granule ID from the producer, if available",
        json_schema_extra=pop_default,
    )
    files: list[File]


class Model(BaseModel):
    """Output schema for the CnmToCma task."""

    model_config = ConfigDict(title="CnmToCmaOutput")

    cnm: CnmS
    granules: list[Granule]
