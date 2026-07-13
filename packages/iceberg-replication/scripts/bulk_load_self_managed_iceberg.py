#!/usr/bin/env python3
"""Creates iceberg tables from a Postgres database."""

import argparse
import gc
import os
import queue
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import boto3
import psycopg2
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pv
import requests
from botocore.exceptions import ClientError
from create_staging_branch import create_staging_branches
from pyiceberg.catalog import load_catalog
from pyiceberg.io.pyarrow import schema_to_pyarrow
from pyiceberg.partitioning import PartitionField, PartitionSpec
from pyiceberg.schema import NestedField, Schema
from pyiceberg.table.sorting import NullOrder, SortDirection, SortField, SortOrder
from pyiceberg.transforms import IdentityTransform, TruncateTransform
from pyiceberg.types import (
    BooleanType,
    DateType,
    DoubleType,
    FloatType,
    IntegerType,
    LongType,
    StringType,
    TimestampType,
    TimestamptzType,
)

# Content type code for equality delete files in Iceberg metadata
EQUALITY_DELETE_CONTENT = 2


def log(msg):
    """Print a timestamped log message."""
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# =============================
# Config & Constants
# =============================

TABLE_PARTITION_CONFIG = {
    "executions": 5_000_000,
    "granules": 10_000_000,
    "files": 10_000_000,
}

REQUIRED_ENVS = [
    "PG_HOST",
    "PG_DB",
    "PG_USER",
    "PG_PASSWORD",
    "TABLES",
    "AWS_DEFAULT_REGION",
    "ICEBERG_NAMESPACE",
    "ICEBERG_S3_BUCKET",
]

ICEBERG_RESERVED_TABLE_NAMES = {
    "files",
    "manifests",
    "snapshots",
    "partitions",
    "history",
    "metadata_log_entries",
}


def _get_container_cpu_limit():
    metadata_url = os.getenv("ECS_CONTAINER_METADATA_URI_V4")
    if not metadata_url:
        return None
    resp = requests.get(f"{metadata_url}/task", timeout=2)
    resp.raise_for_status()
    data = resp.json()
    # CPU is in vCPU units (1024 = 1 vCPU)
    cpu_units = data.get("Limits", {}).get("CPU")
    if cpu_units is None:
        return None
    return cpu_units  # already in vCPUs for task-level limits


def _get_n_workers(default=4):
    cpu = _get_container_cpu_limit()
    if cpu is None:
        return default
    # never use more than 4 workers
    return min(4, max(1, int(cpu)))


@dataclass
class Config:
    """Runtime configuration loaded from environment variables."""

    pg_config: dict
    pg_schema: str
    table_names: list
    namespace: str
    s3_bucket: str
    region: str
    warehouse: str
    target_buffer_size: int
    block_size: int
    n_workers: int


def check_required_envs(args):
    """Verify that required environment variables are set."""
    missing = [var for var in REQUIRED_ENVS if not os.getenv(var)]
    if args.compact and not os.getenv("SPARK_JARS_DIR"):
        raise RuntimeError("SPARK_JARS_DIR must be set when using --compact")
    if missing:
        print("ERROR: Missing required environment variables:\n")
        for var in missing:
            print(f"  - {var}")
        print("\nSet the missing variables and retry.")
        sys.exit(1)


def init_config() -> Config:
    """Read env vars and return a Config instance."""
    return Config(
        pg_config={
            "host": os.environ["PG_HOST"],
            "port": int(os.getenv("PG_PORT", "5432")),
            "dbname": os.environ["PG_DB"],
            "user": os.environ["PG_USER"],
            "password": os.environ["PG_PASSWORD"],
        },
        pg_schema=os.getenv("PG_SCHEMA", "public"),
        table_names=[
            t.strip().split(".")[-1]
            for t in os.environ["TABLES"].split(",")
            if t.strip()
        ],
        namespace=os.environ["ICEBERG_NAMESPACE"],
        s3_bucket=os.environ["ICEBERG_S3_BUCKET"],
        region=os.environ["AWS_DEFAULT_REGION"],
        warehouse=f"s3://{os.environ['ICEBERG_S3_BUCKET']}/{os.getenv('ICEBERG_S3_PREFIX', 'warehouse')}",  # noqa: E501
        target_buffer_size=768 * 1024 * 1024,
        block_size=16 * 1024 * 1024,
        n_workers=_get_n_workers(),
    )


