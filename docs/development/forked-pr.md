# Issuing PR From Forked Repos

## Fork the Repo

* Fork the Cumulus repo
* Create a new branch from the branch you'd like to contribute to
* If an issue does't already exist, submit one (see above)

## Create a Pull Request

* [Create a pull request](https://help.github.com/articles/creating-a-pull-request/) from your fork into the target branch of the nasa/cumulus repo
* Also read Github's documentation on how to work with forks [here](https://help.github.com/articles/working-with-forks/).
* Be sure to [mention the corresponding issue number](https://help.github.com/articles/closing-issues-using-keywords/) in the PR description, i.e. "Fixes Issue #10"

## Reviewing PRs from Forked Repos

Upon submission of a pull request, the Cumulus development team will review the code.

Once the code passes an initial review, the team will run the CI tests against the proposed update.

The request will then either be merged, declined, or an adjustment to the code will be requested via the issue opened with the original PR request.

PRs from forked repos cannot directly merged to master. Cumulus reviews must follow the following steps before completing the review process:

1. Create a new branch:

    ```bash
      git checkout -b from-<name-of-the-branch> master
    ```

2. Push the new branch to GitHub
3. Change the destination of the forked PR to the new branch that was just pushed

    ![Screenshot of Github interface showing how to change the base branch of a pull request](https://user-images.githubusercontent.com/1933118/46869547-80d31480-ce2c-11e8-9d2f-b8e1ea01fdb6.png)

4. After code review and approval, merge the forked PR to the new branch.

5. Create a PR for the new branch to master.

6. If the CI tests pass, merge the new branch to master and close the issue.   If the CI tests do not pass, request an amended PR from the original author/ or resolve failures as appropriate.
