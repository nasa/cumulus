#!/usr/bin/env python3
"""Iceberg equality-delete compaction via PySpark + PyIceberg.

Compaction can be run in two ways - fully overwrite tables or only overwrite
the partitions that differ between the staging and main branches.

Partition overwrite flow:
  1. Check snapshots -- exit if main and staging are already at the same snapshot.
  2. PAUSE Kafka connector.
  3. Find any partitions that have been updated on staging and rewrite those partitions.
     Main is untouched during this step.
  4. Verify staging branch has 0 equality delete files. Abort if not --
     main is never touched if the write is not clean.
  5. Point main at staging's new snapshot (metadata-only, atomic).
  6. RESUME Kafka connector.

Full table overwrite flow:
  1. PAUSE Kafka connector.
  2. Make sure that staging and main branches are in sync.
  3. Overwrite the full table on the main branch.
  4. Point staging at main's new snapshot (metadata-only, atomic).
  5. RESUME Kafka connector.

Run modes:
  One-shot:  omit --interval  (default)
  Server:    --interval N     (runs compaction in a loop, sleeping N seconds between
  runs)

Spark recovery:
  If the local Spark JVM dies or becomes unreachable (Py4J/connection errors),
  the session is torn down and restarted automatically, up to --max-spark-restarts
  times per compaction run.
"""

import argparse
import logging
import re
import time
from datetime import datetime

import requests
from py4j.protocol import Py4JError, Py4JNetworkError
from pyiceberg.catalog import load_catalog
from pyspark import SparkContext
from pyspark.sql import SparkSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# Errors that indicate the Spark JVM / Py4J gateway is unreachable rather than
# a logical failure in the compaction itself.
SPARK_CONN_ERRORS = (
    Py4JError,
    Py4JNetworkError,
    ConnectionRefusedError,
    ConnectionResetError,
)

# Tools interacting with Iceberg tables run into problems when the tables are
# named with a special Iceberg concept name like files, manifests, or history.
# We need to use a different name to ensure all of our scripts work correctly.
# See https://github.com/apache/iceberg/issues/10550
RESERVED_TABLES = {
    "files": "files_table",
}


def resolve_table_name(table_name: str) -> str:
    """Return the iceberg table name for a given postgres table name."""
    return RESERVED_TABLES.get(table_name, table_name)


# -- Kafka Connect helpers -----------------------------------------------------


class KafkaConnectClient:
    """Client used to connect to the Kafka Connect service."""

    def __init__(self, base_url: str, connector_name: str, timeout: int = 60):
        """Initialize a KafkaConnectClient."""
        self.base_url = base_url.rstrip("/")
        self.connector_name = connector_name
        self.timeout = timeout

    def _url(self, path: str) -> str:
        return f"{self.base_url}/{path}"

    def status(self) -> str:
        """Get the status of this connection."""
        r = requests.get(self._url("/status"), timeout=self.timeout)
        r.raise_for_status()
        return r.json()["state"]

    def pause(self, wait_secs: int = 30):
        """Pause the sink process."""
        log.info(f"Pausing sink '{self.connector_name}'...")
        r = requests.post(self._url("/pause"), timeout=self.timeout)
        r.raise_for_status()
        for _ in range(wait_secs):
            if self.status() == "PAUSED":
                log.info(f"Sink '{self.connector_name}' is PAUSED")
                return
            time.sleep(1)
        raise TimeoutError(f"Sink did not reach PAUSED in {wait_secs}s")

    def resume(self, wait_secs: int = 30):
        """Resume the sink process."""
        log.info(f"Resuming sink '{self.connector_name}'...")
        r = requests.post(self._url("/resume"), timeout=self.timeout)
        r.raise_for_status()
        for _ in range(wait_secs):
            if self.status() == "RUNNING":
                log.info(f"Sink '{self.connector_name}' is RUNNING")
                return
            time.sleep(1)
        raise TimeoutError(f"Sink did not reach RUNNING in {wait_secs}s")


