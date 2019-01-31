# Integration Tests
Cumulus has a comprehensive set of integration tests that tests the framework on an active AWS account. As long as you have an AWS account with valid credentials you can run the tests as described below:

## Running integration tests on AWS

- Run `./bin/prepare`
- Deploy your instance integrations on aws and run tests by following the steps [here](github.com/nasa/cumulus/tree/master/example/README.md)

## Running integration tests on Travis CI

Integration tests are run by default on Travis CI builds for the master branch, a tagged release, and branches with an open PR. If you want to skip the integration tests for a given commit for a PR branch, include `[skip-integration-tests]` in the commit message. To force integration tests to run on a branch that does not have a PR, include `[force-integration-tests]` in the commit message.

Travis CI determines what stack to run the tests against based on the name of
the branch. It expects that the branch name will be suffixed with a dash
followed by the name of the stack to test against. For instance, to run against
the "test-123" stack, a branch should be called "something-test-123". If the
stack cannot be determined from the branch name then the "cumulus-from-pr" stack
will be used.

If you create a new stack and want to be able to run integration tests against
it in CI, you will need to add it to [travis-ci/select-stack.js](travis-ci/select-stack.js).

In order to prevent multiple instances of the integration tests from running
against a stack at the same time, a lock file is created in S3 for each stack.
Before integration tests start they will wait until that lock file is not
present. They will then create that lock file, run the tests, and delete the
lock file. The lock file will be located at
`s3://${CACHE_BUCKET}/travis-ci-integration-tests/${DEPLOYMENT}.lock`. The lock
file will contain a link to the Travis CI job that created the lock file. If
your tests seem to be hung waiting for that lock file, check to see if the job
that created the lock file is still running or has crashed. If it has crashed
then the lock file should be deleted. You should also figure out why the lock
file was not cleaned up and fix that for next time.
