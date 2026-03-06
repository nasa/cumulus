"""Pydantic schemas for task output."""

from pydantic import BaseModel, ConfigDict
from python_schemas.models import CnmR, Granule


class Model(BaseModel):
    """Output schema for the CnmResponse task."""

    model_config = ConfigDict(title="CnmResponseOutput")

    cnm: CnmR
    granules: list[Granule]
