#!/bin/bash

DIR=$1
# find packages location
echo "Entering $DIR"
cd "$DIR" || exit 1

# ensure packages are up to date using uv
uv sync --no-dev --frozen

# package dependencies
SITE_PACKAGES=$(find "$DIR"/.venv/lib/python*/site-packages -type d | head -1)
echo "Entering $SITE_PACKAGES"
cd "$SITE_PACKAGES" || exit 1
cp -R ./* "$DIR/dist/"

cd "$DIR" || exit 1

cp ./src/*.py ./dist/

cd ./dist || exit 1

node ../../../../bin/zip.js lambda.zip $(ls | grep -v lambda.zip)

cd .. || exit 1

# Re-sync dev dependencies for any post-packaging tasks
uv sync