def ensure_glue_database(namespace, warehouse):
    """Create the Glue database if it does not already exist."""
    try:
        glue = boto3.client("glue")
        glue.create_database(
            DatabaseInput={
                "Name": namespace,
                "Description": (
                    "This namespace contains Iceberg tables replicated "
                    "from the Cumulus Postgres database."
                ),
                "LocationUri": warehouse,
            }
        )
        log(f"✨ Created Glue database '{namespace}'")
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "AlreadyExistsException":
            log(f"📂 Glue database '{namespace}' already exists")
        else:
            log(f"❌ Error creating Glue database: {e}")
            sys.exit(1)
    except Exception as e:  # noqa: BLE001
        log(f"❌ Error creating Glue database: {e}")
        sys.exit(1)


def fast_purge(catalog, identifier, location):
    """Drop an Iceberg table and delete all its S3 objects."""
    log(f"🧹 Fast Purging {identifier}...")
    try:
        catalog.drop_table(identifier)
    except Exception as e:  # noqa: BLE001
        log(f"  Could not drop table (may not exist): {e}")

    if not location.startswith("s3://"):
        return
    if not location.endswith("/"):
        location += "/"

    bucket_name = location.replace("s3://", "").split("/")[0]
    prefix = "/".join(location.replace("s3://", "").split("/")[1:])

    s3 = boto3.client("s3")
    paginator = s3.get_paginator("list_objects_v2")

    delete_count = 0
    for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
        if "Contents" in page:
            keys = [{"Key": obj["Key"]} for obj in page["Contents"]]
            s3.delete_objects(Bucket=bucket_name, Delete={"Objects": keys})
            delete_count += len(keys)
    log(f"🗑️ Cleaned up {delete_count} files from {location}")


def pg_to_pa_type(pg_type):
    """Map a Postgres type string to a PyArrow type."""
    pg_type = pg_type.lower()
    if "bool" in pg_type:
        result = pa.bool_()
    elif "int8" in pg_type or "bigint" in pg_type:
        result = pa.int64()
    elif "int" in pg_type:
        result = pa.int32()
    elif "double" in pg_type or "float8" in pg_type:
        result = pa.float64()
    elif "float" in pg_type or "real" in pg_type:
        result = pa.float32()
    elif "numeric" in pg_type or "decimal" in pg_type:
        result = pa.float64()
    elif "date" in pg_type:
        result = pa.date32()
    else:
        result = pa.string()

    return result


def pa_to_iceberg_type(pa_type, is_tz_aware):
    """Map a PyArrow type to the corresponding Iceberg type."""
    if pa.types.is_int64(pa_type):
        result = LongType()
    elif pa.types.is_int32(pa_type):
        result = IntegerType()
    elif pa.types.is_boolean(pa_type):
        result = BooleanType()
    elif pa.types.is_floating(pa_type):
        result = DoubleType() if pa_type == pa.float64() else FloatType()
    elif pa.types.is_date(pa_type):
        result = DateType()
    elif is_tz_aware is not None:
        result = TimestamptzType() if is_tz_aware else TimestampType()
    else:
        result = StringType()

    return result


def stream_postgres_to_pipe(pg_config, query, pipe_writer_fd):
    """Stream a Postgres COPY query into a pipe file descriptor."""
    try:
        with psycopg2.connect(**pg_config) as conn:
            with conn.cursor() as cur:
                with os.fdopen(pipe_writer_fd, "wb") as pipe_out:
                    cur.copy_expert(query, pipe_out)
    except Exception as e:  # noqa: BLE001
        log(f"❌ Pipe Writer Error: {e}")
        try:
            os.close(pipe_writer_fd)
        except Exception:  # noqa: BLE001, S110
            pass


