#!/bin/bash
## script moves from <current> at <GIT_SHA> to /uncached/cumulus and checks out <GIT_SHA>
set -ex

GIT_SHA=$(git rev-parse HEAD)
export GIT_SHA
cd /uncached/cumulus
git fetch --all
git checkout "$GIT_SHA"
npm install @octokit/graphql@2.1.1 simple-git@3.7.0