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

## Running integration tests on Travis CI

Integration tests are run by default on Travis CI builds for the master branch,
a tagged release, and branches with an open PR. If you want to skip the
integration tests for a given commit for a PR branch, include `[skip-integration-tests]`
in the commit message. To force integration tests to run on a branch that does
not have a PR, include `[force-integration-tests]` in the commit message.

Travis CI determines what stack to run the tests against based on the name of
the branch. It expects that the branch name will be suffixed with a dash
followed by the name of the stack to test against. For instance, to run against
the "test-123" stack, a branch should be called "something-test-123". If the
stack cannot be determined from the branch name then the "cumulus-from-pr" stack
will be used.

If you create a new stack and want to be able to run integration tests against
it in CI, you will need to add it to
[bamboo/select-stack.js](bamboo/select-stack.js).