def _commit_worker(commit_queue, table, total_rows_counter, lock):
    """Drain Arrow tables from commit_queue and append them to the Iceberg table.

    Workers signal completion by putting None on the queue. Runs in its own
    dedicated thread so all table.append() calls are serialized, keeping
    Iceberg metadata consistent.
    """
    while True:
        item = commit_queue.get()
        if item is None:
            commit_queue.task_done()
            break
        arrow_table, n_rows, range_desc = item
        try:
            table.append(arrow_table)
            with lock:
                total_rows_counter[0] += n_rows
            log(
                f"  💾 Committed {n_rows:,} rows from {range_desc} "
                f"({total_rows_counter[0]:,} total)"
            )
        except Exception as e:  # noqa: BLE001
            log(f"  ❌ Commit error for {range_desc}: {e}")
            traceback.print_exc()
        finally:
            commit_queue.task_done()


def _process_partition_range(  # noqa: PLR0913
    range_idx,
    n_ranges,
    start_id,
    end_id,
    copy_sql,
    cols,
    csv_read_fields,
    target_pa_schema,
    ts_transform_map,
    bool_transform_map,
    json_transform_map,
    commit_queue,
    pg_config,
    target_buffer_size,
    block_size,
):
    """Stream one partition range from Postgres, transform to Arrow, and enqueue for
    commit.

    Returns the number of rows processed.
    """
    range_desc = (
        f"partition with cumulus_id {start_id:,} to {(end_id - 1):,}"
        if start_id is not None
        else "full table"
    )
    log(f"📦 [{range_idx + 1}/{n_ranges}] Starting {range_desc}")

    p_reader_fd, p_writer_fd = os.pipe()
    writer_thread = threading.Thread(
        target=stream_postgres_to_pipe,
        args=(pg_config, copy_sql, p_writer_fd),
        daemon=True,
    )
    writer_thread.start()

    rows_this_range = 0
    accumulated_batches = []
    current_buffer_bytes = 0

    try:
        with os.fdopen(p_reader_fd, "rb") as pipe_in:
            reader = pv.open_csv(
                pipe_in,
                read_options=pv.ReadOptions(column_names=cols, block_size=block_size),
                parse_options=pv.ParseOptions(
                    delimiter="\t", quote_char='"', double_quote=True
                ),
                convert_options=pv.ConvertOptions(
                    column_types=pa.schema(csv_read_fields)
                ),
            )

            for batch in reader:
                chunk = pa.Table.from_batches([batch])

                for idx, is_tz in ts_transform_map:
                    raw = chunk.column(idx)
                    is_empty = pc.equal(raw, "")
                    safe_raw = pc.if_else(is_empty, "1970-01-01 00:00:00.000000", raw)
                    ts_data = pc.cast(safe_raw, pa.timestamp("us"), safe=False)
                    if is_tz:
                        ts_data = pc.assume_timezone(ts_data, "UTC")
                    chunk = chunk.set_column(
                        idx, cols[idx], pc.if_else(is_empty, None, ts_data)
                    )

                for idx in bool_transform_map:
                    raw = chunk.column(idx)
                    chunk = chunk.set_column(
                        idx,
                        cols[idx],
                        pc.if_else(pc.equal(raw, ""), None, pc.equal(raw, "t")),
                    )

                for idx in json_transform_map:
                    raw = chunk.column(idx)
                    chunk = chunk.set_column(
                        idx, cols[idx], pc.if_else(pc.equal(raw, ""), None, raw)
                    )

                chunk = chunk.cast(target_pa_schema)
                accumulated_batches.append(chunk)
                current_buffer_bytes += chunk.nbytes
                rows_this_range += len(batch)

                if current_buffer_bytes >= target_buffer_size:
                    combined = pa.concat_tables(accumulated_batches).combine_chunks()
                    commit_queue.put((combined, rows_this_range, range_desc))
                    accumulated_batches = []
                    current_buffer_bytes = 0
                    rows_this_range = 0

        if accumulated_batches:
            combined = pa.concat_tables(accumulated_batches).combine_chunks()
            commit_queue.put((combined, rows_this_range, range_desc))
            accumulated_batches.clear()
    except pa.ArrowInvalid as e:
        if "Empty CSV file" in str(e):
            log(f"⚠️ No data found for {range_desc}, skipping")
            return 0
        raise

    finally:
        writer_thread.join()
        gc.collect()
        pa.default_memory_pool().release_unused()

    return rows_this_range


