#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh

if [[ $PUBLISH_FLAG == true ]]; then
git clone --depth=50 --branch=gh-pages-test "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/nasa/cumulus.git" gh-pages
(
  set -e
  cd gh-pages
  rm -rf *
  rsync -av ../website/build/Cumulus/ .
  git add .
  git commit -m "Automated build in Bamboo CI"
  echo "Push disabled as we don't want to use bamboo to publish, yet"
  git push
)
fi
