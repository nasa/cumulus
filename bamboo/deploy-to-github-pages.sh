#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh

if [[ $BRANCH != master && $PUBLISH_FLAG != true ]]; then
  >&2 echo "******PUBLISH_FLAG or master branch not detected, skipping doc publish"
  exit 0
fi

git clone --depth=50 --branch=gh-pages "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/nasa/cumulus.git" gh-pages
(
  set -ex
  cd gh-pages
  rm -rf *
  rsync -av ../website/build/Cumulus/ .
  git add .
  git commit -m "Automated build in Bamboo CI"
  git push
)
