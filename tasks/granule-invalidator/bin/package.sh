#!/bin/bash
set -xe
CONFIG=$(jq -r '.' build-config.json)
RUNTIME=$(echo $CONFIG | jq -r '.runtime')
PYTHON_VERSION=$(echo $RUNTIME | sed 's/^python//')

mkdir -p dist/{dist,packages,final};

uv export \
    --frozen \
    --no-emit-workspace \
    --all-extras \
    --no-dev \
    --no-editable \
    -o dist/requirements.txt;

uv build \
    --clear \
    --wheel \
    -o dist/dist;

uv venv --python ${PYTHON_VERSION};

uv pip install \
    --python-platform x86_64-manylinux_2_17 \
    --python ${PYTHON_VERSION} \
    --requirements dist/requirements.txt \
    --target dist/packages;

uv pip install \
    --only-binary :all: \
    --python-platform x86_64-manylinux_2_17 \
    --python ${PYTHON_VERSION} \
    --target dist/packages \
    dist/dist/*.whl;

cd dist/packages;
node ../../../../bin/zip.js lambda.zip $(ls | grep -v lambda.zip)