def _build_schema(cfg, table_name, exclude_cols):
    """Query Postgres to build PyArrow and Iceberg schemas for a table.

    Returns (cols, select_clauses, initial_pa_fields, ts_info, pg_types,
    pg_estimate, primary_key_id, primary_key_name).
    """
    cols, select_clauses, initial_pa_fields, ts_info = [], [], [], {}
    pg_types = {}
    pg_estimate = 0
    primary_key_id = None
    primary_key_name = None

    with psycopg2.connect(**cfg.pg_config) as conn:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = 15000;")
            cur.execute(
                "SELECT reltuples::bigint FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = %s AND c.relname = %s",
                (cfg.pg_schema, table_name),
            )
            row = cur.fetchone()
            pg_estimate = row[0] if row else 0

            cur.execute(  # noqa: S608
                f'SELECT * FROM {cfg.pg_schema}."{table_name}" LIMIT 0'  # noqa: S608
            )
            table_description = list(cur.description)

            oids = tuple({desc[1] for desc in table_description})
            cur.execute(
                "SELECT oid, format_type(oid, -1) FROM pg_type WHERE oid IN %s",
                (oids,),
            )
            type_map = {r[0]: r[1] for r in cur.fetchall()}

            for desc in table_description:
                name = desc[0]
                if name in exclude_cols:
                    continue
                if name == "cumulus_id":
                    primary_key_id = len(initial_pa_fields) + 1
                    primary_key_name = name

                dtype = type_map.get(desc[1], "text").lower()
                pg_types[name] = dtype
                cols.append(name)

                if "timestamp" in dtype:
                    select_clauses.append(
                        f'to_char("{name}", \'YYYY-MM-DD HH24:MI:SS.US\') AS "{name}"'
                    )
                    ts_info[name] = "with time zone" in dtype or "timestamptz" in dtype
                else:
                    select_clauses.append(f'"{name}"')
                    ts_info[name] = None

                pa_type = pg_to_pa_type(dtype)
                initial_pa_fields.append(pa.field(name, pa_type))

    return (
        cols,
        select_clauses,
        initial_pa_fields,
        ts_info,
        pg_types,
        pg_estimate,
        primary_key_id,
        primary_key_name,
    )


