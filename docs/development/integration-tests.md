# Integration Tests
Cumulus has a comprehensive set of integration tests that tests the framework on
an active AWS account. As long as you have an AWS account with valid credentials
you can run the tests as described below:

## Running integration tests on AWS

- Run:
  ```
  npm install
  npm run bootstrap
  ```
- Deploy your instance integrations on aws and run tests by following the steps
  [here](https://github.com/nasa/cumulus/tree/master/example/README.md)

## Running integration tests on Bamboo

Integration tests are run by default on Bamboo builds for the master branch,
a tagged release, and branches with an open PR. If you want to skip the
integration tests for a given commit for a PR branch, include `[skip-integration-tests]`
in the commit message. 

If you create a new stack and want to be able to run integration tests against
it in CI, you will need to add it to
[bamboo/select-stack.js](bamboo/select-stack.js).

