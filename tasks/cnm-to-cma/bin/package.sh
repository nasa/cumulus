#!/usr/bin/env bash
set -euo pipefail
DIR=$1
echo "Entering $DIR"
echo $PWD
cd "$DIR" || exit 1

# use uv to generate requirements.txt
echo "▶ Exporting uv dependencies..."
uv export --format requirements-txt --no-dev --no-hashes -o requirements.txt

uv pip install \
  --python-platform aarch64-unknown-linux-gnu\
  --python-version 3.13 \
  --target "${DIR}/.venv" \
  -r requirements.txt

cp -r "${DIR}/src/cnm2cma" "${DIR}/.venv"

cd ./.venv || exit 1

node ../../../bin/zip.js lambda.zip $(ls | grep -v lambda.zip)

cd .. || exit 1

# Re-sync dev dependencies for any post-packaging tasks
uv sync
