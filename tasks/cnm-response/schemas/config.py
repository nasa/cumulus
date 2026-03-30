"""Pydantic schemas for task configuration."""

from pydantic import BaseModel, ConfigDict, Field
from python_schemas.helpers import SkipNone, pop_default
from python_schemas.models import CnmS


class CmaException(BaseModel):
    """CMA exception model."""

    model_config = ConfigDict(title="Exception")

    Error: str
    Cause: str


class Model(BaseModel):
    """Configuration schema for the CnmResponse task."""

    model_config = ConfigDict(title="CnmResponseConfig")

    cnm: CnmS | None = Field(description="The input CNM-S to the workflow")
    responseArns: list[str] = Field(
        description="The ARN of the stream to write out to",
    )
    exception: str | CmaException = Field(
        description="The 'exception' field from the workflow",
    )
    distribution_endpoint: str | SkipNone = Field(
        None,
        description=(
            "HTTP endpoint to use for file URIs. If not provided, s3 URIs will "
            "be used instead."
        ),
        json_schema_extra=pop_default,
    )
