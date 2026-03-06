"""Pydantic schemas for task output."""

from typing import Any

from pydantic import BaseModel, ConfigDict


class Model(BaseModel):
    """Output schema for the task."""

    model_config = ConfigDict(title="AwsApiProxyOutput")

    result_list: list[dict[str, Any]]
