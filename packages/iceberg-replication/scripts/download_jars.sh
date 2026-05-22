#!/usr/bin/env bash
set -euo pipefail

JARS_DIR="$(cd "$(dirname "$0")" && pwd)/jars"
mkdir -p "$JARS_DIR"

VERSION="1.7.1"
SCALA="2.12"
SPARK="3.5"
BASE="https://repo1.maven.org/maven2/org/apache/iceberg"

curl -fLo "$JARS_DIR/iceberg-spark-runtime-${SPARK}_${SCALA}-${VERSION}.jar" \
    "$BASE/iceberg-spark-runtime-${SPARK}_${SCALA}/${VERSION}/iceberg-spark-runtime-${SPARK}_${SCALA}-${VERSION}.jar"

curl -fLo "$JARS_DIR/iceberg-aws-bundle-${VERSION}.jar" \
    "$BASE/iceberg-aws-bundle/${VERSION}/iceberg-aws-bundle-${VERSION}.jar"

echo "JARs downloaded to $JARS_DIR"
