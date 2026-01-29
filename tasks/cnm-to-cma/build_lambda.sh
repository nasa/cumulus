#!/usr/bin/env bash
set -euo pipefail

PYTHON_VERSION=3.13
IMAGE="public.ecr.aws/lambda/python:${PYTHON_VERSION}"
BUILD_DIR="build/lambda"
ZIP_NAME="lambda.zip"

SRC_DIR="src"            # adjust if needed
HANDLER_FILE="handler.py" # adjust if needed

echo "▶ Cleaning old build..."
rm -rf build requirements.txt ${ZIP_NAME}
mkdir -p ${BUILD_DIR}

echo "▶ Exporting Poetry dependencies..."
poetry export \
  -f requirements.txt \
  --without-hashes \
  -o requirements.txt

echo "▶ Installing dependencies inside Lambda Docker..."
docker run --rm \
  --entrypoint "" \
  -v "$PWD":/var/task \
  ${IMAGE} \
  pip install -r requirements.txt -t ${BUILD_DIR}

echo "▶ Copying project source..."
cp -r ${SRC_DIR}/* ${BUILD_DIR}

if [[ -f "${HANDLER_FILE}" ]]; then
  cp ${HANDLER_FILE} ${BUILD_DIR}
fi

echo "▶ Creating zip..."
cd build
zip -r ../${ZIP_NAME} lambda
cd ..

echo "✅ Build complete: ${ZIP_NAME}"