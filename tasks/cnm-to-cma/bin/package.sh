#!/usr/bin/env bash
set -euo pipefail
DIR=$1
PYTHON_VERSION=3.13
IMAGE="public.ecr.aws/lambda/python:${PYTHON_VERSION}"
BUILD_DIR="../build/lambda"
ZIP_NAME="cnm2cma.zip"

SRC_DIR="src/cnm2cma"                # adjust if needed
HANDLER_FILE="cnm_to_cma.py" # adjust if needed

echo "▶ Cleaning old build..."
rm -rf BUILD_DIR ../requirements.txt ../${ZIP_NAME}
mkdir -p ${BUILD_DIR}

#echo "▶ Exporting Poetry dependencies..."
#poetry export \
#  -f requirements.txt \
#  --without-hashes \
#  -o requirements.txt

# use uv to generate requirements.txt
echo "▶ Exporting uv dependencies..."
uv export --format requirements-txt --no-dev --no-hashes -o requirements.txt

# use python 3.14 if possible
uv pip install \
  --platform linux \
  --arch aarch64 \
  --python-version 3.13 \
  --target ${BUILD_DIR} \
  -r requirements.txt

echo "▶ Installing dependencies inside Lambda Docker..."
docker run --rm \
  --entrypoint "" \
  -v "$PWD":/var/task \
  ${IMAGE} \
  pip install -r requirements.txt -t ${BUILD_DIR}

echo "▶ Copying project source..."
cp -r ${SRC_DIR}/* ${BUILD_DIR}

#if [[ -f "${HANDLER_FILE}" ]]; then
#  cp ${HANDLER_FILE} ${BUILD_DIR}
#fi

echo "▶ Creating zip..."
cd BUILD_DIR
zip -r ../${ZIP_NAME} .
cd ..

echo "✅ Build complete: ${ZIP_NAME}"
