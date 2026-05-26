#!/usr/bin/env python3
"""CDC Kafka to Iceberg Sink — equality-delete edition.

Reads CDC messages from Kafka topics (Debezium format) and writes them to
Iceberg V2 tables using REAL EQUALITY DELETES via the Iceberg Java API,
called through PySpark's JVM gateway.

The actual writes are performed by the helper Java class
`gov.nasa.cumulus.IcebergCDCWriter`, which must be on the Spark
classpath (drop the built JAR into `iceberg.cdc.helper.jar` or alongside
your existing iceberg-spark-runtime JAR).

Per batch the helper:
  1. Writes one Parquet data file per touched partition (upserted rows).
  2. Writes one Parquet equality-delete file per touched partition,
     containing the id columns of every upserted row AND every pure delete.
  3. Atomically commits both via Table.newRowDelta()
     .addRows(dataFile).addDeletes(deleteFile).toBranch(branch).commit().

This is the exact same pattern Flink's Iceberg sink uses for upserts and
produces genuine V2 equality delete files compatible with downstream
compaction.

Usage:
    python cdc_iceberg_sink.py --config config.json
"""

import argparse
import json
import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from confluent_kafka import Consumer, KafkaError, TopicPartition
from pyspark.sql import SparkSession

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------


def load_config(path: str) -> dict[str, str]:
    """Load the configuration for the sink process."""
    with open(path) as f:
        return json.load(f)


def parse_topic_table_map(config: dict[str, str]) -> list[tuple[str, str, list[str]]]:
    """Get the topic to table map that provides ID columns."""
    topics = [t.strip() for t in config["topics"].split(",") if t.strip()]
    tables = [t.strip() for t in config["iceberg.tables"].split(",") if t.strip()]
    id_col_entries = [t.strip() for t in config["iceberg.tables.id-columns"].split(",")]

    if len(topics) != len(tables):
        raise ValueError("Number of topics must match number of iceberg.tables entries")
    if len(id_col_entries) != len(tables):
        raise ValueError(
            "Number of id-column entries must match number of iceberg.tables entries"
        )

    result = []
    for topic, table, id_cols_raw in zip(topics, tables, id_col_entries):
        id_cols = [c.strip() for c in id_cols_raw.split("|") if c.strip()]
        result.append((topic, table, id_cols))
    return result


# ---------------------------------------------------------------------------
# Offset persistence
# ---------------------------------------------------------------------------


class OffsetStore:
    """Persists Kafka topic/partition offsets to a local JSON file so the sink
    can resume after a restart without replaying already-processed messages.

    Offset format: { "topic:partition": next_offset_to_consume }
    """

    def __init__(self, path: str):
        """Initialize the offset store."""
        self.path = path
        self._offsets: dict[str, int] = {}
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._load()

    def _load(self):
        """Load the offsets from the store."""
        log.info(f"Attempting to load offsets from {self.path}")
        if os.path.exists(self.path):
            try:
                with open(self.path) as f:
                    self._offsets = json.load(f)
                log.info(f"Loaded offsets from {self.path}: {self._offsets}")
            except Exception as e:
                log.warning(
                    f"Could not load offsets from {self.path}: {e} — starting fresh"
                )
                self._offsets = {}
        else:
            log.warning(f"Offset file {self.path} does not exist")

    def _save(self):
        """Write the offsets to the store."""
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self._offsets, f)
        os.replace(tmp, self.path)

    def key(self, topic: str, partition: int) -> str:
        """Get the key for retrieving an offset for a given topic/partition."""
        return f"{topic}:{partition}"

    def get(self, topic: str, partition: int) -> int | None:
        """Get the offset for the given topic/partition."""
        return self._offsets.get(self.key(topic, partition))

    def set(self, topic: str, partition: int, offset: int):
        """Set the offset for the given topic/partition."""
        self._offsets[self.key(topic, partition)] = offset

    def commit(self):
        """Save the offsets and provide a log message."""
        self._save()
        log.info(f"Offsets committed to {self.path}: {self._offsets}")

    def to_topic_partitions(self, topics: list[str]) -> list[TopicPartition]:
        """Get a list of topic/partition/offset structures."""
        tps = []
        for key, offset in self._offsets.items():
            topic, partition = key.rsplit(":", 1)
            if topic in topics:
                tps.append(TopicPartition(topic, int(partition), offset))
        return tps


