"""Pydantic schemas for task output."""

import argparse
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, model_validator


class Model(BaseModel):
    """Output schema for the task."""

    result: dict[str, Any] | None = None
    result_list: list[dict[str, Any]] | None = None

    @model_validator(mode="after")
    def _require_result_or_list(self):
        if self.result is None and not self.result_list:
            raise ValueError("Either result or result_list must be specified.")
        return self


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
