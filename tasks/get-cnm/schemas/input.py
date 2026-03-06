"""Pydantic schemas for task input."""

from pydantic import BaseModel, ConfigDict, Field
from python_schemas.models import Granule


class Model(BaseModel):
    """Describes the input expected by the get-cnm task, which is the standard
    Cumulus message format for granules.
    """

    model_config = ConfigDict(title="GetCnmInput")

    granules: list[Granule] = Field(
        min_length=1,
        description="Array of all granules",
    )
