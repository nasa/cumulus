# Issuing PR From Forked Repos

To issue a PR from the forked repository read Github's documentation on how to work with forks [here](https://help.github.com/articles/working-with-forks/).

When a new Pull Request from a forked repository is created, we will run the tests in the circleci environment.

You PRs tests must pass on circleci before we can review it.

Look for the green check mark in the PR.

![screenshot 2018-10-12 13 22 48](https://user-images.githubusercontent.com/1933118/46869548-80d31480-ce2c-11e8-81fc-10096e701189.png)

## Reviewing PRs from Forked Repos

PRs from forked repos cannot directly merged to master. Cumulus reviews must follow the following steps before completing the review process:

1. Create a new branch:

     $ git checkout -b from-from-<name-of-the-branch> master

2. Pull in the forked branch

     $ git pull https://github.com/<forked-username>/cumulus.git <name-of-the-branch>

3. Push the new branch to github and create a new PR

4. Change the destination of the forked PR to the new branch that was just pushed

![screenshot 2018-10-12 14 37 49](https://user-images.githubusercontent.com/1933118/46869547-80d31480-ce2c-11e8-9d2f-b8e1ea01fdb6.png)

5. If the travis tests passed merge the forked PR to the new branch

6. Merge the new branch to master

