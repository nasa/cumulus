#!/bin/bash
## script moves from <current> at <GIT_SHA> to /uncached/cumulus and checks out <GIT_SHA>
set -ex

GIT_SHA=$(git rev-parse HEAD)
export GIT_SHA
cd /uncached/cumulus
git fetch --all --tags --force
git checkout "$GIT_SHA"
