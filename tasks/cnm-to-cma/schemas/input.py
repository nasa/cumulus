"""Pydantic schemas for task input."""

from pydantic import ConfigDict, RootModel
from python_schemas.models import CnmS


class Model(RootModel):
    """Input schema for the CnmToCma task."""

    model_config = ConfigDict(title="CnmToCmaInput")

    root: CnmS
