#!/usr/bin/env python3

import argparse
import os
import time
from datetime import datetime, timedelta, timezone
from pyspark.sql import SparkSession


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def get_jars(jars_dir):
    jars = [
        os.path.join(jars_dir, f)
        for f in os.listdir(jars_dir)
        if f.endswith(".jar")
    ]
    if not jars:
        raise RuntimeError(f"No JAR files found in {jars_dir}")
    return ",".join(jars)


def create_spark(warehouse, region, jars_dir):
    jars = get_jars(jars_dir)

    spark = (
        SparkSession.builder
        .appName("Iceberg Snapshot Expiration")
        .config("spark.jars", jars)
        .config("spark.sql.extensions", "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
        .config("spark.sql.catalog.glue", "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.glue.warehouse", warehouse)
        .config("spark.sql.catalog.glue.catalog-impl", "org.apache.iceberg.aws.glue.GlueCatalog")
        .config("spark.sql.catalog.glue.io-impl", "org.apache.iceberg.aws.s3.S3FileIO")
        .config("spark.sql.catalog.glue.client.region", region)
        .getOrCreate()
    )

    return spark


def expire_table(spark, namespace, table, older_than_minutes, retain_last):
    full_table = f"{namespace}.{table}"

    log(f"Expiring snapshots for {full_table}")

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S.%f")

    spark.sql(f"""
        CALL glue.system.expire_snapshots(
            table => '{full_table}',
            older_than => TIMESTAMP '{cutoff_str}',
            retain_last => {retain_last}
        )
    """)

    log(f"Done: {full_table}")


def main():
    parser = argparse.ArgumentParser(description="Expire Iceberg snapshots")
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--tables", required=True)
    parser.add_argument("--warehouse", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--jars-dir", required=True)
    parser.add_argument("--older-than-minutes", type=int, default=60)
    parser.add_argument("--retain-last", type=int, default=2)

    args = parser.parse_args()

    tables = [t.strip() for t in args.tables.split(",") if t.strip()]

    spark = create_spark(args.warehouse, args.region, args.jars_dir)

    log(f"Starting snapshot expiration for {len(tables)} table(s)")

    for table in tables:
        expire_table(
            spark,
            args.namespace,
            table,
            args.older_than_minutes,
            args.retain_last,
        )

    log("Snapshot expiration complete")

    spark.stop()


if __name__ == "__main__":
    main()
