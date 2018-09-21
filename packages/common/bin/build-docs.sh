#!/bin/sh

set -e

rm -rf docs
jsdoc -c jsdoc.conf.json .
find . -path './docs/*/styles/*' -not -name 'site.cosmo.css' -exec rm {} \;
