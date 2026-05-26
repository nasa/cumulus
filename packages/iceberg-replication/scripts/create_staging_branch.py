#!/usr/bin/env python3
"""Create a staging branch for a table."""

import argparse
import os
import sys

from pyiceberg.catalog import load_catalog

REQUIRED_ENVS = [
    "AWS_DEFAULT_REGION",
    "ICEBERG_NAMESPACE",
    "ICEBERG_S3_BUCKET",
]


def get_required_envs():
    """Validate that all required env vars are set and return their values in a map."""
    missing = []
    values = {}

    for key in REQUIRED_ENVS:
        value = os.environ.get(key)
        if not value:
            missing.append(key)
        else:
            values[key] = value

    if missing:
        print("Missing required environment variables:")
        for key in missing:
            print(f"  - {key}")
        sys.exit(1)

    return values


def create_staging_branches(cat, namespace, tables):
    """Create the staging branch for a table."""
    for table_name in tables:
        full_name = f"{namespace}.{table_name}"
        print(f"Processing table: {full_name}")

        table = cat.load_table(full_name)
        refs = table.refs()

        if "staging" in refs:
            print(f"  WARNING: staging branch already exists for {full_name}, skipping")
            continue

        if "main" not in refs:
            # Table has no snapshots yet (empty table) — create an empty snapshot
            # so that main branch exists and staging branch can be created from it
            print(f"  No snapshots found for {full_name} — creating empty snapshot")
            import pyarrow as pa  # noqa: PLC0415
            from pyiceberg.io.pyarrow import schema_to_pyarrow  # noqa: PLC0415

            empty = pa.table(
                {
                    f.name: pa.array(
                        [], type=schema_to_pyarrow(table.schema()).field(f.name).type
                    )
                    for f in table.schema().fields
                }
            )
            table.append(empty)
            # Reload to get updated refs
            table = cat.load_table(full_name)
            refs = table.refs()

        if "main" not in refs:
            print(
                f"  ERROR: 'main' branch still not found for {full_name} after empty snapshot"  # noqa: E501
            )
            continue

        main_snapshot_id = refs["main"].snapshot_id

        table.manage_snapshots().create_branch(main_snapshot_id, "staging").commit()

        print(f"  Created staging branch at snapshot {main_snapshot_id}")

    print("done")


def main():
    """Create the staging branch for one or more tables."""
    parser = argparse.ArgumentParser(
        description="Create staging branches for Iceberg tables"
    )
    parser.add_argument(
        "--tables",
        required=True,
        help="Comma-separated list of tables (e.g. files,executions,granules)",
    )

    args = parser.parse_args()
    tables = [t.strip() for t in args.tables.split(",") if t.strip()]

    env = get_required_envs()

    namespace = env["ICEBERG_NAMESPACE"]
    s3_bucket = env["ICEBERG_S3_BUCKET"]
    region = env["AWS_DEFAULT_REGION"]

    cat = load_catalog(
        "glue",
        **{
            "type": "glue",
            "region_name": region,
            "warehouse": f"s3://{s3_bucket}/warehouse",
        },
    )

    create_staging_branches(cat, namespace, tables)


if __name__ == "__main__":
    main()
