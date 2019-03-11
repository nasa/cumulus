set -e

. ./travis-ci/set-env-vars.sh

(
  cd example
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    npm install
  else
    (cd .. && ./bin/prepare)
  fi

  npm run redeploy-test
)
