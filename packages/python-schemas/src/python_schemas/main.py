"""Main executable code."""

import argparse
import contextlib
import importlib.util
import json
import sys
from collections.abc import Sequence
from pathlib import Path


def main(args: Sequence[str] | None = None):
    """python-schemas main CLI entrypoint for generating jsonschema from
    pydantic models.
    """

    parser = argparse.ArgumentParser()

    parser.add_argument("schemas", help="path to the schemas directory", type=Path)

    pargs = parser.parse_args(args=args)

    encountered_error = False

    for root, dirs, files in pargs.schemas.resolve().walk():
        for file_name in files:
            if file_name.endswith(".py"):
                path = root / file_name
                with _sys_path([str(root), "src"]):
                    try:
                        module = importlib.import_module(path.stem)
                    except ImportError as e:
                        encountered_error = True
                        print(f"WARNING: Failed to import module {path.stem!r}")
                        print(f"    {e}")
                        continue

                model_cls = getattr(module, "Model", None)
                if model_cls is None:
                    continue

                schema = model_cls.model_json_schema(mode="validation")

                output_path = path.with_suffix(".json")
                output_path.write_text(
                    json.dumps(schema, indent=2) + "\n",
                )
                print(f"Wrote schema to {output_path}")

    if encountered_error:
        sys.exit(-1)


@contextlib.contextmanager
def _sys_path(paths: list[str]):
    sys.path[0:0] = paths
    yield
    del sys.path[0 : len(paths)]
