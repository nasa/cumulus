#!/bin/bash

DIR=$1
# find packages location
echo "Entering $DIR"
cd "$DIR" || exit 1
# ensure packages are up to date
export PIPENV_IGNORE_VIRTUALENVS=1
export PIPENV_VENV_IN_PROJECT=1
pip install pipenv
pipenv install --deploy --ignore-pipfile
# package dependencies
SITE_PACKAGES=$(ls -d "$DIR"/.venv/lib/python*/site-packages)
echo "Entering $SITE_PACKAGES"
cd "$SITE_PACKAGES" || exit 1
cp -R ./* "$DIR/dist/"

cd "$DIR" || exit 1