# -- Spark session + PyIceberg catalog ----------------------------------------


def get_spark(jars_dir: str, warehouse: str, region: str) -> SparkSession:
    """Start a spark session."""
    log.info("Starting Spark session...")
    jars = (
        f"{jars_dir}/iceberg-spark-runtime-3.5_2.12-1.7.1.jar"
        f":{jars_dir}/iceberg-aws-bundle-1.7.1.jar"
    )

    spark = (
        SparkSession.builder.master("local[*]")
        .appName("iceberg-compaction")
        .config("spark.driver.extraClassPath", jars)
        .config("spark.executor.extraClassPath", jars)
        .config(
            "spark.sql.extensions",
            "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
        )
        .config("spark.sql.catalog.glue", "org.apache.iceberg.spark.SparkCatalog")
        .config(
            "spark.sql.catalog.glue.catalog-impl",
            "org.apache.iceberg.aws.glue.GlueCatalog",
        )
        .config("spark.sql.catalog.glue.warehouse", warehouse)
        .config("spark.sql.catalog.glue.io-impl", "org.apache.iceberg.aws.s3.S3FileIO")
        .config("spark.sql.catalog.glue.client.region", region)
        .config("spark.sql.parquet.enableVectorizedReader", "false")
        .config("spark.sql.iceberg.vectorization.enabled", "false")
        .config("spark.sql.iceberg.overwrite-by-partition", "true")
        .config("spark.driver.memory", "8g")
        .config("spark.executor.memory", "8g")
        .config("spark.local.dir", "./spark-tmp")
        .getOrCreate()
    )
    log.info(f"Spark version: {spark.version}")
    return spark


def spark_is_alive(spark: SparkSession) -> bool:
    """Cheap liveness probe for the Spark JVM."""
    try:
        spark.sql("SELECT 1").collect()
        return True
    except Exception:
        return False


def restart_spark(spark, jars_dir: str, warehouse: str, region: str) -> SparkSession:
    """Tear down a (possibly dead) Spark session and start a fresh one."""
    log.warning("Restarting Spark session...")
    try:
        spark.stop()
    except Exception as e:
        log.warning(f"spark.stop() failed (JVM likely already dead): {e}")

    # If the JVM gateway itself died, getOrCreate() would try to reuse it.
    # Force pyspark to spawn a new gateway/JVM. These are internal attributes
    # but are the standard workaround for a dead local JVM (stable across
    # PySpark 3.x -- re-verify on major version bumps).
    SparkContext._active_spark_context = None
    SparkContext._gateway = None
    SparkContext._jvm = None
    SparkSession._instantiatedSession = None
    SparkSession._activeSession = None

    return get_spark(jars_dir, warehouse, region)


def get_catalog(region: str, warehouse: str):
    """Get the spark catalog."""
    return load_catalog(
        "glue",
        **{
            "type": "glue",
            "region_name": region,
            "warehouse": warehouse,
        },
    )


# -- PyIceberg branch helpers -------------------------------------------------


def get_snapshot_id(spark: SparkSession, table_id: str, branch: str) -> int:
    """Get the snapshot ID for a given table and branch."""
    df = spark.sql(f"""
        SELECT snapshot_id
        FROM glue.{table_id}.refs
        WHERE name = '{branch}'
    """)  # noqa: S608

    if df.count() == 0:
        raise ValueError(f"Branch '{branch}' not found.")

    return df.collect()[0]["snapshot_id"]


def replace_branch(spark: SparkSession, table_id: str, branch: str, snapshot_id: int):
    """Replace an iceberg table branch with the given snapshot."""
    log.info(f"  replace_branch('{branch}' -> snapshot {snapshot_id})")
    spark.sql(f"""
        ALTER TABLE glue.{table_id}
        REPLACE BRANCH `{branch}`
        AS OF VERSION {snapshot_id}
    """)


