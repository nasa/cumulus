#!/bin/sh

set -e

rm -rf _book
yarn docs-build

git clone --depth=50 --branch=gh-pages "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/nasa/cumulus.git" gh-pages
(
  cd gh-pages
  rsync -av ../_book/ .
  git add .
  git commit -m "Automated build in Travis CI"
  git push
)
