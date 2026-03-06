"""Pydantic schemas for task configuration."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator


class SNSPublishParameters(BaseModel):
    """Schema for SNS publish parameters."""

    TopicArn: str | list[str]
    Message: Any | list[Any]


class ParameterFilter(BaseModel):
    """Schema for parameter filters."""

    # This list must always match the keys in PARAMETER_FILTERS in ..aws_api_proxy
    # We cannot reference this list since Literals must be statically analyzable and
    # PARAMETER_FILTERS is a runtime dict; https://typing.python.org/en/latest/spec/literal.html#illegal-parameters-for-literal-at-type-check-time
    name: Literal[("json.dumps")]
    field: str


class Model(BaseModel):
    """Configuration schema for AWS API proxy task."""

    model_config = ConfigDict(title="AwsApiProxyConfig")

    service: Literal["sns"]
    action: Literal["publish"]
    parameters: SNSPublishParameters
    iterate_by: str | None = None
    parameter_filters: list[ParameterFilter] | None = None

    @model_validator(mode="after")
    def _validate_iterate_by(self):
        if self.iterate_by:
            # Check if the field exists in parameters
            if self.iterate_by not in self.parameters.model_fields:
                raise TypeError(
                    f"iterate_by field '{self.iterate_by}' does not exist in "
                    f"parameters '{self.parameters.model_fields}'."
                )

            # Get the value
            iterate_by_value = getattr(self.parameters, self.iterate_by)

            # Check if it's a list
            if not isinstance(iterate_by_value, list):
                raise TypeError(
                    f"iterate_by field '{self.iterate_by}' must reference a list field "
                    f"in parameters '{self.parameters.model_fields}'."
                )
        return self
