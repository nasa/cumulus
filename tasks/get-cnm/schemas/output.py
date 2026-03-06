"""Pydantic schemas for task output."""

from pydantic import ConfigDict, RootModel
from python_schemas.models import CnmS


class Model(RootModel):
    """Output schema for the GetCnm task."""

    model_config = ConfigDict(title="GetCnmOutput")

    root: dict[str, CnmS]