def count_equality_deletes(spark: SparkSession, table_id: str, snapshot_id: int) -> int:
    """Get the number of equality deletes for the given table and snapshot."""
    df = spark.sql(f"""
        SELECT count(*) as delete_files
        FROM glue.{table_id}.files VERSION AS OF {snapshot_id}
        WHERE content = 2
    """)  # noqa: S608

    return df.collect()[0]["delete_files"]


def is_partitioned(catalog, table_id: str) -> bool:
    """Check partitioning via PyIceberg catalog (no Spark SQL required)."""
    table = catalog.load_table(table_id)
    return len(table.spec().fields) > 0


def has_sort_order(catalog, table_id: str) -> bool:
    """Return True if the table has a sort oder, False otherwise."""
    table = catalog.load_table(table_id)
    try:
        return table.sort_order() is not None and len(table.sort_order().fields) > 0
    except Exception:
        return False


def log_table_summary(spark: SparkSession, catalog, table_id: str, branches: list):
    """Print a summary of the table."""
    table = catalog.load_table(table_id)
    refs = table.refs()
    log.info(f"-- Branch summary for {table_id} --")
    for branch in branches:
        if branch in refs:
            snap = table.snapshot_by_id(refs[branch].snapshot_id)
            ts = datetime.fromtimestamp(snap.timestamp_ms / 1000)
            eq = count_equality_deletes(spark, table_id, refs[branch].snapshot_id)
            log.info(
                f"  {branch:20s}  snapshot={refs[branch].snapshot_id}"
                f"  ts={ts}  eq_delete_files={eq}"
            )


# -- Core compaction ----------------------------------------------------------
def full_rewrite_single_table(  # noqa: PLR0913
    namespace: str,
    table_name: str,
    catalog,
    spark: SparkSession,
    staging_branch: str = "staging",
    main_branch: str = "main",
    dry_run: bool = False,
) -> bool:
    """Fully compact a single table using the rewrite_data_files procedure for optimal
    compaction. The current version of Iceberg libraries does not support branches for
    rewrite_data_files, so this should only be used for the initial table load file
    compaction and should not be used as part of replication file compaction.

    Returns True on success, False on skipped/failure.
    Raises on unexpected errors.
    """
    table_id = f"{namespace}.{table_name}"
    log.info(f"{'=' * 60}")
    log.info(f"Fully compacting table: {table_id}")
    log.info(f"{'=' * 60}")

    starting_staging_snapshot_id = get_snapshot_id(spark, table_id, staging_branch)
    starting_main_snapshot_id = get_snapshot_id(spark, table_id, main_branch)

    log.info(f"starting staging snapshot: {starting_staging_snapshot_id}")
    log.info(f"starting main snapshot: {starting_main_snapshot_id}")

    if starting_staging_snapshot_id != starting_main_snapshot_id:
        raise RuntimeError(
            f"'{staging_branch}' and {main_branch} are not in sync - will not perform compaction."  # noqa: E501
        )

    log.info(f"Rewriting data files on {namespace}.{table_name} on {main_branch}")
    start = time.time()

    table_has_sort_order = has_sort_order(catalog, table_id)

    if not dry_run:
        # Using rewrite_data_files because it is faster than an INSERT OVERWRITE command
        # and uses table properties to determine optimal sizes. The command does not
        # support branches and will perform the overwrite on main.
        if table_has_sort_order:
            log.info("Using sort strategy for rewrite_data_files")
            spark.sql(f"""
                CALL glue.system.rewrite_data_files(
                    table => '{namespace}.{table_name}',
                    strategy => 'sort'
                )
            """)
        else:
            log.info("No sort order found — using default rewrite strategy")
            spark.sql(f"""
                CALL glue.system.rewrite_data_files(
                    table => '{namespace}.{table_name}'
                )
            """)
        log.info(
            f"Rewriting data files for {namespace}.{table_name} complete in {time.time() - start:.1f}s"  # noqa: E501
        )
    else:
        log.info(f"[DRY RUN] Would rewrite {namespace}.{table_name} ")

    if not dry_run:
        main_snapshot_id = get_snapshot_id(spark, table_id, main_branch)
        staging_snapshot_id = get_snapshot_id(spark, table_id, staging_branch)
        log.info(f"main snapshot prior to promotion: {main_snapshot_id}")

        if starting_main_snapshot_id != main_snapshot_id:
            log.info(
                f"Replace staging snapshot {staging_snapshot_id} -> main {main_snapshot_id}..."  # noqa: E501
            )
            replace_branch(spark, table_id, staging_branch, main_snapshot_id)

            log_table_summary(spark, catalog, table_id, [main_branch, staging_branch])
        else:
            log.info("Full table overwrite did not change the main snapshot")
    else:
        log.info(f"[DRY RUN] Would verify '{main_branch}' and replace {staging_branch}")

    return True


