"""Pydantic schemas for task configuration."""

import argparse
import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, model_validator

from ..aws_api_proxy import PARAMETER_FILTERS


class SNSPublishParameters(BaseModel):
    """Schema for SNS publish parameters."""

    TopicArn: str | list[str]
    Message: Any


class ParameterFilter(BaseModel):
    """Schema for parameter filters."""

    name: str
    field: str

    @model_validator(mode="after")
    def _validate_name(self):
        if self.name not in PARAMETER_FILTERS:
            raise ValueError(
                f"parameter_filters.name must be one of: {', '.join(PARAMETER_FILTERS)}"
            )
        return self


class SNSService(BaseModel):
    """Schema for SNS service configuration."""

    service: Literal["sns"]
    action: Literal["publish"]
    parameters: SNSPublishParameters
    iterate_by: str | None = None
    parameter_filters: list[ParameterFilter] | None = None

    @model_validator(mode="after")
    def _validate_iterate_by(self):
        if self.iterate_by:
            iterate_by_value = getattr(self.parameters, self.iterate_by, None)
            if not isinstance(iterate_by_value, list):
                raise ValueError(
                    "iterate_by field must reference a list field in parameters."
                )
        return self


class Model(BaseModel):
    """Configuration schema for AWS API proxy task."""

    sns_service: SNSService


def save(output_dir: str) -> None:
    """Print the JSON schema for the output model."""
    main_model_schema = Model.model_json_schema(mode="validation")

    output_path = Path(output_dir) / "output_schema.json"
    output_path.write_text(
        json.dumps(main_model_schema, indent=2) + "\n", encoding="utf-8"
    )
    print(output_path)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate output schema JSON")
    parser.add_argument(
        "output_dir",
        help="Directory to write output_schema.json",
    )
    return parser.parse_args()


def main() -> None:
    """Generate the output schema JSON file."""
    args = _parse_args()
    save(args.output_dir)
