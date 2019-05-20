# Issuing PR From Forked Repos

## Fork the Repo
* Fork the Cumulus repo
* Create a new branch from the branch you'd like to contribute to
* If an issue does't already exist, submit one (see above)

## Create a Pull Request

* [Create a pull request](https://help.github.com/articles/creating-a-pull-request/) from your fork into the target branch of the nasa/cumulus repo
* Also read Github's documentation on how to work with forks [here](https://help.github.com/articles/working-with-forks/).
* Be sure to [mention the corresponding issue number](https://help.github.com/articles/closing-issues-using-keywords/) in the PR description, i.e. "Fixes Issue #10"

## Run Builds

When a new Pull Request from a forked repository is created, we will run the tests in the circleci environment.

You PRs tests must pass on circleci before we can review it.

Look for the green check mark in the PR.

![screenshot 2018-10-12 13 22 48](https://user-images.githubusercontent.com/1933118/46869548-80d31480-ce2c-11e8-81fc-10096e701189.png)

## Reviewing PRs from Forked Repos

Upon submission of a pull request, the Cumulus development team will review the code.

The request will then either be merged, declined, or an adjustment to the code will be requested.

PRs from forked repos cannot directly merged to master. Cumulus reviews must follow the following steps before completing the review process:

1. Create a new branch:

     $ git checkout -b from-<name-of-the-branch> master

1. Push the new branch to github

1. Change the destination of the forked PR to the new branch that was just pushed

![screenshot 2018-10-12 14 37 49](https://user-images.githubusercontent.com/1933118/46869547-80d31480-ce2c-11e8-9d2f-b8e1ea01fdb6.png)

1. After code review and approval, merge the forked PR to the new branch.

1. If the travis tests, merge the new branch to master
