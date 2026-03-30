"""Pydantic schemas for task configuration."""

from pydantic import BaseModel, ConfigDict, Field
from python_schemas.helpers import pop_default


class Collection(BaseModel):
    name: str = Field(description="collection short name.")
    version: str = Field(description="collection version.")
    granuleIdExtraction: str = Field(
        "",
        description="GranuleId Extraction Regex",
        json_schema_extra=pop_default,
    )


class Model(BaseModel):
    """Configuration schema for the CnmToCma task."""

    model_config = ConfigDict(title="CnmToCmaConfig")

    collection: Collection