def insert_overwrite_single_table(  # noqa: PLR0913
    namespace: str,
    table_name: str,
    catalog,
    spark: SparkSession,
    staging_branch: str = "staging",
    main_branch: str = "main",
    dry_run: bool = False,
) -> bool:
    """Fully compact a single table using INSERT OVERWRITE. This function should be used
    as part of replication file compaction for any tables that are not partitioned.

    Returns True on success, False on skipped/failure.
    Raises on unexpected errors.
    """
    table_id = f"{namespace}.{table_name}"
    log.info(f"{'=' * 60}")
    log.info(
        f"Fully compacting table: {table_id} using INSERT OVERWRITE on {staging_branch}"
    )
    log.info(f"{'=' * 60}")

    start = time.time()

    if not dry_run:
        spark.sql(f"""
            INSERT OVERWRITE glue.{namespace}.{table_name}.branch_{staging_branch}
            SELECT * FROM glue.{namespace}.{table_name}.branch_{staging_branch}
        """)  # noqa: S608
        log.info(f"INSERT OVERWRITE complete in {time.time() - start:.1f}s")
    else:
        log.info(
            f"[DRY RUN] Would INSERT OVERWRITE "  # noqa: S608
            f"glue.{namespace}.{table_name}.branch_{staging_branch} "
            f"SELECT * FROM glue.{namespace}.{table_name}.branch_{staging_branch}"
        )

    if not dry_run:
        staging_snapshot_id = get_snapshot_id(spark, table_id, staging_branch)
        remaining = count_equality_deletes(spark, table_id, staging_snapshot_id)
        log.info(
            f"staging snapshot: {staging_snapshot_id}  eq_delete_files={remaining}"
        )

        if remaining > 0:
            raise RuntimeError(
                f"'{staging_branch}' branch has {remaining} equality delete files -- "
                "aborting. main has not been modified."
            )

        log.info(f"Promoting staging snapshot {staging_snapshot_id} -> main...")
        replace_branch(spark, table_id, main_branch, staging_snapshot_id)

        log_table_summary(spark, catalog, table_id, [main_branch, staging_branch])
    else:
        log.info(f"[DRY RUN] Would verify '{staging_branch}' and promote to main")

    return True


