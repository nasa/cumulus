#!/bin/bash
set -xe
CONFIG=$(jq -r '.' build-config.json)
RUNTIME=$(echo $CONFIG | jq -r '.runtime')
PYTHON_VERSION=$(echo $RUNTIME | sed 's/^python//')
ARCHITECTURE=$(echo $CONFIG | jq -r '.architecture')

mkdir -p dist/{dist,packages,final} && \

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
    --python-platform linux \
    --python ${PYTHON_VERSION} \
    --requirements dist/requirements.txt \
    --target dist/packages;

uv pip install \
    --python-platform linux \
    --python ${PYTHON_VERSION} \
    --target dist/packages \
    dist/dist/*.whl;

cd dist/packages;
zip -r ../final/lambda.zip .;
