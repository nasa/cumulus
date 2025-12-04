# @cumulus/python-reference-activity

[`python_reference_workflow`]: https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf
[`cumulus-process-py`]: https://github.com/nasa/cumulus-process-py

This 'task' is a reference activity implementation that is included with Cumulus to allow integration testing of the [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) and [`cumulus-process-py`] with a deployed activity.

## Development

Developmental use of this lambda is intended to be simple - the processing activity runs an activity through the CMA and returns a static processing output, integration tests can be then built against the `Reference Activity` step in the [`python_reference_workflow`].

### Requirements

To develop against this task, you should be using python > 3.12, preferably using pipenv.   See package.json for build setup and/or refer to [pipenv documentation](https://pipenv.pypa.io/en/latest/) for more on this.

### Build

To update the container for a PR, you should run:

```bash
docker build --platform linux/amd64,linux/arm64 -t  cumulus-process-activity:{VERSION} .
```

Then push to the configured ECR following the AWS console instructions for pushing to ECR for use in your build.

Then update the `python_processing_service` resource in [`python_reference_workflow`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/python_reference_workflow.tf) to utilize the correct image reference.

***Note*** the activity will *not* automatically include the CMA in the same way [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task) does, as this module has not been similarly developed to pull down a deployed lambda and its layers. The current workflow for integrating the CMA with python activities is for users to create an image *per* activity, where the CMA is brought is as a dependency of [`cumulus-process-py`] or the module itself, and deploy that instead.

## Updates

Updates should generally consist of updates to the included `requirements.txt`, as the purpose of this task is to ensure compatibility with updates to the [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) client library via [`cumulus-process-py`] dependencies.
