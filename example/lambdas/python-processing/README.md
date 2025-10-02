# @cumulus/python-processing

[`python_processing_workflow`]: https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_processing_workflow.tf
[`cumulus-process-py`]: https://github.com/nasa/cumulus-process-py

This 'task' is a reference activity implementation that is included with Cumulus to allow integration testing of the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) and [`cumulus-process-py`] with a deployed activity.

## Development

This task is intended to be simple - the processing activity takes the input of a typical MOD09GQ.006 S3 ingest workflow output from the `SyncGranule` task, creates and uploads a simple `.md5` hashfile, and returns it with the expected output file list. The file list is passed on to the `FilesToGranules` step  and then the workflow completes with the `MoveGranules` step.

### Requirements

To develop against this task, you should be using python > 3.12, preferably using pipenv.   See package.json for build setup and/or refer to [pipenv documentation](https://pipenv.pypa.io/en/latest/) for more on this.

### Build

To update the container for a PR, you should run:

```bash
docker build --platform linux/amd64,linux/arm64 -t cumulus-test-ingest-process:{VERSION} .
```

Then push to the configured ECR following the AWS console instructions for pushing to ECR for use in your build.

Then update the `python_processing_service` resource in [`python_reference_workflow`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf) to utilize the correct image reference.

***Note*** the activity will *not* automatically include the CMA in the same way [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task) does, as this module has not been similarly developed to pull down a deployed lambda and its layers. The current workflow for integrating the CMA with python activities is for users to create an image *per* activity, where the CMA is brought is as a dependency of [`cumulus-process-py`] or the module itself, and deploy that instead.

## Updates

Updates should generally consist of updates to the included `Pipfile`, as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library via [`cumulus-process-py`] dependencies.