# ---------------------------------------------------------------------------
# HTTP control server
# ---------------------------------------------------------------------------


class ControlServer:
    """HTTP server to listen for pause/resume requests."""

    def __init__(self, sink: "CDCIcebergSink", port: int = 8080):
        """Set the parameters for the server."""
        self.sink = sink
        self.port = port
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self):
        """Start the http server."""
        sink = self.sink

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                log.debug(f"HTTP {fmt % args}")

            def send_json(self, status: int, body: dict):
                payload = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                if self.path == "/status":
                    self.send_json(200, {"state": sink.state})
                else:
                    self.send_json(404, {"error": "not found"})

            def do_POST(self):
                if self.path == "/pause":
                    if sink.state == "PAUSED":
                        self.send_json(
                            200, {"state": "PAUSED", "note": "already paused"}
                        )
                        return
                    log.info("HTTP /pause received — waiting for in-progress flush...")
                    with sink._flush_lock:
                        sink._paused = True
                    log.info("Sink paused")
                    self.send_json(200, {"state": "PAUSED"})
                elif self.path == "/resume":
                    if sink.state == "RUNNING":
                        self.send_json(
                            200, {"state": "RUNNING", "note": "already running"}
                        )
                        return
                    sink._paused = False
                    log.info("Sink resumed")
                    self.send_json(200, {"state": "RUNNING"})
                else:
                    self.send_json(404, {"error": "not found"})

        self._server = HTTPServer(("0.0.0.0", self.port), Handler)  # noqa: S104
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        log.info(f"Control server listening on port {self.port}")

    def stop(self):
        """Stop the HTTP server."""
        if self._server:
            self._server.shutdown()


# ---------------------------------------------------------------------------
# Iceberg writer — calls the Java helper via the Spark JVM gateway
# ---------------------------------------------------------------------------


