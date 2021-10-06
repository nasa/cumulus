#!/bin/bash

TEMPDIR=$(mktemp -d)
mkdir -p ./website/assets/db_schema
docker run --network=host -v "$TEMPDIR:/output" -v "$PWD/website/schemaspy.prop:/schemaspy.properties" schemaspy/schemaspy:6.1.0
cp -p "$TEMPDIR"/diagrams/summary/*.png "$PWD"/docs/assets/db_schema/
rm -Rf "$TEMPDIR"
