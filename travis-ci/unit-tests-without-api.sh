#/bin/bash

./node_modules/.bin/nyc ./node_modules/.bin/lerna run test --ignore @cumulus/api; export EXITCODE=$?; echo EXITCODE $EXITCODE; exit $EXITCODE
