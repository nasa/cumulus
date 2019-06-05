#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh

if [[ ! $PUBLISH_FLAG == true ]]; then
  >&2 echo "******Skipping publish step as PUBLISH_FLAG is not set"
  exit 0
fi

git clone --depth=50 --branch=gh-pages "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/nasa/cumulus.git" gh-pages
(
  set -e
  cd gh-pages
  rm -rf *
  rsync -av ../website/build/Cumulus/ .
  git add .
  git commit -m "Automated build in Bamboo CI"
  git push
)