def partition_rewrite_single_table(  # noqa: PLR0912, PLR0913, PLR0915
    namespace: str,
    table_name: str,
    catalog,
    spark: SparkSession,
    staging_branch: str = "staging",
    main_branch: str = "main",
    dry_run: bool = False,
) -> bool:
    """Compact a single table by only rewriting modified partitions. Returns True on
    success, False on skipped/failure. Raises on unexpected errors.
    """
    table_id = f"{namespace}.{table_name}"
    log.info(f"{'=' * 60}")
    log.info(f"Compacting modified partitions on table: {table_id}")
    log.info(f"{'=' * 60}")

    # ------------------------------------------------------------------
    # 1. Get latest staging and main snapshots
    # ------------------------------------------------------------------
    log.info("Fetching current snapshots...")

    staging_snapshot_id = get_snapshot_id(spark, table_id, staging_branch)
    log.info(f"Staging snapshot_id: {staging_snapshot_id}")
    main_snapshot_id = get_snapshot_id(spark, table_id, main_branch)
    log.info(f"Main snapshot_id: {main_snapshot_id}")

    if staging_snapshot_id == main_snapshot_id:
        return False

    if not is_partitioned(catalog, table_id):
        log.warning(
            f"Table {table_id} is NOT partitioned. Using insert overwrite on full table."  # noqa: E501
        )
        return insert_overwrite_single_table(
            namespace, table_name, catalog, spark, staging_branch, main_branch, dry_run
        )

    # ------------------------------------------------------------------
    # 2. Identify partitions with files on staging but not on main,
    #    plus any partitions that have equality deletes on staging
    # ------------------------------------------------------------------
    log.info("Identifying partitions to compact...")

    spark.sql(f"""
        CREATE OR REPLACE TEMP VIEW changed_partitions AS
        SELECT DISTINCT f_staging.partition
        FROM glue.{table_id}.files VERSION AS OF {staging_snapshot_id} AS f_staging
        LEFT ANTI JOIN glue.{table_id}.files VERSION AS OF {main_snapshot_id} AS f_main
            ON f_staging.file_path = f_main.file_path
        UNION
        SELECT DISTINCT partition
        FROM glue.{table_id}.files VERSION AS OF {staging_snapshot_id}
        WHERE content = 2
    """)  # noqa: S608

    partition_count = spark.sql("SELECT COUNT(*) FROM changed_partitions").collect()[0][
        0
    ]

    log.info(f"Partitions to compact: {partition_count}")

    # ------------------------------------------------------------------
    # 3. Rewrite those partitions on staging by reading from the
    #    staging branch and writing back to it directly
    # ------------------------------------------------------------------
    if partition_count > 0:
        log.info("Rewriting changed partitions on staging branch...")

        if not dry_run:
            partition_rows = spark.sql("SELECT * FROM changed_partitions").collect()

            # Dynamically read truncate width and partition column from DESCRIBE
            describe_rows = spark.sql(f"DESCRIBE glue.{table_id}").collect()
            truncate_width = None
            partition_col = None
            for row in describe_rows:
                match = re.search(r"truncate\((\d+),\s*(\w+)\)", row["data_type"])
                if match:
                    truncate_width = int(match.group(1))
                    partition_col = match.group(2)
                    break

            if truncate_width is None or partition_col is None:
                raise RuntimeError(
                    "Could not determine truncate width and partition column from DESCRIBE output"  # noqa: E501
                )

            log.info(
                f"Partition column: {partition_col}, truncate width: {truncate_width}"
            )

            for row in partition_rows:
                part_start = time.time()

                low = row["partition"][0]
                high = low + truncate_width
                where_clause = f"{partition_col} >= {low} AND {partition_col} < {high}"
                log.info(f"Rewriting partition: {where_clause}")

                partition_df = spark.sql(f"""
                    SELECT * FROM glue.{table_id}.branch_{staging_branch}
                    WHERE {where_clause}
                """)  # noqa: S608

                partition_df.writeTo(f"glue.{table_id}.branch_{staging_branch}").option(
                    "write.target-file-size-bytes", "536870912"
                ).overwritePartitions()
                duration = round(time.time() - part_start)
                log.info(f"Partition rewrite completed in {duration}s")

            # Verify staging snapshot has actually changed
            new_staging_snapshot_id = spark.sql(f"""
                SELECT snapshot_id FROM glue.{table_id}.refs
                WHERE name = '{staging_branch}'
            """).collect()[0]["snapshot_id"]  # noqa: S608

            log.info(f"Staging snapshot before rewrite: {staging_snapshot_id}")
            log.info(f"Staging snapshot after rewrite:  {new_staging_snapshot_id}")

            if new_staging_snapshot_id == staging_snapshot_id:
                raise RuntimeError(
                    "Rewrite did not commit a new snapshot to staging — aborting before touching main"  # noqa: E501
                )

            log.info("Rewrite complete.")
            log_table_summary(spark, catalog, table_id, [main_branch, staging_branch])
        else:
            log.info("[DRY RUN] Would rewrite changed partitions.")
            new_staging_snapshot_id = staging_snapshot_id
    else:
        log.info("No changed partitions detected. Skipping rewrite.")
        new_staging_snapshot_id = staging_snapshot_id

    # ------------------------------------------------------------------
    # 4. Reset main to the new staging snapshot
    # ------------------------------------------------------------------
    log.info("Resetting main branch to staging...")

    if not dry_run:
        spark.sql(f"""
            ALTER TABLE glue.{table_id}
            REPLACE BRANCH `{main_branch}`
            AS OF VERSION {new_staging_snapshot_id}
        """)

        # Verify main actually moved
        new_main_snapshot_id = get_snapshot_id(spark, table_id, main_branch)

        log.info(f"Main snapshot before reset: {main_snapshot_id}")
        log.info(f"Main snapshot after reset:  {new_main_snapshot_id}")

        if new_main_snapshot_id != new_staging_snapshot_id:
            raise RuntimeError(
                f"Main branch did not update to staging snapshot "
                f"{new_staging_snapshot_id} — aborting"
            )

        log.info("Main branch successfully reset to staging.")
    else:
        log.info("[DRY RUN] Would reset main branch to staging.")
    return True