class IcebergCDCWriter:
    """Thin Python wrapper around gov.nasa.cumulus.IcebergCDCWriter.

    Each Python instance owns one long-lived Java helper (one per table).
    We accumulate CDC events in a Python buffer, then on `flush()` we
    convert one sub-batch at a time into Java collections and call
    `writeBatch(upserts, deletes)` on the helper, which performs a single
    atomic RowDelta commit producing real equality-delete files.

    Each buffered item stores the Kafka topic, partition, and offset so that
    the sink can commit offsets incrementally after each sub-batch rather than
    only after the entire buffer is written.
    """

    def __init__(  # noqa: PLR0913
        self,
        spark: SparkSession,
        table_id: str,
        catalog_name: str,
        id_columns: list[str],
        branch: str,
        batch_size: int = 20000,
    ):
        """Set the parameters."""
        self.spark = spark
        self.jvm = spark._jvm
        self.table_id = table_id
        self.catalog_name = catalog_name
        self.id_columns = id_columns
        self.branch = branch or "main"
        self.batch_size = batch_size
        self._buffer: list[dict[str, Any]] = []

        parts = table_id.split(".")
        if len(parts) < 2:  # noqa: PLR2004
            raise ValueError(f"table_id must be 'namespace.table' (got {table_id!r})")
        self._namespace = ".".join(parts[:-1])
        self._table_name = parts[-1]

        self._jcatalog = self._resolve_iceberg_catalog()

        helper_cls = self.jvm.gov.nasa.cumulus.IcebergCDCWriter
        self._helper = helper_cls(
            self._jcatalog,
            self._namespace,
            self._table_name,
            "|".join(self.id_columns),
            self.branch,
        )

        log.info(
            f"IcebergCDCWriter ready for {self.table_id} "
            f"(equality fields={self.id_columns}, branch={self.branch})"
        )

    def _resolve_iceberg_catalog(self):
        catalog_manager = self.spark._jsparkSession.sessionState().catalogManager()
        spark_catalog = catalog_manager.catalog(self.catalog_name)
        return spark_catalog.icebergCatalog()

    def name(self) -> str:
        """Get the name of the table."""
        return self.table_id

    def add(
        self,
        op: str,
        row: dict[str, Any],
        topic: str = "",
        partition: int = 0,
        offset: int = 0,
    ):
        """Buffer a CDC record along with its Kafka position for accurate offset
        tracking.
        """
        self._buffer.append(
            {
                "op": op,
                "row": row,
                "topic": topic,
                "partition": partition,
                "offset": offset,
            }
        )

    def pending(self) -> int:
        """Return the number of pending entries."""
        return len(self._buffer)

    def flush(self, on_sub_batch_written=None, max_retries: int = 3) -> int:
        """Write buffered records in sub-batches. After each successful sub-batch,
        calls on_sub_batch_written(n, sub_batch_offsets) where sub_batch_offsets
        is a dict of {(topic, partition): max_offset} for just that sub-batch.
        This allows the caller to commit offsets incrementally, so a crash
        mid-flush only requires replaying the last sub-batch rather than the
        entire buffer.
        """
        if not self._buffer:
            return 0

        total = len(self._buffer)
        total_batches = (total + self.batch_size - 1) // self.batch_size
        log.info(
            f"Flushing {total} record(s) to {self.table_id} on branch '{self.branch}' "
            f"(sub-batch size: {self.batch_size})"
        )

        written = 0
        batch_num = 0

        while self._buffer:
            sub_batch = self._buffer[: self.batch_size]
            batch_num += 1

            for attempt in range(1, max_retries + 1):
                try:
                    self._write_sub_batch(sub_batch)
                    break
                except Exception as e:
                    msg = str(e)
                    is_conflict = (
                        "CommitFailedException" in msg or "ValidationException" in msg
                    )
                    if is_conflict and attempt < max_retries:
                        log.warning(
                            f"Commit conflict on {self.table_id} "
                            f"(attempt {attempt}/{max_retries}), refreshing and retrying..."  # noqa: E501
                        )
                        try:
                            self._helper.refresh()
                        except Exception as ref_e:
                            log.warning(f"refresh() failed: {ref_e}")
                        time.sleep(0.25 * attempt)
                    else:
                        log.error(
                            f"Error writing to {self.table_id}: {e}"
                            + (
                                f" (gave up after {max_retries} attempts)"
                                if is_conflict
                                else ""
                            ),
                            exc_info=True,
                        )
                        raise

            # Sub-batch succeeded — collect the highest offset per
            # topic/partition seen in this sub-batch only
            sub_batch_offsets: dict[tuple[str, int], int] = {}
            for item in sub_batch:
                tp_key = (item.get("topic", ""), item.get("partition", 0))
                sub_batch_offsets[tp_key] = max(
                    sub_batch_offsets.get(tp_key, 0),
                    item.get("offset", 0),
                )

            self._buffer = self._buffer[self.batch_size :]
            written += len(sub_batch)

            log.info(
                f"Sub-batch {batch_num}/{total_batches} written "
                f"({written}/{total} records) for {self.table_id}"
            )

            if on_sub_batch_written is not None:
                on_sub_batch_written(len(sub_batch), sub_batch_offsets)

        return written

    def _write_sub_batch(self, items: list[dict[str, Any]]):
        """Split items into upserts (deduped, last-write-wins per id key) and
        pure deletes, hand both to the Java helper for one atomic commit.
        """
        seen: dict[tuple, dict[str, Any]] = {}
        delete_rows: dict[tuple, dict[str, Any]] = {}

        for item in items:
            op = item["op"]
            row = item["row"]
            key = tuple(row.get(c) for c in self.id_columns)
            if op in ("c", "u"):
                seen[key] = row
                delete_rows.pop(key, None)
            elif op == "d":
                seen.pop(key, None)
                delete_rows[key] = row

        if not seen and not delete_rows:
            return

        j_upserts = self._to_java_list(seen.values())
        j_deletes = self._to_java_list(delete_rows.values())

        self._helper.writeBatch(j_upserts, j_deletes)

    def _to_java_list(self, rows):
        jvm = self.jvm
        java_list = jvm.java.util.ArrayList()
        for row in rows:
            java_map = jvm.java.util.HashMap()
            for k, v in row.items():
                java_map.put(k, _to_java_value(jvm, v))
            java_list.add(java_map)
        return java_list


