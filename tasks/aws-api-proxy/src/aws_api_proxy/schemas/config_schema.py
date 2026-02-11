"""Pydantic schemas for task configuration."""

import json
from typing import Literal

from pydantic import BaseModel, model_validator


class SNSPublishParameters(BaseModel):
    """Schema for SNS publish parameters."""

    TopicArn: str
    Message: str


class SNSService(BaseModel):
    """Schema for SNS service configuration."""

    service: Literal["sns"]
    action: Literal["publish"]
    parameters: SNSPublishParameters | None = None
    parameters_list: list[SNSPublishParameters] | None = None

    @model_validator(mode="after")
    def _require_parameters_or_list(self):
        if self.parameters is None and not self.parameters_list:
            raise ValueError("Either parameters or parameters_list must be specified.")
        return self


class Model(BaseModel):
    """Configuration schema for granule invalidator task."""

    sns_service: SNSService


main_model_schema = Model.model_json_schema(mode="validation")
print(json.dumps(main_model_schema, indent=2))
