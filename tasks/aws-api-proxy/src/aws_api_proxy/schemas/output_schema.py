"""Pydantic schemas for task output."""

import json
from typing import Any

from pydantic import BaseModel, model_validator


class Model(BaseModel):
    """Configuration schema for the task."""

    result: dict[str, Any] | None = None
    result_list: list[dict[str, Any]] | None = None

    @model_validator(mode="after")
    def _require_result_or_list(self):
        if self.result is None and not self.result_list:
            raise ValueError("Either result or result_list must be specified.")
        return self


main_model_schema = Model.model_json_schema(mode="validation")
print(json.dumps(main_model_schema, indent=2))
