#!/bin/bash
set -xe

PYTHON_VERSION="$1"
TASK_DIR="$2"
DIST_DIR="dist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FULL_DIST_DIR=${TASK_DIR}/${DIST_DIR}


mkdir -p ${FULL_DIST_DIR}/{build,packages,final};

uv export \
    --frozen \
    --no-emit-workspace \
    --all-extras \
    --no-dev \
    --no-editable \
    -o ${FULL_DIST_DIR}/requirements.txt;

uv build \
    --clear \
    --wheel \
    -o ${FULL_DIST_DIR}/build;

uv venv --python ${PYTHON_VERSION};

uv pip install \
    --python-platform x86_64-manylinux_2_17 \
    --python ${PYTHON_VERSION} \
    --requirements ${FULL_DIST_DIR}/requirements.txt \
    --target ${FULL_DIST_DIR}/packages;

uv pip install \
    --only-binary :all: \
    --python-platform x86_64-manylinux_2_17 \
    --python ${PYTHON_VERSION} \
    --target ${FULL_DIST_DIR}/packages \
    ${FULL_DIST_DIR}/build/*.whl;

cd ${FULL_DIST_DIR}/packages &&
node ${SCRIPT_DIR}/zip.js ${FULL_DIST_DIR}/final/lambda.zip $(ls | grep -v lambda.zip)