# -- Compaction orchestration -------------------------------------------------


def rewrite_tables(  # noqa: PLR0912, PLR0913, PLR0915
    namespace: str,
    table_names: list,
    spark: SparkSession,
    catalog,
    kafka_client,
    staging_branch: str = "staging",
    main_branch: str = "main",
    dry_run: bool = False,
    full_overwrite: bool = False,
):
    """Run one compaction pass over all tables. spark and catalog are provided by
    the caller so they can be reused across multiple passes in server mode.
    """
    results = {}  # table_name -> "ok" | "failed" | "skipped"

    sink_paused = False
    perform_compaction = False
    if full_overwrite:
        perform_compaction = True
    else:
        log.info("Checking if any tables need compacting")
        for table_name in table_names:
            table_id = f"{namespace}.{table_name}"
            staging_snapshot_id = get_snapshot_id(spark, table_id, staging_branch)
            main_snapshot_id = get_snapshot_id(spark, table_id, main_branch)
            if staging_snapshot_id != main_snapshot_id:
                log.info(
                    f"{table_name} needs compaction - "
                    f"staging snapshot: {staging_snapshot_id}, "
                    f"main snapshot: {main_snapshot_id}"
                )
                perform_compaction = True
                if not sink_paused:
                    # -- Pause connector once before all tables ------------------------
                    if kafka_client:
                        if not dry_run:
                            kafka_client.pause()
                            sink_paused = True
                        else:
                            log.info("[DRY RUN] Would pause Kafka connector here")
                    else:
                        log.warning("No Kafka connector configured -- skipping pause.")
                log_table_summary(
                    spark, catalog, table_id, [main_branch, staging_branch]
                )
                break

    if not perform_compaction:
        log.info("No tables needed compaction")
        return

    try:
        for table_name in table_names:
            start_time = time.time()
            try:
                if full_overwrite:
                    modified = full_rewrite_single_table(
                        namespace=namespace,
                        table_name=table_name,
                        catalog=catalog,
                        spark=spark,
                        staging_branch=staging_branch,
                        main_branch=main_branch,
                        dry_run=dry_run,
                    )
                else:
                    modified = partition_rewrite_single_table(
                        namespace=namespace,
                        table_name=table_name,
                        catalog=catalog,
                        spark=spark,
                        staging_branch=staging_branch,
                        main_branch=main_branch,
                        dry_run=dry_run,
                    )
                duration = round(time.time() - start_time)
                results[table_name] = (
                    ("ok", duration) if modified else ("skipped", None)
                )
            except SPARK_CONN_ERRORS:
                # Spark itself is unreachable -- no point continuing with the
                # remaining tables on a dead session. Propagate so the caller
                # can restart Spark and retry. The finally block below still
                # attempts to resume the Kafka connector.
                raise
            except Exception as e:
                log.error(
                    f"ERROR compacting {namespace}.{table_name}: {e}", exc_info=True
                )
                duration = round(time.time() - start_time)
                results[table_name] = (f"failed: {e}", duration)
    finally:
        # -- Resume connector even if a table blew up or Spark died ------------
        # This prevents the sink from being left PAUSED indefinitely when a
        # compaction pass fails partway through.
        if kafka_client:
            if not dry_run:
                try:
                    kafka_client.resume()
                except Exception as e:
                    log.error(f"Failed to resume Kafka connector: {e}", exc_info=True)
            else:
                log.info("[DRY RUN] Would resume Kafka connector here")

    # -- Overall summary -------------------------------------------------------
    log.info("")
    log.info("=" * 60)
    log.info("COMPACTION SUMMARY")
    log.info("=" * 60)
    any_failed = False
    for table_name, (status, duration) in results.items():
        icon = "✓" if status == "ok" else ("~" if status == "skipped" else "✗")
        if status == "ok":
            log.info(f"  {icon}  {namespace}.{table_name:30s}  ok in {duration}s")
        elif status.startswith("failed"):
            log.info(f"  {icon}  {namespace}.{table_name:30s}  {status} in {duration}s")
        else:
            log.info(f"  {icon}  {namespace}.{table_name:30s}  skipped")

        if status not in ("ok", "skipped"):
            any_failed = True
    log.info("=" * 60)

    if any_failed:
        raise RuntimeError("One or more tables failed compaction (see above).")