def process_table(cfg, catalog, table_name, replace=False, compact=False):  # noqa: PLR0912, PLR0915
    """Load a Postgres table into an Iceberg table and create its staging branch."""
    is_reserved = table_name in ICEBERG_RESERVED_TABLE_NAMES
    iceberg_table_name = f"{table_name}_table" if is_reserved else table_name
    identifier = f"{cfg.namespace}.{iceberg_table_name}"
    table_location = f"{cfg.warehouse}/{cfg.namespace}/{iceberg_table_name}"

    if is_reserved:
        log(
            f"⚠️ Detected reserved Iceberg table name '{table_name}'"
            f" → using '{iceberg_table_name}'"
        )

    if catalog.table_exists(identifier):
        if replace:
            log(f"⚠️ Table {identifier} exists. --replace is set. Purging...")
            fast_purge(catalog, identifier, table_location)
        else:
            log(
                f"⚠️ WARNING: Table {identifier} already exists. Skipping."
                " (Use --replace to overwrite)"
            )
            return

    log(f"🚀 Processing: {table_name} (Iceberg table: {iceberg_table_name})")
    start_time = time.monotonic()
    exclude_cols = (
        {"original_payload", "final_payload"} if table_name == "executions" else set()
    )

    try:
        (
            cols,
            select_clauses,
            initial_pa_fields,
            ts_info,
            pg_types,
            pg_estimate,
            primary_key_id,
            primary_key_name,
        ) = _build_schema(cfg, table_name, exclude_cols)

        fields = [
            NestedField(
                i + 1,
                f.name,
                pa_to_iceberg_type(f.type, ts_info.get(f.name)),
                required=(i + 1) == primary_key_id,
            )
            for i, f in enumerate(initial_pa_fields)
        ]

        iceberg_schema = Schema(
            *fields,
            identifier_field_ids=[primary_key_id] if primary_key_id else [],
        )
        partition_size = TABLE_PARTITION_CONFIG.get(table_name)

        if partition_size and primary_key_name == "cumulus_id":
            partition_spec = PartitionSpec(
                PartitionField(
                    source_id=primary_key_id,
                    field_id=1000,
                    transform=TruncateTransform(partition_size),
                    name="cumulus_id_part",
                )
            )
        else:
            partition_spec = PartitionSpec()

        sort_order = SortOrder()
        if "updated_at" in cols:
            updated_at_idx = cols.index("updated_at") + 1
            sort_order = SortOrder(
                SortField(
                    source_id=updated_at_idx,
                    transform=IdentityTransform(),
                    direction=SortDirection.DESC,
                    null_order=NullOrder.NULLS_LAST,
                )
            )

        props = {
            "format-version": "2",
            "table_format": "iceberg",
            "write.parquet.target-file-size-bytes": "1073741824",
            "write.target-file-size-bytes": "1073741824",
            "write.delete.mode": "merge-on-read",
            "write.update.mode": "merge-on-read",
            "write.upsert.enabled": "true" if primary_key_id else "false",
        }
        if primary_key_name:
            props["identifier-fields"] = primary_key_name

        table = catalog.create_table(
            identifier,
            schema=iceberg_schema,
            location=table_location,
            partition_spec=partition_spec,
            sort_order=sort_order,
            properties=props,
        )

        with table.transaction() as txn:
            txn.upgrade_table_version(format_version=2)
            txn.set_properties(props)

        log(f"💎 Target Iceberg Schema (Version: {table.metadata.format_version}):")
        if not table.spec().is_unpartitioned():
            log(f"   - Partitioning: {table.spec()}")
        for field in table.schema().fields:
            is_pk = (
                "(Primary Key)"
                if field.field_id in table.schema().identifier_field_ids
                else ""
            )
            log(
                f"   - {field.name} {is_pk}"
                f" | pg={pg_types.get(field.name)}"
                f" | iceberg={field.field_type}"
            )

        target_pa_schema = schema_to_pyarrow(table.schema())
        ts_transform_map = [
            (i, ts_info[c]) for i, c in enumerate(cols) if ts_info.get(c) is not None
        ]
        bool_transform_map = [
            i
            for i, c in enumerate(cols)
            if pa.types.is_boolean(target_pa_schema.field(c).type)
        ]
        json_transform_map = [
            i for i, c in enumerate(cols) if "json" in pg_types.get(c, "")
        ]
        csv_read_fields = [
            pa.field(f.name, pa.string()) if pa.types.is_boolean(f.type) else f
            for f in initial_pa_fields
        ]

        # --- CHUNKING LOGIC ---
        ranges = []
        if not partition_spec.is_unpartitioned() and primary_key_name == "cumulus_id":
            log("🔍 Determining ID ranges for chunked loading...")
            with psycopg2.connect(**cfg.pg_config) as conn:
                with conn.cursor() as cur:
                    cur.execute(  # noqa: S608
                        f"SELECT MIN(cumulus_id), MAX(cumulus_id)"  # noqa: S608
                        f' FROM {cfg.pg_schema}."{table_name}"'
                    )
                    min_id, max_id = cur.fetchone()

            if min_id is not None and max_id is not None:
                aligned_start = (min_id // partition_size) * partition_size
                for start_id in range(aligned_start, max_id + 1, partition_size):
                    ranges.append((start_id, start_id + partition_size))
            else:
                ranges.append((None, None))
        else:
            ranges.append((None, None))

        col_sql = ", ".join(select_clauses)
        n_ranges = len(ranges)
        log(
            f"⚡ Processing {n_ranges} partition range(s)"
            f" with {cfg.n_workers} parallel workers"
        )

        commit_queue = queue.Queue(maxsize=cfg.n_workers * 2)
        total_rows_counter = [0]
        counter_lock = threading.Lock()

        committer = threading.Thread(
            target=_commit_worker,
            args=(commit_queue, table, total_rows_counter, counter_lock),
            daemon=True,
        )
        committer.start()

        worker_errors = []

        def _submit_range(range_idx, start_id, end_id):
            if start_id is not None:
                with psycopg2.connect(**cfg.pg_config) as conn:
                    with conn.cursor() as cur:
                        cur.execute(  # noqa: S608
                            f'SELECT 1 FROM {cfg.pg_schema}."{table_name}"'  # noqa: S608
                            " WHERE cumulus_id >= %s AND cumulus_id < %s"
                            " LIMIT 1",
                            (start_id, end_id),
                        )
                        exists = cur.fetchone() is not None

                if not exists:
                    log(f"⚠️ Skipping empty partition {start_id:,} to {end_id - 1:,}")
                    return 0

                copy_sql = (  # noqa: S608
                    f'COPY (SELECT {col_sql} FROM {cfg.pg_schema}."{table_name}"'  # noqa: S608
                    f" WHERE cumulus_id >= {start_id} AND cumulus_id < {end_id})"
                    f" TO STDOUT WITH (FORMAT csv, DELIMITER '\t', NULL '')"
                )
            else:
                copy_sql = (  # noqa: S608
                    f'COPY (SELECT {col_sql} FROM {cfg.pg_schema}."{table_name}")'  # noqa: S608
                    f" TO STDOUT WITH (FORMAT csv, DELIMITER '\t', NULL '')"
                )
            return _process_partition_range(
                range_idx,
                n_ranges,
                start_id,
                end_id,
                copy_sql,
                cols,
                csv_read_fields,
                target_pa_schema,
                ts_transform_map,
                bool_transform_map,
                json_transform_map,
                commit_queue,
                cfg.pg_config,
                cfg.target_buffer_size,
                cfg.block_size,
            )

        with ThreadPoolExecutor(max_workers=cfg.n_workers) as executor:
            futures = {
                executor.submit(_submit_range, i, start_id, end_id): (
                    i,
                    start_id,
                    end_id,
                )
                for i, (start_id, end_id) in enumerate(ranges)
            }
            for future in as_completed(futures):
                i, start_id, end_id = futures[future]
                try:
                    future.result()
                except Exception as e:  # noqa: BLE001
                    worker_errors.append((i, e))
                    log(f"❌ Worker error for range {i} (ids {start_id}→{end_id}): {e}")
                    traceback.print_exc()

        commit_queue.put(None)
        committer.join()

        if worker_errors:
            log(f"❌ {len(worker_errors)} worker(s) failed. Aborting.")
            sys.exit(1)

        total_rows_loaded = total_rows_counter[0]
        elapsed = time.monotonic() - start_time
        log(
            f"✅ {table_name} load complete into {iceberg_table_name}"
            f" ({total_rows_loaded:,} rows in {elapsed:.1f}s)"
        )
        log(
            f"📊 Postgres Estimate: {pg_estimate:,}"
            f" | Iceberg Actual: {total_rows_loaded:,}"
        )
        log(f"🌿 Creating staging branch for {table_name}...")
        create_staging_branches(catalog, cfg.namespace, [iceberg_table_name])

        if compact:
            log(f"🧹 Running full-overwrite compaction for {table_name}...")
            subprocess.run(  # noqa: S603
                [
                    sys.executable,
                    os.path.join(os.path.dirname(__file__), "iceberg_compact.py"),
                    "--namespace",
                    cfg.namespace,
                    "--table",
                    iceberg_table_name,
                    "--warehouse",
                    cfg.warehouse,
                    "--region",
                    cfg.region,
                    "--jars-dir",
                    os.environ["SPARK_JARS_DIR"],
                    "--full-overwrite",
                ],
                check=True,
            )

    except Exception:
        traceback.print_exc()
        sys.exit(1)


def main():
    """Entry point for bulk loading Postgres tables into Iceberg."""
    parser = argparse.ArgumentParser(
        description="Bulk load Postgres tables to Iceberg."
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing Iceberg table and S3 data before recreating.",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="After load + staging branch creation, run full-overwrite compaction",
    )
    args = parser.parse_args()

    check_required_envs(args)
    cfg = init_config()

    catalog = load_catalog(
        cfg.namespace, **{"type": "glue", "client.region": cfg.region}
    )
    ensure_glue_database(cfg.namespace, cfg.warehouse)

    log(f"Bulk loading {cfg.table_names} to {cfg.namespace} in bucket {cfg.s3_bucket}")
    log(
        f"Allowing up to {cfg.n_workers} parallel workers reading from Postgres"
        " (set N_WORKERS env var to change)"
    )

    for t in cfg.table_names:
        process_table(cfg, catalog, t, replace=args.replace, compact=args.compact)


if __name__ == "__main__":
    main()