def _to_java_value(jvm, v):
    result = str(v)
    if v is None:
        result = None
    if isinstance(v, bool):
        result = v
    if isinstance(v, int):
        result = v
    if isinstance(v, float):
        result = v
    if isinstance(v, str):
        result = v
    if isinstance(v, bytes):
        result = v
    try:
        import datetime as _dt  # noqa: PLC0415

        if isinstance(v, _dt.datetime):
            if v.tzinfo is None:
                result = v.isoformat() + "Z"
            else:
                result = v.isoformat()
        if isinstance(v, _dt.date):
            result = v.isoformat()
    except Exception:  # noqa: S110
        pass
    return result


# ---------------------------------------------------------------------------
# Main sink
# ---------------------------------------------------------------------------


class CDCIcebergSink:
    """The main sink class."""

    def __init__(self, config: dict[str, str]):
        """Set parameters."""
        self.config = config
        self.commit_interval_s = int(config.get("commit.interval-ms", "30000")) / 1000
        self.commit_timeout_s = int(config.get("commit.timeout-ms", "120000")) / 1000
        self.branch = config.get("iceberg.tables.commit-branch", "main")
        self.offset_file = config.get(
            "offset.file", "/kafka/data/cdc-sink/offsets.json"
        )
        self.batch_size = int(config.get("batch.size", "20000"))
        self.catalog_name = config.get("iceberg.catalog.name", "glue")
        self.running = False
        self._paused = False
        self._flush_lock = threading.Lock()

        self.topic_table_map = parse_topic_table_map(config)
        self.topics = [t for t, _, _ in self.topic_table_map]

        self.offset_store = OffsetStore(self.offset_file)

        warehouse = config["iceberg.catalog.warehouse"]
        region = config.get("iceberg.catalog.region") or os.environ.get(
            "AWS_DEFAULT_REGION"
        )
        jars_dir = config.get("spark.jars.dir") or os.environ.get(
            "SPARK_JARS_DIR", "./scripts/jars"
        )
        helper_jar = config.get(
            "iceberg.cdc.helper.jar",
            os.path.join(jars_dir, "iceberg-cdc-helper-1.0.0.jar"),
        )
        self.spark = self._create_spark(warehouse, region, jars_dir, helper_jar)

        self.writers: dict[str, IcebergCDCWriter] = {}
        for topic, table_id, id_cols in self.topic_table_map:
            log.info(
                f"Initializing equality-delete writer for {table_id} (topic: {topic})"
            )
            self.writers[topic] = IcebergCDCWriter(
                spark=self.spark,
                table_id=table_id,
                catalog_name=self.catalog_name,
                id_columns=id_cols,
                branch=self.branch,
                batch_size=self.batch_size,
            )

        kafka_conf = {
            "bootstrap.servers": config.get(
                "kafka.bootstrap.servers", "localhost:9092"
            ),
            "group.id": config.get("kafka.group.id", "cdc-iceberg-sink"),
            "enable.auto.commit": False,
            "auto.offset.reset": "earliest",
            "max.poll.interval.ms": (
                config.get("kafka.max.poll.interval.ms")
                or config.get("consumer.override.max.poll.interval.ms")
                or "3600000"
            ),
        }
        self.consumer = Consumer(kafka_conf)

        control_port = int(config.get("control.port", "8080"))
        self._control_server = ControlServer(self, port=control_port)
        self._control_server.start()

    @property
    def state(self) -> str:
        """Return the state of the sink process."""
        return "PAUSED" if self._paused else "RUNNING"

    def _create_spark(
        self, warehouse: str, region: str | None, jars_dir: str, helper_jar: str
    ) -> SparkSession:
        log.info("Starting Spark session...")

        classpath_jars = [
            os.path.join(jars_dir, "iceberg-spark-runtime-3.5_2.12-1.7.1.jar"),
            os.path.join(jars_dir, "iceberg-aws-bundle-1.7.1.jar"),
            helper_jar,
        ]
        for j in classpath_jars:
            if not os.path.exists(j):
                raise FileNotFoundError(f"Required jar missing: {j}")
        classpath = ":".join(classpath_jars)

        log.info(f"Spark classpath jars: {classpath_jars}")

        builder = (
            SparkSession.builder.master("local[*]")
            .appName("cdc-iceberg-sink")
            .config("spark.driver.extraClassPath", classpath)
            .config("spark.executor.extraClassPath", classpath)
            .config(
                "spark.sql.extensions",
                "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
            )
            .config(
                f"spark.sql.catalog.{self.catalog_name}",
                "org.apache.iceberg.spark.SparkCatalog",
            )
            .config(
                f"spark.sql.catalog.{self.catalog_name}.catalog-impl",
                "org.apache.iceberg.aws.glue.GlueCatalog",
            )
            .config(f"spark.sql.catalog.{self.catalog_name}.warehouse", warehouse)
            .config(
                f"spark.sql.catalog.{self.catalog_name}.io-impl",
                "org.apache.iceberg.aws.s3.S3FileIO",
            )
            .config("spark.driver.memory", "4g")
            .config("spark.local.dir", "./spark-tmp")
        )
        if region:
            builder = builder.config(
                f"spark.sql.catalog.{self.catalog_name}.client.region", region
            )

        spark = builder.getOrCreate()
        log.info(f"Spark version: {spark.version}")
        return spark

    def _assign_with_stored_offsets(self):
        stored_tps = self.offset_store.to_topic_partitions(self.topics)
        stored_map = {(tp.topic, tp.partition): tp.offset for tp in stored_tps}

        def on_assign(consumer, partitions):
            for tp in partitions:
                stored_offset = stored_map.get((tp.topic, tp.partition))
                if stored_offset is not None:
                    log.info(
                        f"Seeking {tp.topic}[{tp.partition}] to stored offset {stored_offset}"  # noqa: E501
                    )
                    tp.offset = stored_offset
            consumer.assign(partitions)

        self.consumer.subscribe(self.topics, on_assign=on_assign)

    def _process_message(self, msg) -> bool:  # noqa: PLR0911
        topic = msg.topic()
        value = msg.value()

        if value is None:
            return False

        try:
            cdc = json.loads(value.decode("utf-8"))
        except Exception as e:
            log.warning(f"Could not decode message on {topic}: {e}")
            return False

        op = cdc.get("op")
        if op == "r":
            op = "c"
        if op not in ("c", "u", "d"):
            return False

        after = cdc.get("after")
        before = cdc.get("before")

        if op in ("c", "u") and after is None:
            log.warning(f"op='{op}' but 'after' is null on {topic}, skipping")
            return False
        if op == "d" and before is None:
            log.warning(f"op='d' but 'before' is null on {topic}, skipping")
            return False

        row = after if op in ("c", "u") else before
        writer = self.writers.get(topic)
        if writer is None:
            log.warning(f"No writer for topic {topic}")
            return False

        # Pass Kafka position so each buffered item tracks its own offset
        writer.add(
            op, row, topic=topic, partition=msg.partition(), offset=msg.offset() + 1
        )
        return True

    def _flush_all(self) -> int:
        total = 0
        with self._flush_lock:
            for topic, writer in self.writers.items():
                if writer.pending() > 0:
                    try:
                        start = time.time()

                        def on_sub_batch(
                            n: int, sub_offsets: dict[tuple[str, int], int]
                        ):
                            # Only advance offsets to the boundary of the completed
                            # sub-batch — not the end of the entire buffer
                            for (t, p), off in sub_offsets.items():
                                if t:
                                    log.info(
                                        f"Writing new starting offset {off} for topic {t}, partition {p} after writing {n} records"  # noqa: E501
                                    )
                                    self.offset_store.set(t, p, off)
                            self.offset_store.commit()
                            log.debug(
                                f"Committed offsets after sub-batch of {n} "
                                f"for {topic}: {sub_offsets}"
                            )

                        n = writer.flush(on_sub_batch_written=on_sub_batch)
                        elapsed = time.time() - start
                        total += n
                        log.info(f"Flushed {n} record(s) for {topic} in {elapsed:.2f}s")
                        if elapsed > self.commit_timeout_s:
                            log.warning(
                                f"Flush for {topic} took {elapsed:.2f}s, "
                                f"exceeded timeout {self.commit_timeout_s}s"
                            )
                    except Exception as e:
                        log.error(f"Flush failed for {topic}: {e}", exc_info=True)
        return total

    def run(self):  # noqa: PLR0912
        """Start the sink process."""
        self.running = True
        self._assign_with_stored_offsets()
        log.info(
            f"CDC Iceberg Sink started. Topics: {self.topics} | "
            f"Commit interval: {self.commit_interval_s}s"
        )

        next_commit = time.time() + self.commit_interval_s
        messages_since_commit = 0

        try:
            while self.running:
                now = time.time()

                if self._paused:
                    time.sleep(0.5)
                    next_commit = time.time() + self.commit_interval_s
                    continue

                if now >= next_commit:
                    if messages_since_commit > 0:
                        log.info(
                            f"Commit interval reached, flushing "
                            f"{messages_since_commit} buffered message(s)..."
                        )
                        total = self._flush_all()
                        if total > 0:
                            log.info(
                                f"Committed {total} record(s) to Iceberg and saved offsets"  # noqa: E501
                            )
                    else:
                        log.debug("Commit interval reached, nothing to flush")

                    messages_since_commit = 0
                    next_commit = time.time() + self.commit_interval_s

                poll_timeout = min(1.0, max(0.1, next_commit - time.time()))
                msg = self.consumer.poll(timeout=poll_timeout)

                if msg is None:
                    continue

                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        log.debug(f"End of partition {msg.topic()}[{msg.partition()}]")
                    else:
                        log.error(f"Kafka error: {msg.error()}")
                    continue

                if self._process_message(msg):
                    messages_since_commit += 1

        except KeyboardInterrupt:
            log.info("Interrupted, shutting down...")
        finally:
            self._shutdown()

    def _shutdown(self):
        log.info("Flushing remaining records before shutdown...")
        try:
            total = self._flush_all()
            if total > 0:
                log.info(f"Flushed {total} record(s) on shutdown")
        except Exception as e:
            log.error(f"Error during shutdown flush: {e}", exc_info=True)
        finally:
            self._control_server.stop()
            self.consumer.close()
            self.spark.stop()
            log.info("Sink stopped.")

    def stop(self):
        """Tell the sink process it is not running."""
        self.running = False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    """Run the sink process."""
    parser = argparse.ArgumentParser(
        description="CDC Kafka to Iceberg Sink with REAL equality deletes"
    )
    parser.add_argument("--config", required=True, help="Path to JSON config file")
    parser.add_argument("--log-level", default="INFO", help="Logging level")
    args = parser.parse_args()

    logging.getLogger().setLevel(getattr(logging, args.log_level.upper(), logging.INFO))

    config = load_config(args.config)
    sink = CDCIcebergSink(config)

    def handle_sigterm(signum, frame):
        log.info("Received SIGTERM, stopping...")
        sink.stop()

    signal.signal(signal.SIGTERM, handle_sigterm)

    sink.run()


if __name__ == "__main__":
    main()