def run_with_spark_recovery(spark, args, shared_kwargs, max_restarts: int = 2):
    """Run one compaction pass, restarting Spark on connection failures.

    Returns the (possibly new) spark session so the caller keeps a live handle.
    """
    for attempt in range(max_restarts + 1):
        if not spark_is_alive(spark):
            log.warning("Spark session is not responding.")
            spark = restart_spark(spark, args.jars_dir, args.warehouse, args.region)
            shared_kwargs["spark"] = spark
        try:
            rewrite_tables(**shared_kwargs)
            return spark
        except SPARK_CONN_ERRORS as e:
            if attempt == max_restarts:
                raise
            log.error(
                f"Spark connection error "
                f"(attempt {attempt + 1}/{max_restarts + 1}): {e}"
            )
            spark = restart_spark(spark, args.jars_dir, args.warehouse, args.region)
            shared_kwargs["spark"] = spark
    return spark


# -- CLI ----------------------------------------------------------------------


def main():  # noqa: PLR0912, PLR0915
    """Compact the iceberg tables."""
    parser = argparse.ArgumentParser(
        description="Compact Iceberg equality deletes via PySpark INSERT OVERWRITE. "
        "Pass a comma-separated list to --table to compact multiple tables. "
        "Supply --interval <seconds> to run continuously as a server."
    )
    parser.add_argument("--namespace", required=True)
    parser.add_argument(
        "--table",
        required=True,
        help="Comma-separated table name(s), e.g. files,executions,granules",
    )
    parser.add_argument("--warehouse", required=True)
    parser.add_argument("--region", default="us-west-2")
    parser.add_argument("--jars-dir", required=True)
    parser.add_argument("--staging-branch", default="staging")
    parser.add_argument("--main-branch", default="main")
    parser.add_argument("--kafka-connect-url", default=None)
    parser.add_argument("--connector-name", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--full-overwrite",
        action="store_true",
        help="Perform a full rewrite of the entire table instead of "
        "rewriting only modified partitions.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=None,
        help="When set, run compaction in a continuous loop sleeping "
        "this many seconds between runs (server mode). "
        "Omit for a one-shot run.",
    )
    parser.add_argument(
        "--max-spark-restarts",
        type=int,
        default=2,
        help="Maximum number of Spark session restarts to attempt per "
        "compaction run when the Spark JVM is unreachable (default: 2).",
    )
    args = parser.parse_args()

    # strip schema from table names
    table_names = [
        resolve_table_name(t.strip().split(".")[-1])
        for t in args.table.split(",")
        if t.strip()
    ]
    if not table_names:
        parser.error("--table must contain at least one table name")

    if args.dry_run:
        log.info("=== DRY RUN MODE -- no changes will be committed ===")

    log.info(
        "Performing full overwrite of tables"
        if args.full_overwrite
        else "Performing rewrite of modified partitions"
    )
    log.info(f"Tables to compact ({len(table_names)}): {', '.join(table_names)}")

    kafka_client = None
    if args.kafka_connect_url and args.connector_name:
        kafka_client = KafkaConnectClient(args.kafka_connect_url, args.connector_name)
        log.info(
            f"Kafka Connect: {args.kafka_connect_url}  connector: {args.connector_name}"
        )
        if not args.dry_run:
            log.info(f"Connector current state: {kafka_client.status()}")
    else:
        log.warning("No --kafka-connect-url / --connector-name provided.")

    # -- Start Spark and catalog once; shared across all compaction runs -------
    spark = get_spark(args.jars_dir, args.warehouse, args.region)
    catalog = get_catalog(args.region, args.warehouse)

    shared_kwargs = dict(
        namespace=args.namespace,
        table_names=table_names,
        spark=spark,
        catalog=catalog,
        kafka_client=kafka_client,
        staging_branch=args.staging_branch,
        main_branch=args.main_branch,
        dry_run=args.dry_run,
        full_overwrite=args.full_overwrite,
    )

    try:
        if args.interval is None:
            # Run compaction once and then exit
            try:
                spark = run_with_spark_recovery(
                    spark, args, shared_kwargs, max_restarts=args.max_spark_restarts
                )
            except RuntimeError as e:
                raise SystemExit(str(e))
        else:
            # ----------------------------------------------------------------
            # Server mode -- loop forever, sleeping --interval seconds between
            # compaction runs. A failed run is logged but does NOT stop the loop
            # so that a transient error doesn't take down the service.
            # ----------------------------------------------------------------
            log.info(
                f"=== SERVER MODE -- interval={args.interval}s (Ctrl-C to stop) ==="
            )
            run_number = 0
            while True:
                run_number += 1
                run_start = time.time()
                log.info(
                    f"--- Compaction run #{run_number} "
                    f"starting at {datetime.utcnow().isoformat()}Z ---"
                )
                try:
                    spark = run_with_spark_recovery(
                        spark,
                        args,
                        shared_kwargs,
                        max_restarts=args.max_spark_restarts,
                    )
                except Exception as e:
                    # Log but keep looping; a single bad run shouldn't crash the server.
                    log.error(
                        f"Compaction run #{run_number} failed: {e}", exc_info=True
                    )

                run_duration = time.time() - run_start

                log.info(
                    f"--- Run #{run_number} completed in {run_duration:.1f}s. "
                    f"Sleeping {args.interval}s before next run ---"
                )

                try:
                    time.sleep(args.interval)
                except KeyboardInterrupt:
                    log.info("Interrupted during sleep -- shutting down.")
                    break
    finally:
        try:
            spark.stop()
        except Exception:  # noqa: S110
            pass
        log.info("Spark session stopped.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Interrupted -- shutting down.")
